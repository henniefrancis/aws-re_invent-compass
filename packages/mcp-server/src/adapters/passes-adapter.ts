// The PassesPort adapter over the real S4 (`@compass/core/passes`).
//
// CTO review H1: S4's `syncPasses` voids every recorded pass that is missing from its input, so
// a narrowed sync must never hand it partial input over the whole record. A narrowed sync wraps
// the pass store in a narrowing view: `read` returns only the narrowed entries and `write`
// merges the untouched entries back, so nothing outside the narrowing can be issued, updated or
// voided. Issue is not a sync: it builds the fields, calls the client's `issuePasses`, hashes
// them with S4's `fieldsHash` and writes the record, so issuing one session never voids another.
//
// The adapter sets S4's `scheduleConfirmed` itself because the server only syncs a session list
// that came from a successful, complete fresh GetSchedule. The ID token never leaves the client.

import type { NormalisedSession } from '@compass/contracts';
import {
  buildItinerary,
  buildPassFor,
  createHandoffBuilder,
  createIcsExporter,
  diffSchedule,
  fieldsHash,
  forgetMe,
  MAX_ISSUE_CHUNK,
  PassError,
  syncPasses,
  CompassError as PassClientError,
} from '@compass/core/passes';
import type {
  AppDataResolver,
  Clock,
  CompassClient,
  ConnectionProvider,
  EventWindow,
  FileSystem,
  IssuedPass,
  PassStore,
  ScheduleView,
} from '@compass/core/passes';
import { CompassError } from '../ports/errors.js';
import type { PassesPort, SyncScope } from '../ports/passes-port.js';

/** What the adapter needs. */
export interface PassesAdapterDeps {
  client: CompassClient;
  store: PassStore;
  fs: FileSystem;
  appData: AppDataResolver;
  /** S4's clock: `now` and `sleep`. */
  clock: Clock;
  connections: ConnectionProvider;
  eventWindow(): Promise<EventWindow>;
  attendeeName?: string;
  platforms?: ('apple' | 'google')[];
}

/** Maps an S4 or client error onto a CompassError with a fixed code; anything else is rethrown. */
export function mapPassError(error: unknown): unknown {
  if (error instanceof PassClientError) {
    if (error.code === 'compass.rate_limited') {
      return new CompassError('RateLimited', {
        ...(error.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: error.retryAfterSeconds }),
      });
    }
    if (error.code === 'compass.no_id_token' || error.status === 401) {
      return new CompassError('NotSignedIn');
    }
  }
  return error instanceof PassError
    ? new CompassError('PassError', { summary: error.summary })
    : error;
}

/** A view of the store that only sees the passes for `codes` and writes the others back untouched. */
export function narrowStore(store: PassStore, codes: ReadonlySet<string>): PassStore {
  const inside = (pass: IssuedPass): boolean => codes.has(pass.sessionCode);
  return {
    read: async () => ({ passes: (await store.read()).passes.filter(inside) }),
    readWithSuperseded: async () => {
      const { record, superseded } = await store.readWithSuperseded();
      return {
        record: { passes: record.passes.filter(inside) },
        superseded: superseded.filter(inside),
      };
    },
    write: async (record) => {
      const untouched = (await store.read()).passes.filter((pass) => !inside(pass));
      await store.write({ passes: [...untouched, ...record.passes.filter(inside)] });
    },
    readPendingVoids: () => store.readPendingVoids(),
    writePendingVoids: (serials) => store.writePendingVoids(serials),
    deleteRecord: () => store.deleteRecord(),
    withLock: (fn) => store.withLock(fn),
    heartbeat: () => store.heartbeat(),
  };
}

