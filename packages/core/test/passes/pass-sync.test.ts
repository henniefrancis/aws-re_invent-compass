import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import type { PassFields } from '@compass/contracts';
import { createAppDataResolver } from '../../src/passes/app-data.js';
import { createCompassClient } from '../../src/passes/compass-client.js';
import type { CompassClient } from '../../src/passes/compass-client.js';
import { fieldsHash } from '../../src/passes/field-hash.js';
import type { IssuedPass, IssuedPassRecord } from '../../src/passes/models.js';
import { buildPass } from '../../src/passes/pass-builder.js';
import { createPassStore } from '../../src/passes/pass-store.js';
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
}

function fakeClient(options: FakeClientOptions = {}): { client: CompassClient; calls: Call[] } {
  const calls: Call[] = [];
  const gone = options.gone ?? new Set<string>();
  const omit = options.omit ?? new Set<string>();
  const unused = (): Promise<never> => Promise.reject(new Error('not used by sync'));
  const client: CompassClient = {
    issuePasses(request) {
      calls.push({
        kind: 'issue',
        codes: request.passes.map((pass) => pass.sessionCode),
        platforms: request.platforms,
      });
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
      return Promise.resolve(
        gone.has(serial)
          ? { outcome: 'gone' as const }
          : { outcome: 'updated' as const, response: { serialNumber: serial, version: 2 } },
      );
    },
    voidPass(serial) {
      calls.push({ kind: 'void', serial });
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
  const store = createPassStore({ appData: APP_DATA, fs });
  return { fs, store, seed: () => (record ? store.write(record) : Promise.resolve()) };
}

function inputFor(codes: string[]) {
  return { sessions: codes.map((code) => makeSession({ code })) };
}

function writesIn(ops: string[]): number {
  return ops.filter((op) => op.startsWith('writeFile ')).length;
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
          const { client, calls } = fakeClient({ gone: scenario.gone, omit: scenario.omit });

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
            if (scenario.omit.has(code)) continue;
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

  test('a session the server did not answer for is not recorded, so the next sync issues it again', async () => {
    const { store } = storeWith();
    const { client } = fakeClient({ omit: new Set(['CODE1']) });
    const input = inputFor(['CODE1', 'CODE2']);
    const result = await syncPasses(input, {
      store,
      client,
      builder: (code) => fieldsFor(code),
      platforms: ['apple'],
    });
    expect(result.record.passes.map((pass) => pass.sessionCode)).toEqual(['CODE2']);
    expect(result.plan.map((entry) => entry.diffCase)).toEqual(['added', 'added']);
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
        { sessions: current },
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
