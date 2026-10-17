import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import type { PassFields } from '@compass/contracts';
import {
  createAppDataResolver,
  joinInFolder,
  RECORD_FILE_NAME,
} from '../../src/passes/app-data.js';
import { createCompassClient } from '../../src/passes/compass-client.js';
import type {
  CompassClient,
  UpdatePassResult,
  VoidPassResult,
} from '../../src/passes/compass-client.js';
import type {
  IssuePassesRequest,
  IssuePassesResponse,
} from '../../src/passes/compass-api-schemas.js';
import { fieldsHash } from '../../src/passes/field-hash.js';
import type { IssuedPass, IssuedPassRecord } from '../../src/passes/models.js';
import { buildPass } from '../../src/passes/pass-builder.js';
import {
  createPassStore,
  LOCK_FILE_NAME,
  PENDING_VOID_FILE_NAME,
} from '../../src/passes/pass-store.js';
import { diffSchedule, MAX_ISSUE_CHUNK, syncPasses } from '../../src/passes/pass-sync.js';
import { PassError, passError } from '../../src/passes/redaction.js';
import { memoryFs } from './memory-fs.js';
import { createContractMock } from './openapi-mock.js';
import {
  NUM_RUNS,
  WINDOW,
  fakeClock,
  fakeConnections,
  fakeIdToken,
  makeSession,
  TEST_HOSTS,
} from './support.js';

// Tests for Pass_Sync (boarding-passes, S4, Requirement 4). Properties 15, 16 and 17 run
// through fast-check over a fake CompassClient, so every call is observable. One example
// then runs the real builder, the real client over the contract mock and the real store.

const APP_DATA = createAppDataResolver({
  platform: 'linux',
  env: { XDG_DATA_HOME: '/home/ada/.local/share' },
  homeDir: '/home/ada',
});

function codeFor(n: number): string {
  return `CODE${String(n)}`;
}

/** The serial the fake client issues for a code, and the serial a stored record holds. */
function issuedSerial(code: string): string {
  return `00000000-0000-4000-8000-${code.replace('CODE', '').padStart(12, '0')}`;
}
function storedSerial(code: string): string {
  return `11111111-1111-4111-8111-${code.replace('CODE', '').padStart(12, '0')}`;
}

/** The pass the test builder produces for a code. */
function fieldsFor(code: string, version = 0): PassFields {
  return {
    sessionCode: code,
    title: `Title v${String(version)}`,
    venue: '',
    room: '',
    startsAt: '2026-12-01T10:00:00-08:00',
    endsAt: '2026-12-01T11:00:00-08:00',
  };
}

function storedPass(code: string, version: number): IssuedPass {
  return {
    serialNumber: storedSerial(code),
    sessionCode: code,
    fieldsHash: fieldsHash(fieldsFor(code, version)),
    platforms: ['apple'],
  };
}

type Call =
  | { kind: 'issue'; codes: string[]; platforms: string[] }
  | { kind: 'update'; serial: string; fields: PassFields }
  | { kind: 'void'; serial: string };

interface FakeClientOptions {
  gone?: Set<string>;
  omit?: Set<string>;
  issue?: (request: IssuePassesRequest) => Promise<IssuePassesResponse>;
  update?: (serial: string) => Promise<UpdatePassResult>;
  voidPass?: (serial: string) => Promise<VoidPassResult>;
}

function fakeClient(options: FakeClientOptions = {}): { client: CompassClient; calls: Call[] } {
  const calls: Call[] = [];
  const gone = options.gone ?? new Set<string>();
  const omit = options.omit ?? new Set<string>();
  const unused = (): Promise<never> => Promise.reject(new Error('not used by sync'));
  const client: CompassClient = {
    origin: 'https://d111111abcdef8.cloudfront.net',
    issuePasses(request) {
      calls.push({
        kind: 'issue',
        codes: request.passes.map((pass) => pass.sessionCode),
        platforms: request.platforms,
      });
      if (options.issue) {
        return options.issue(request);
      }
      return Promise.resolve({
        passes: request.passes
          .filter((pass) => !omit.has(pass.sessionCode))
          .map((pass) => ({
            serialNumber: issuedSerial(pass.sessionCode),
            sessionCode: pass.sessionCode,
            platforms: request.platforms,
          })),
      });
    },
    updatePass(serial, fields) {
      calls.push({ kind: 'update', serial, fields });
      if (options.update) {
        return options.update(serial);
      }
      return Promise.resolve(
        gone.has(serial)
          ? { outcome: 'gone' as const }
          : { outcome: 'updated' as const, response: { serialNumber: serial, version: 2 } },
      );
    },
    voidPass(serial) {
      calls.push({ kind: 'void', serial });
      if (options.voidPass) {
        return options.voidPass(serial);
      }
      return Promise.resolve(
        gone.has(serial)
          ? { outcome: 'gone' as const }
          : {
              outcome: 'voided' as const,
              response: { serialNumber: serial, status: 'voided' as const },
            },
      );
    },
    getApplePass: unused,
    createHandoff: unused,
    forgetMe: unused,
  };
  return { client, calls };
}

function storeWith(record?: IssuedPassRecord) {
  const fs = memoryFs();
  const store = createPassStore({ appData: APP_DATA, fs, clock: fakeClock() });
  return { fs, store, seed: () => (record ? store.write(record) : Promise.resolve()) };
}