/** Creates the passes port over the real S4. */
export function createPassesAdapter(deps: PassesAdapterDeps): PassesPort {
  const { client, store, clock } = deps;
  const platforms = deps.platforms ?? ['apple', 'google'];

  const builderFor = async (schedule: ScheduleView) =>
    buildPassFor(schedule, {
      connections: deps.connections,
      eventWindow: await deps.eventWindow(),
      ...(deps.attendeeName === undefined ? {} : { attendeeName: deps.attendeeName }),
    });

  const guard = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      throw mapPassError(error);
    }
  };

  const viewOf = (scope: SyncScope): PassStore =>
    scope.narrowCodes === undefined ? store : narrowStore(store, scope.narrowCodes);

  const idOf = (scope: SyncScope, code: string): string => scope.idByCode.get(code) ?? code;

  return {
    issue: (sessions: readonly NormalisedSession[], schedule) =>
      guard(async () => {
        const build = await builderFor(schedule);
        const fields = sessions.map((session) => build(session.code));
        const hashes = fields.map((f) => fieldsHash(f));
        return store.withLock(async () => {
          const issued: { sessionId: string; serialNumber: string }[] = [];
          const record = [...(await store.read()).passes];
          for (let start = 0; start < sessions.length; start += MAX_ISSUE_CHUNK) {
            const group = sessions.slice(start, start + MAX_ISSUE_CHUNK);
            await store.heartbeat();
            const response = await client.issuePasses({
              platforms,
              passes: fields.slice(start, start + MAX_ISSUE_CHUNK),
            });
            for (const [index, session] of group.entries()) {
              const answer = response.passes.find((p) => p.sessionCode === session.code);
              if (answer === undefined) {
                throw new PassError(
                  'issue.missing_answer',
                  'The pass service did not answer for every session.',
                );
              }
              const next: IssuedPass = {
                serialNumber: answer.serialNumber,
                sessionCode: session.code,
                fieldsHash: String(hashes[start + index]),
                platforms: answer.platforms,
              };
              const at = record.findIndex((p) => p.sessionCode === session.code);
              if (at === -1) {
                record.push(next);
              } else {
                record[at] = next;
              }
              issued.push({ sessionId: session.sessionId, serialNumber: answer.serialNumber });
            }
            await store.write({ passes: record });
          }
          return issued;
        });
      }),

    issuedRecord: () =>
      guard(async () =>
        (await store.read()).passes.map(({ sessionCode, serialNumber }) => ({
          sessionCode,
          serialNumber,
        })),
      ),

    handoff: (serials) =>
      guard(async () => {
        const created = { boardUrl: '', expiresAt: '' };
        const builder = createHandoffBuilder({
          client: {
            origin: client.origin,
            createHandoff: async (request) => {
              const response = await client.createHandoff(request);
              created.boardUrl = response.boardUrl;
              created.expiresAt = response.expiresAt;
              return response;
            },
          },
          clock,
        });
        const renders = await builder.handoff(serials, {
          apple: true,
          google: true,
          calendar: true,
        });
        return { ...renders, ...created };
      }),

    previewSync: (scope) =>
      guard(async () => {
        const build = await builderFor(scope.schedule);
        const record = await viewOf(scope).read();
        const plan = diffSchedule(
          { sessions: [...scope.resolved], scheduleConfirmed: true },
          record,
          build,
        );
        const codes = (diffCase: string) => plan.filter((entry) => entry.diffCase === diffCase);
        return {
          toIssue: codes('added').map((entry) => idOf(scope, entry.sessionCode)),
          toUpdate: codes('changed').map((entry) => idOf(scope, entry.sessionCode)),
          toVoid: codes('cancelled').map((entry) => ({
            sessionCode: entry.sessionCode,
            serialNumber: String(entry.serialNumber),
          })),
        };
      }),

    sync: (scope) =>
      guard(async () => {
        const result = await syncPasses(
          {
            sessions: [...scope.resolved],
            scheduleConfirmed: true,
            confirmEmpty: scope.confirmEmpty,
            allowBulkVoid: scope.allowBulkVoid,
          },
          { store: viewOf(scope), client, builder: await builderFor(scope.schedule), platforms },
        );
        const ids = (diffCase: string) =>
          result.plan
            .filter((entry) => entry.diffCase === diffCase)
            .map((entry) => idOf(scope, entry.sessionCode));
        return { issued: ids('added'), updated: ids('changed'), voided: ids('cancelled') };
      }),

    exportCalendar: (schedule) =>
      guard(async () => {
        const exporter = createIcsExporter({ fs: deps.fs, appData: deps.appData, clock });
        const itinerary = buildItinerary(schedule, deps.connections);
        const window = await deps.eventWindow();
        return {
          ics: exporter.buildCalendar(itinerary, window),
          path: await exporter.writeCalendar(itinerary, window),
        };
      }),

    forgetMe: () =>
      guard(async () => {
        const outcome = await forgetMe({
          client,
          store,
          fs: deps.fs,
          appData: deps.appData,
        });
        return outcome.localDataRemoved
          ? ({ ok: true } as const)
          : ({ ok: false, summary: outcome.copy } as const);
      }),
  };
}