function inputFor(
  codes: string[],
  extra: { confirmEmpty?: boolean; allowBulkVoid?: boolean } = {},
) {
  return {
    sessions: codes.map((code) => makeSession({ code })),
    scheduleConfirmed: true as const,
    confirmEmpty: true,
    allowBulkVoid: true,
    ...extra,
  };
}

function writesIn(ops: string[]): number {
  return ops.filter((op) => op.startsWith('rename ')).length;
}

/** A scenario: which codes are scheduled, which are recorded, and which recorded ones differ. */
const scenarioArb = fc
  .tuple(
    fc.uniqueArray(fc.integer({ min: 0, max: 99 }), { maxLength: 70 }),
    fc.uniqueArray(fc.integer({ min: 0, max: 99 }), { maxLength: 70 }),
    fc.uniqueArray(fc.integer({ min: 0, max: 99 }), { maxLength: 100 }),
    fc.uniqueArray(fc.integer({ min: 0, max: 99 }), { maxLength: 100 }),
    fc.uniqueArray(fc.integer({ min: 0, max: 99 }), { maxLength: 100 }),
  )
  .map(([scheduled, recorded, differs, gone, omit]) => ({
    scheduled: scheduled.map(codeFor),
    recorded: recorded.map(codeFor),
    differs: new Set(differs.map(codeFor)),
    gone: new Set(gone.map((n) => storedSerial(codeFor(n)))),
    omit: new Set(omit.map(codeFor)),
  }));

function recordOf(scenario: { recorded: string[]; differs: Set<string> }): IssuedPassRecord {
  return {
    passes: scenario.recorded.map((code) => storedPass(code, scenario.differs.has(code) ? 1 : 0)),
  };
}

describe('Feature: boarding-passes, Property 15: diff partitions sessions into exactly one case', () => {
  test('every code in the union lands in exactly one case, as the rules define', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const plan = diffSchedule(inputFor(scenario.scheduled), recordOf(scenario), (code) =>
          fieldsFor(code),
        );

        const union = new Set([...scenario.scheduled, ...scenario.recorded]);
        expect(plan.map((entry) => entry.sessionCode).sort()).toEqual([...union].sort());
        expect(new Set(plan.map((entry) => entry.sessionCode)).size).toBe(plan.length);

        const scheduled = new Set(scenario.scheduled);
        const recorded = new Set(scenario.recorded);
        for (const entry of plan) {
          const code = entry.sessionCode;
          const expected =
            scheduled.has(code) && !recorded.has(code)
              ? 'added'
              : !scheduled.has(code)
                ? 'cancelled'
                : scenario.differs.has(code)
                  ? 'changed'
                  : 'unchanged';
          expect(entry.diffCase).toBe(expected);
          if (expected === 'added') {
            expect(entry.serialNumber).toBeUndefined();
          } else {
            expect(entry.serialNumber).toBe(storedSerial(code));
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test('a code listed twice counts once, at its first occurrence', () => {
    const duplicate = { ...storedPass('CODE1', 0), serialNumber: storedSerial('CODE9') };
    const plan = diffSchedule(
      inputFor(['CODE1', 'CODE1', 'CODE2']),
      { passes: [storedPass('CODE1', 0), duplicate] },
      (code) => fieldsFor(code),
    );
    expect(plan).toEqual([
      { sessionCode: 'CODE1', serialNumber: storedSerial('CODE1'), diffCase: 'unchanged' },
      { sessionCode: 'CODE2', diffCase: 'added' },
    ]);
  });
});

describe('Feature: boarding-passes, Property 16: sync drives the correct call per case and persists the post-state', () => {
  test('issue in chunks, update changed, void cancelled, nothing for unchanged, and persist', async () => {
    await fc.assert(
      fc.asyncProperty(
        scenarioArb,
        fc.constantFrom<('apple' | 'google')[]>(['apple'], ['google'], ['apple', 'google']),
        async (scenario, platforms) => {
          const record = recordOf(scenario);
          const { fs, store, seed } = storeWith(record);
          await seed();
          fs.ops.length = 0;
          const { client, calls } = fakeClient({ gone: scenario.gone });

          const result = await syncPasses(inputFor(scenario.scheduled), {
            store,
            client,
            builder: (code) => fieldsFor(code),
            platforms: platforms,
          });

          const scheduled = new Set(scenario.scheduled);
          const recorded = new Set(scenario.recorded);
          const added = scenario.scheduled.filter((code) => !recorded.has(code));
          const changed = scenario.scheduled.filter(
            (code) => recorded.has(code) && scenario.differs.has(code),
          );
          const cancelled = scenario.recorded.filter((code) => !scheduled.has(code));

          // Calls: issue chunks of at most 25 in order, then PUTs, then voids.
          const issues = calls.filter((call) => call.kind === 'issue');
          expect(issues).toHaveLength(Math.ceil(added.length / MAX_ISSUE_CHUNK));
          for (const call of issues) {
            expect(call.codes.length).toBeLessThanOrEqual(MAX_ISSUE_CHUNK);
            expect(call.platforms).toEqual(platforms);
          }
          expect(issues.flatMap((call) => call.codes)).toEqual(added);
          expect(calls.filter((call) => call.kind === 'update')).toEqual(
            changed.map((code) => ({
              kind: 'update',
              serial: storedSerial(code),
              fields: fieldsFor(code),
            })),
          );
          expect(calls.filter((call) => call.kind === 'void')).toEqual(
            cancelled.map((code) => ({ kind: 'void', serial: storedSerial(code) })),
          );
          expect(calls).toHaveLength(result.calls);

          // The post-state: unchanged kept, changed re-hashed (or dropped when gone), cancelled
          // dropped, added appended with the serial and platforms the server answered.
          const expected: IssuedPass[] = [];
          for (const code of scenario.recorded) {
            if (!scheduled.has(code)) continue;
            if (scenario.differs.has(code)) {
              if (scenario.gone.has(storedSerial(code))) continue;
              expected.push({ ...storedPass(code, 1), fieldsHash: fieldsHash(fieldsFor(code)) });
            } else {
              expected.push(storedPass(code, 0));
            }
          }
          for (const code of added) {
            expected.push({
              serialNumber: issuedSerial(code),
              sessionCode: code,
              fieldsHash: fieldsHash(fieldsFor(code)),
              platforms: platforms,
            });
          }
          expect(result.record).toEqual({ passes: expected });
          expect(await store.read()).toEqual({ passes: expected });
          expect(writesIn(fs.ops)).toBe(result.calls);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  test('a changed pass the server no longer has, and a cancelled one, are dropped without error', async () => {
    const { store, seed } = storeWith({ passes: [storedPass('CODE1', 1), storedPass('CODE2', 0)] });
    await seed();
    const { client } = fakeClient({
      gone: new Set([storedSerial('CODE1'), storedSerial('CODE2')]),
    });
    const result = await syncPasses(inputFor(['CODE1']), {
      store,
      client,
      builder: (code) => fieldsFor(code),
      platforms: ['apple'],
    });
    expect(result.record).toEqual({ passes: [] });
    expect(result.calls).toBe(2);
  });

  test('a session the server did not answer for is recorded as far as it came back, then reported', async () => {
    const { store } = storeWith();
    const { client } = fakeClient({ omit: new Set(['CODE1']) });
    const input = inputFor(['CODE1', 'CODE2']);
    await expect(
      syncPasses(input, {
        store,
        client,
        builder: (code) => fieldsFor(code),
        platforms: ['apple'],
      }),
    ).rejects.toMatchObject({
      code: 'sync.partial_issue',
      message: expect.stringContaining('1 of 2') as string,
    });
    expect((await store.read()).passes.map((pass) => pass.sessionCode)).toEqual(['CODE2']);
  });

  test('progress already made is kept when a later call fails', async () => {
    const { store, seed } = storeWith({ passes: [storedPass('CODE1', 1)] });
    await seed();
    const { client } = fakeClient();
    const failing: CompassClient = {
      ...client,
      updatePass: () =>
        Promise.reject(passError('compass.http_error', 'The Compass API answered 502.')),
    };
    await expect(
      syncPasses(inputFor(['CODE1', 'CODE2']), {
        store,
        client: failing,
        builder: (code) => fieldsFor(code),
        platforms: ['apple'],
      }),
    ).rejects.toBeInstanceOf(PassError);
    const kept = await store.read();
    expect(kept.passes.map((pass) => pass.sessionCode)).toEqual(['CODE1', 'CODE2']);
  });

  test('a session that cannot be built stops the sync before any call is made', async () => {
    const { store, seed } = storeWith({ passes: [storedPass('CODE9', 0)] });
    await seed();
    const { client, calls } = fakeClient();
    await expect(
      syncPasses(inputFor(['CODE1', 'CODE2']), {
        store,
        client,
        builder: (code) => {
          if (code === 'CODE2')
            throw passError('builder.invalid_input', 'The session has no start or end time.');
          return fieldsFor(code);
        },
        platforms: ['apple'],
      }),
    ).rejects.toBeInstanceOf(PassError);
    expect(calls).toEqual([]);
    expect((await store.read()).passes.map((pass) => pass.sessionCode)).toEqual(['CODE9']);
  });
});

describe('Feature: boarding-passes, Property 17: idempotent re-run makes no calls and leaves the record unchanged', () => {
  test('a schedule that matches the record causes no call and no write', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.integer({ min: 0, max: 99 }), { maxLength: 60 }),
        async (numbers) => {
          const codes = numbers.map(codeFor);
          const record: IssuedPassRecord = { passes: codes.map((code) => storedPass(code, 0)) };
          const { fs, store, seed } = storeWith(record);
          await seed();
          fs.ops.length = 0;
          const { client, calls } = fakeClient();

          const result = await syncPasses(inputFor(codes), {
            store,
            client,
            builder: (code) => fieldsFor(code),
            platforms: ['apple'],
          });

          expect(calls).toEqual([]);
          expect(result.calls).toBe(0);
          expect(result.record).toEqual(record);
          expect(result.plan.every((entry) => entry.diffCase === 'unchanged')).toBe(true);
          expect(writesIn(fs.ops)).toBe(0);
          expect(await store.read()).toEqual(record);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('Feature: boarding-passes, sync end to end over the real builder, client and store', () => {
  test('issue, then no-op, then update after a change, then void after a cancellation', async () => {
    const mock = createContractMock();
    let counter = 0;
    // The sync checks that an update and a void answer for the serial asked about, so the
    // mock echoes it from the request URL.
    const serialOf = (url: string) => /passes\/([0-9a-f-]{36})/.exec(url)?.[1] ?? '';
    mock.handle('updatePass', (request) => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serialNumber: serialOf(request.url), version: 2 }),
    }));
    mock.handle('voidPass', (request) => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serialNumber: serialOf(request.url), status: 'voided' }),
    }));
    mock.handle('issuePasses', (request) => {
      const body = request.body as { platforms: string[]; passes: { sessionCode: string }[] };
      const passes = body.passes.map((pass) => {
        counter += 1;
        return {
          serialNumber: `22222222-2222-4222-8222-${String(counter).padStart(12, '0')}`,
          sessionCode: pass.sessionCode,
          platforms: body.platforms,
        };
      });
      return {
        status: 201,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ passes }),
      };
    });
    const client = createCompassClient({
      baseUrl: 'https://d111111abcdef8.cloudfront.net',
      allowedHosts: TEST_HOSTS,
      transport: mock,
      clock: fakeClock(),
      idToken: { getIdToken: () => Promise.resolve(fakeIdToken('attendee')) },
    });
    const { fs, store } = storeWith();

    const sessions = [
      makeSession({ code: 'DVT301', sessionId: 's1' }),
      makeSession({
        code: 'NET204',
        sessionId: 's2',
        startsAt: '2026-12-01T13:00:00-08:00',
        endsAt: '2026-12-01T14:00:00-08:00',
      }),
    ];
    const sync = (current: typeof sessions) =>
      syncPasses(
        { sessions: current, scheduleConfirmed: true },
        {
          store,
          client,
          platforms: ['apple', 'google'],
          builder: (code) =>
            buildPass(
              { session: current.find((session) => session.code === code)!, eventWindow: WINDOW },
              { connections: fakeConnections() },
            ).fields,
        },
      );

    const first = await sync(sessions);
    expect(first.calls).toBe(1);
    expect(first.record.passes.map((pass) => pass.sessionCode)).toEqual(['DVT301', 'NET204']);

    const writesBefore = writesIn(fs.ops);
    const second = await sync(sessions);
    expect(second.calls).toBe(0);
    expect(writesIn(fs.ops)).toBe(writesBefore);

    const moved = [
      makeSession({ code: 'DVT301', sessionId: 's1', room: 'Level 3' }),
      sessions[1] as never,
    ];
    const third = await sync(moved);
    expect(third.plan.map((entry) => entry.diffCase)).toEqual(['changed', 'unchanged']);
    expect(third.calls).toBe(1);

    const fourth = await sync([moved[0]]);
    expect(fourth.plan.map((entry) => entry.diffCase)).toEqual(['unchanged', 'cancelled']);
    expect(fourth.record.passes.map((pass) => pass.sessionCode)).toEqual(['DVT301']);

    expect(mock.requests.map((request) => request.operationId)).toEqual([
      'issuePasses',
      'updatePass',
      'voidPass',
    ]);
    for (const request of mock.requests) {
      expect(request.violations).toEqual([]);
    }
  });
});

// ----- Review round 1: safety rules, compensation, identity and duplicates ---------------

const RECORD_PATH = joinInFolder(APP_DATA.resolve(), RECORD_FILE_NAME);
const LOCK_PATH = joinInFolder(APP_DATA.resolve(), LOCK_FILE_NAME);

function depsFor(store: ReturnType<typeof storeWith>['store'], client: CompassClient) {
  return {
    store,
    client,
    builder: (code: string) => fieldsFor(code),
    platforms: ['apple' as const],
  };
}

/** A store seeded with a record, returning how many renames (record writes) have happened since. */
async function seeded(record: IssuedPassRecord) {
  const rig = storeWith(record);
  await rig.seed();
  rig.fs.ops.length = 0;
  return rig;
}

function codes(count: number, prefix = 'CODE'): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1)}`);
}

function recordFor(list: string[], version = 0): IssuedPassRecord {
  return { passes: list.map((code) => storedPass(code, version)) };
}

async function failureOf(promise: Promise<unknown>): Promise<PassError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(PassError);
    return error as PassError;
  }
  throw new Error('expected the call to fail');
}

describe('Feature: boarding-passes, the schedule must be confirmed and mass voids need confirmation (QA H3)', () => {
  test('a sync without scheduleConfirmed changes nothing and makes no call', async () => {
    const { store, fs } = await seeded(recordFor(['CODE1']));
    const { client, calls } = fakeClient();
    const unconfirmed = { ...inputFor(['CODE2']), scheduleConfirmed: false } as never;
    const error = await failureOf(syncPasses(unconfirmed, depsFor(store, client)));
    expect(error.code).toBe('sync.schedule_unconfirmed');
    expect(calls).toEqual([]);
    expect(writesIn(fs.ops)).toBe(0);
  });

  test('an empty list against a non-empty record is refused without confirmEmpty', async () => {
    const { store, fs } = await seeded(recordFor(['CODE1']));
    const { client, calls } = fakeClient();
    const error = await failureOf(
      syncPasses(inputFor([], { confirmEmpty: false }), depsFor(store, client)),
    );
    expect(error.code).toBe('sync.empty_schedule_refused');
    expect(error.message).toContain('1 pass(es)');
    expect(calls).toEqual([]);
    expect(writesIn(fs.ops)).toBe(0);
    expect((await store.read()).passes).toHaveLength(1);
  });

  test('confirmEmpty lets a small record be voided, and an empty list against an empty record is fine', async () => {
    const { store } = await seeded(recordFor(['CODE1']));
    const { client, calls } = fakeClient();
    const result = await syncPasses(
      inputFor([], { confirmEmpty: true, allowBulkVoid: false }),
      depsFor(store, client),
    );
    expect(calls.map((call) => call.kind)).toEqual(['void']);
    expect(result.record.passes).toEqual([]);

    const again = await syncPasses(
      inputFor([], { confirmEmpty: false, allowBulkVoid: false }),
      depsFor(store, fakeClient().client),
    );
    expect(again.calls).toBe(0);
  });

  test('more than five voids need allowBulkVoid, and the refusal comes before any call', async () => {
    const { store, fs } = await seeded(recordFor(codes(6)));
    const { client, calls } = fakeClient();
    const error = await failureOf(
      syncPasses(inputFor(['CODE90'], { allowBulkVoid: false }), depsFor(store, client)),
    );
    expect(error.code).toBe('sync.bulk_void_refused');
    expect(error.message).toContain('6 passes');
    expect(calls).toEqual([]);
    expect(writesIn(fs.ops)).toBe(0);
    expect((await store.read()).passes).toHaveLength(6);
  });

  test('exactly five voids are allowed without the flag, and six with it', async () => {
    const five = await seeded(recordFor(codes(5)));
    const fiveClient = fakeClient();
    const fiveResult = await syncPasses(
      inputFor(['CODE90'], { allowBulkVoid: false }),
      depsFor(five.store, fiveClient.client),
    );
    expect(fiveClient.calls.filter((call) => call.kind === 'void')).toHaveLength(5);
    expect(fiveResult.record.passes.map((pass) => pass.sessionCode)).toEqual(['CODE90']);

    const six = await seeded(recordFor(codes(6)));
    const sixClient = fakeClient();
    await syncPasses(
      inputFor(['CODE90'], { allowBulkVoid: true }),
      depsFor(six.store, sixClient.client),
    );
    expect(sixClient.calls.filter((call) => call.kind === 'void')).toHaveLength(6);
  });

  test('superseded duplicates count toward the bulk-void limit', async () => {
    const rig = storeWith();
    const lines = [...codes(6), ...codes(6)].map((code, i) => ({
      ...storedPass(code, 0),
      serialNumber: storedSerial(`CODE${String(i + 1)}`),
    }));
    rig.fs.files.set(RECORD_PATH, JSON.stringify({ passes: lines }));
    const { client, calls } = fakeClient();
    const error = await failureOf(
      syncPasses(inputFor(codes(6), { allowBulkVoid: false }), depsFor(rig.store, client)),
    );
    expect(error.code).toBe('sync.bulk_void_refused');
    expect(calls).toEqual([]);
    expect(error.message).toContain('6 passes');
  });
});

describe('Feature: boarding-passes, no orphaned pass when the record cannot be saved (QA H1)', () => {
  test('a failed save after an issue voids the just-issued passes again and says so', async () => {
    const { store, fs } = await seeded({ passes: [] });
    fs.failing.add('rename');
    const { client, calls } = fakeClient();
    const error = await failureOf(syncPasses(inputFor(['CODE1', 'CODE2']), depsFor(store, client)));
    expect(error.code).toBe('sync.store_failed');
    expect(error.message).toContain('2 just-issued pass(es) were voided again.');
    expect(error.message).not.toContain('example.com');
    expect(calls.map((call) => call.kind)).toEqual(['issue', 'void', 'void']);
    expect(calls.filter((call) => call.kind === 'void').map((call) => call.serial)).toEqual([
      issuedSerial('CODE1'),
      issuedSerial('CODE2'),
    ]);
    fs.failing.clear();
    expect((await store.read()).passes).toEqual([]);
  });

  test('a compensating void that fails is counted, not hidden', async () => {
    const { store, fs } = await seeded({ passes: [] });
    fs.failing.add('rename');
    const { client } = fakeClient({
      voidPass: (serial) =>
        serial === issuedSerial('CODE1')
          ? Promise.reject(new Error('network down'))
          : Promise.resolve({
              outcome: 'voided' as const,
              response: { serialNumber: serial, status: 'voided' as const },
            }),
    });
    const error = await failureOf(syncPasses(inputFor(['CODE1', 'CODE2']), depsFor(store, client)));
    expect(error.code).toBe('sync.store_failed');
    expect(error.message).toContain(
      '1 just-issued pass(es) were voided again, and 1 could not be voided and will be retried on the next sync.',
    );
    expect(error.message).not.toContain('network down');
  });

  test('a failed save after an update or a void is a fixed store error with no compensation', async () => {
    for (const [schedule, kind] of [
      [['CODE1'], 'update'],
      [['CODE90'], 'void'],
    ] as const) {
      const { store, fs } = await seeded(recordFor(['CODE1'], schedule[0] === 'CODE1' ? 1 : 0));
      fs.failing.add('rename');
      const { client, calls } = fakeClient();
      const error = await failureOf(syncPasses(inputFor([...schedule]), depsFor(store, client)));
      expect(error.code).toBe('sync.store_failed');
      expect(calls.some((call) => call.kind === kind)).toBe(true);
      expect(calls.filter((call) => call.kind === 'void')).toHaveLength(kind === 'void' ? 1 : 0);
    }
  });
});

describe('Feature: boarding-passes, the sync does not trust the identity in a response (security M4)', () => {
  async function refusedIssue(
    answer: IssuePassesResponse,
    record: IssuedPassRecord = { passes: [] },
  ) {
    const { store, fs } = await seeded(record);
    const { client, calls } = fakeClient({ issue: () => Promise.resolve(answer) });
    const error = await failureOf(syncPasses(inputFor(['CODE1', 'CODE2']), depsFor(store, client)));
    expect(error.code).toBe('sync.identity_mismatch');
    expect(error.message).toContain('forget_me');
    expect(writesIn(fs.ops)).toBe(0);
    expect(calls.map((call) => call.kind)).toEqual(['issue']);
    expect((await store.read()).passes).toEqual(record.passes);
  }
  const answer = (code: string, serial: string) => ({
    serialNumber: serial,
    sessionCode: code,
    platforms: ['apple' as const],
  });

  test('an answer for a code that was not requested records nothing for the chunk', async () => {
    await refusedIssue({
      passes: [answer('CODE1', issuedSerial('CODE1')), answer('OTHER9', issuedSerial('CODE2'))],
    });
  });

  test('an answer repeated for the same code records nothing for the chunk', async () => {
    await refusedIssue({
      passes: [answer('CODE1', issuedSerial('CODE1')), answer('CODE1', issuedSerial('CODE2'))],
    });
  });

  test('a serial already in the record, or repeated in the answer, records nothing for the chunk', async () => {
    await refusedIssue(
      { passes: [answer('CODE1', storedSerial('CODE9')), answer('CODE2', issuedSerial('CODE2'))] },
      recordFor(['CODE9']),
    );
    await refusedIssue({
      passes: [answer('CODE1', issuedSerial('CODE1')), answer('CODE2', issuedSerial('CODE1'))],
    });
  });

  test('an update or a void that answers for another serial changes nothing', async () => {
    const wrong = issuedSerial('CODE5');
    const update = await seeded(recordFor(['CODE1'], 1));
    const updateClient = fakeClient({
      update: () =>
        Promise.resolve({
          outcome: 'updated' as const,
          response: { serialNumber: wrong, version: 3 },
        }),
    });
    expect(
      (await failureOf(syncPasses(inputFor(['CODE1']), depsFor(update.store, updateClient.client))))
        .code,
    ).toBe('sync.identity_mismatch');
    expect(writesIn(update.fs.ops)).toBe(0);

    const cancelled = await seeded(recordFor(['CODE1', 'CODE2']));
    const voidClient = fakeClient({
      voidPass: () =>
        Promise.resolve({
          outcome: 'voided' as const,
          response: { serialNumber: wrong, status: 'voided' as const },
        }),
    });
    expect(
      (
        await failureOf(
          syncPasses(inputFor(['CODE1']), depsFor(cancelled.store, voidClient.client)),
        )
      ).code,
    ).toBe('sync.identity_mismatch');
    expect(writesIn(cancelled.fs.ops)).toBe(0);
    expect((await cancelled.store.read()).passes).toHaveLength(2);
  });

  test('record entries are matched on both code and serial', async () => {
    const shared = storedSerial('CODE1');
    const record: IssuedPassRecord = {
      passes: [
        { ...storedPass('CODE1', 0), serialNumber: shared },
        { ...storedPass('CODE2', 0), serialNumber: shared },
      ],
    };
    const { store } = await seeded(record);
    const { client } = fakeClient();
    const result = await syncPasses(inputFor(['CODE2']), depsFor(store, client));
    expect(result.record.passes.map((pass) => pass.sessionCode)).toEqual(['CODE2']);
  });
});

describe('Feature: boarding-passes, one pass per session code and the lock (QA M5, M4)', () => {
  const duplicate = (code: string, older: string, newer: string) => [
    { ...storedPass(code, 0), serialNumber: older },
    { ...storedPass(code, 0), serialNumber: newer },
  ];

  test('an older duplicate is voided first, the record is rewritten, and nothing else is touched', async () => {
    const rig = storeWith();
    const older = storedSerial('CODE8');
    const newer = storedSerial('CODE1');
    rig.fs.files.set(RECORD_PATH, JSON.stringify({ passes: duplicate('CODE1', older, newer) }));
    const { client, calls } = fakeClient();
    const result = await syncPasses(inputFor(['CODE1']), depsFor(rig.store, client));
    expect(calls).toEqual([{ kind: 'void', serial: older }]);
    expect(result.record.passes.map((pass) => pass.serialNumber)).toEqual([newer]);
    expect(writesIn(rig.fs.ops)).toBe(1);
    expect(JSON.parse(rig.fs.files.get(RECORD_PATH) ?? '{}')).toEqual({
      passes: [storedPass('CODE1', 0)],
    });
  });

  test('every serial for a cancelled code is voided, the older ones first', async () => {
    const rig = storeWith();
    const older = storedSerial('CODE8');
    const newer = storedSerial('CODE1');
    rig.fs.files.set(RECORD_PATH, JSON.stringify({ passes: duplicate('CODE1', older, newer) }));
    const { client, calls } = fakeClient();
    const result = await syncPasses(inputFor(['CODE90']), depsFor(rig.store, client));
    expect(calls.filter((call) => call.kind === 'void').map((call) => call.serial)).toEqual([
      older,
      newer,
    ]);
    expect(result.record.passes.map((pass) => pass.sessionCode)).toEqual(['CODE90']);
  });

  test('a void of an older duplicate that fails leaves the duplicates in the file for the next run', async () => {
    const rig = storeWith();
    rig.fs.files.set(
      RECORD_PATH,
      JSON.stringify({ passes: duplicate('CODE1', storedSerial('CODE8'), storedSerial('CODE1')) }),
    );
    const { client } = fakeClient({
      voidPass: () => Promise.reject(passError('compass.transport_failed', 'down')),
    });
    await expect(
      syncPasses(inputFor(['CODE1']), depsFor(rig.store, client)),
    ).rejects.toBeInstanceOf(PassError);
    expect(
      (JSON.parse(rig.fs.files.get(RECORD_PATH) ?? '{}') as IssuedPassRecord).passes,
    ).toHaveLength(2);
  });

  test('a void of an older duplicate that answers for another serial is refused', async () => {
    const rig = storeWith();
    rig.fs.files.set(
      RECORD_PATH,
      JSON.stringify({ passes: duplicate('CODE1', storedSerial('CODE8'), storedSerial('CODE1')) }),
    );
    const { client } = fakeClient({
      voidPass: () =>
        Promise.resolve({
          outcome: 'voided' as const,
          response: { serialNumber: issuedSerial('CODE3'), status: 'voided' as const },
        }),
    });
    expect(
      (await failureOf(syncPasses(inputFor(['CODE1']), depsFor(rig.store, client)))).code,
    ).toBe('sync.identity_mismatch');
  });

  test('the whole run holds the store lock and releases it afterwards', async () => {
    const { store, fs } = await seeded(recordFor(['CODE1'], 1));
    const lockSeen: boolean[] = [];
    const { client } = fakeClient({
      update: (serial) => {
        lockSeen.push(fs.files.has(LOCK_PATH));
        return Promise.resolve({
          outcome: 'updated' as const,
          response: { serialNumber: serial, version: 2 },
        });
      },
    });
    await syncPasses(inputFor(['CODE1']), depsFor(store, client));
    expect(lockSeen).toEqual([true]);
    expect(fs.files.has(LOCK_PATH)).toBe(false);
  });
});

describe('Feature: boarding-passes, the lock is refreshed before every API call (QA N1)', () => {
  test('one heartbeat per call, and a lock taken over mid-run stops the sync before the next call', async () => {
    const { store, fs } = await seeded(recordFor(['CODE1'], 1));
    const { client, calls } = fakeClient();
    await syncPasses(inputFor(['CODE1', 'CODE2']), depsFor(store, client));
    expect(calls).toHaveLength(2);
    expect(fs.ops.filter((op) => op === `writeFile ${LOCK_PATH}`)).toHaveLength(2);

    const rig = await seeded(recordFor(['CODE1'], 1));
    const stolen = fakeClient({
      issue: (request) => {
        rig.fs.files.set(LOCK_PATH, 'taker-token-bbbb 1000050');
        return Promise.resolve({
          passes: request.passes.map((pass) => ({
            serialNumber: issuedSerial(pass.sessionCode),
            sessionCode: pass.sessionCode,
            platforms: request.platforms,
          })),
        });
      },
    });
    const error = await failureOf(
      syncPasses(inputFor(['CODE1', 'CODE2']), depsFor(rig.store, stolen.client)),
    );
    expect(error.code).toBe('store.lock_lost');
    expect(stolen.calls.map((call) => call.kind)).toEqual(['issue']);
  });
});

describe('Feature: boarding-passes, a failed compensating void is queued and retried first (QA N2, N3)', () => {
  const PENDING_PATH = joinInFolder(APP_DATA.resolve(), PENDING_VOID_FILE_NAME);

  /** An issue whose record save fails, with the first compensating void failing too. */
  async function leaveOnePending() {
    const rig = await seeded({ passes: [] });
    rig.fs.failing.add('rename');
    const first = fakeClient({
      voidPass: (serial) =>
        serial === issuedSerial('CODE1')
          ? Promise.reject(new Error('network down'))
          : Promise.resolve({
              outcome: 'voided' as const,
              response: { serialNumber: serial, status: 'voided' as const },
            }),
    });
    const error = await failureOf(
      syncPasses(inputFor(['CODE1', 'CODE2']), depsFor(rig.store, first.client)),
    );
    rig.fs.failing.clear();
    return { ...rig, error };
  }

  test('the serial whose void failed is written to the pending-void file with mode 0600', async () => {
    const { fs, error, store } = await leaveOnePending();
    expect(error.message).toContain('1 could not be voided and will be retried on the next sync');
    expect(JSON.parse(fs.files.get(PENDING_PATH) ?? '{}')).toEqual({
      serials: [issuedSerial('CODE1')],
    });
    expect(fs.modes.get(PENDING_PATH)).toBe(0o600);
    expect(await store.readPendingVoids()).toEqual([issuedSerial('CODE1')]);
  });

  test('the next sync voids the pending serial first, clears the file, then carries on', async () => {
    const { fs, store } = await leaveOnePending();
    const { client, calls } = fakeClient();
    const result = await syncPasses(inputFor(['CODE1']), depsFor(store, client));
    expect(calls.map((call) => call.kind)).toEqual(['void', 'issue']);
    expect(calls[0]).toEqual({ kind: 'void', serial: issuedSerial('CODE1') });
    expect(fs.files.has(PENDING_PATH)).toBe(false);
    expect(result.record.passes.map((pass) => pass.sessionCode)).toEqual(['CODE1']);
  });

  test('with nothing else to do, the pending void is still retried and counted', async () => {
    const { store } = await leaveOnePending();
    const { client, calls } = fakeClient();
    const result = await syncPasses(inputFor([]), depsFor(store, client));
    expect(result.calls).toBe(1);
    expect(calls).toEqual([{ kind: 'void', serial: issuedSerial('CODE1') }]);
    expect(await store.readPendingVoids()).toEqual([]);
  });

  test('a pending void that fails again, or answers for another serial, stays queued', async () => {
    const { fs, store } = await leaveOnePending();
    const failing = fakeClient({ voidPass: () => Promise.reject(new Error('still down')) });
    await expect(syncPasses(inputFor([]), depsFor(store, failing.client))).rejects.toThrow();
    expect(fs.files.has(PENDING_PATH)).toBe(true);
    const wrong = fakeClient({
      voidPass: () =>
        Promise.resolve({
          outcome: 'voided' as const,
          response: { serialNumber: issuedSerial('CODE9'), status: 'voided' as const },
        }),
    });
    expect((await failureOf(syncPasses(inputFor([]), depsFor(store, wrong.client)))).code).toBe(
      'sync.identity_mismatch',
    );
    expect(await store.readPendingVoids()).toEqual([issuedSerial('CODE1')]);
  });

  test('a pending list that cannot be updated after a void is a fixed store error', async () => {
    const { fs, store } = await leaveOnePending();
    const realRemove = fs.remove.bind(fs);
    fs.remove = (path) =>
      path === PENDING_PATH
        ? Promise.reject(new Error('disk full at secret.user@example.com'))
        : realRemove(path);
    const { client } = fakeClient();
    const error = await failureOf(syncPasses(inputFor([]), depsFor(store, client)));
    expect(error.code).toBe('sync.store_failed');
    expect(error.message).not.toContain('example.com');
  });

  test('when the retry cannot even be queued, the error says so', async () => {
    const rig = await seeded({ passes: [] });
    rig.fs.failing.add('rename');
    const realWrite = rig.fs.writeFile.bind(rig.fs);
    rig.fs.writeFile = (path, data, mode) =>
      path === PENDING_PATH ? Promise.reject(new Error('disk full')) : realWrite(path, data, mode);
    const { client } = fakeClient({ voidPass: () => Promise.reject(new Error('network down')) });
    const error = await failureOf(syncPasses(inputFor(['CODE1']), depsFor(rig.store, client)));
    expect(error.code).toBe('sync.store_failed');
    expect(error.message).toContain('1 could not be voided and could not be queued for a retry');
  });

  test('pending voids already on file stay queued when the first retry fails', async () => {
    const rig = await seeded({ passes: [] });
    rig.fs.files.set(PENDING_PATH, JSON.stringify({ serials: [issuedSerial('CODE7')] }));
    const { client } = fakeClient({ voidPass: () => Promise.reject(new Error('down')) });
    await expect(syncPasses(inputFor(['CODE1']), depsFor(rig.store, client))).rejects.toThrow();
    expect(await rig.store.readPendingVoids()).toEqual([issuedSerial('CODE7')]);
  });

  test('new stuck serials are added to the ones already waiting', async () => {
    // A pending serial that voids fine is removed; the new stuck one is then the only entry.
    const rig = await seeded({ passes: [] });
    rig.fs.files.set(PENDING_PATH, JSON.stringify({ serials: [issuedSerial('CODE7')] }));
    rig.fs.failing.add('rename');
    const { client } = fakeClient({
      voidPass: (serial) =>
        serial === issuedSerial('CODE7')
          ? Promise.resolve({
              outcome: 'voided' as const,
              response: { serialNumber: serial, status: 'voided' as const },
            })
          : Promise.reject(new Error('down')),
    });
    const error = await failureOf(syncPasses(inputFor(['CODE1']), depsFor(rig.store, client)));
    expect(error.code).toBe('sync.store_failed');
    expect(await rig.store.readPendingVoids()).toEqual([issuedSerial('CODE1')]);
  });
});

describe('Feature: boarding-passes, returned platforms must be a subset of the requested ones (security M4)', () => {
  test('an issue answer naming a platform that was not requested records nothing', async () => {
    const { store, fs } = await seeded({ passes: [] });
    const { client, calls } = fakeClient({
      issue: (request) =>
        Promise.resolve({
          passes: request.passes.map((pass) => ({
            serialNumber: issuedSerial(pass.sessionCode),
            sessionCode: pass.sessionCode,
            platforms: ['apple' as const, 'google' as const],
          })),
        }),
    });
    const error = await failureOf(syncPasses(inputFor(['CODE1']), depsFor(store, client)));
    expect(error.code).toBe('sync.identity_mismatch');
    expect(error.message).toContain('forget_me');
    expect(writesIn(fs.ops)).toBe(0);
    expect(calls.map((call) => call.kind)).toEqual(['issue']);
  });

  test('fewer platforms than requested is fine, and an empty list too', async () => {
    const { store } = await seeded({ passes: [] });
    const { client } = fakeClient({
      issue: (request) =>
        Promise.resolve({
          passes: request.passes.map((pass, index) => ({
            serialNumber: issuedSerial(pass.sessionCode),
            sessionCode: pass.sessionCode,
            platforms: index === 0 ? ['apple' as const] : [],
          })),
        }),
    });
    const result = await syncPasses(inputFor(['CODE1', 'CODE2']), {
      ...depsFor(store, client),
      platforms: ['apple', 'google'],
    });
    expect(result.record.passes.map((pass) => pass.platforms)).toEqual([['apple'], []]);
  });
});
