import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NormalisedSession } from '@compass/contracts';
import {
  CompassError as PassClientError,
  PassError,
  createCompassClient,
  createPassStore,
} from '@compass/core/passes';
import type { HttpResponse, HttpTransport, IssuedPass, PassStore } from '@compass/core/passes';
import { createNodeAppFileSystem } from '../../src/adapters/node-fs-adapter.js';
import {
  createPassesAdapter,
  mapPassError,
  narrowStore,
} from '../../src/adapters/passes-adapter.js';
import { CompassError } from '../../src/ports/errors.js';
import type { PassesPort, ScheduleView, SyncScope } from '../../src/ports/passes-port.js';
import { createInProcessPassService } from '../../src/simulated/in-process-pass-service.js';
import type { InProcessPassService } from '../../src/simulated/in-process-pass-service.js';
import { fixedClock } from '../support/fake-clock.js';
import { syntheticCatalogView } from '../support/fake-catalog.js';
import { TRIPLE } from '../support/triple.js';

const WINDOW = {
  start: '2026-11-29T00:00:00-08:00',
  end: '2026-12-05T23:59:00-08:00',
  timezone: 'America/Los_Angeles',
};
const NOW = '2026-11-29T18:00:00-08:00';
const catalog = syntheticCatalogView();
const sessionOf = (id: string): NormalisedSession => {
  const entry = catalog.byId.get(id);
  if (entry === undefined) throw new Error(`missing ${id}`);
  return entry.session;
};
const A = sessionOf(TRIPLE.a);
const AR = sessionOf(TRIPLE.aRepeat);
const B = sessionOf(TRIPLE.b);

function jwt(): string {
  const part = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'none' })}.${part({ token_use: 'id', sub: 'x' })}.c2ln`;
}

const idByCode = new Map(
  [...catalog.byId.values()].map((e) => [e.session.code, e.session.sessionId]),
);
const view = (...sessions: NormalisedSession[]): ScheduleView => ({ sessions, personalTime: [] });
const scope = (resolved: NormalisedSession[], narrow?: NormalisedSession[]): SyncScope => ({
  resolved,
  schedule: view(...resolved),
  idByCode,
  ...(narrow === undefined ? {} : { narrowCodes: new Set(narrow.map((s) => s.code)) }),
});

describe('the passes adapter over the real S4', () => {
  let temp: string;
  let service: InProcessPassService;
  let store: PassStore;
  let adapter: PassesPort;

  const build = (
    options: {
      transport?: HttpTransport;
      attendeeName?: string;
      platforms?: ('apple' | 'google')[];
    } = {},
  ) => {
    const fs = createNodeAppFileSystem();
    const appData = { resolve: () => join(temp, 'reinvent-compass') };
    const clock = { now: () => new Date(NOW), sleep: () => Promise.resolve() };
    service = createInProcessPassService({
      clock: fixedClock(NOW),
      eventWindow: WINDOW,
      random: (n) => randomBytes(n),
      uuid: () => randomUUID(),
    });
    const client = createCompassClient({
      baseUrl: 'https://compass.invalid',
      allowedHosts: ['compass.invalid'],
      simulated: true,
      transport: options.transport ?? service.transport,
      idToken: { getIdToken: () => Promise.resolve(jwt()) },
      clock,
    });
    store = createPassStore({ appData, fs, clock });
    adapter = createPassesAdapter({
      client,
      store,
      fs,
      appData,
      clock,
      connections: { walkMinutes: () => 5 },
      eventWindow: () => Promise.resolve(WINDOW),
      ...(options.attendeeName === undefined ? {} : { attendeeName: options.attendeeName }),
      ...(options.platforms === undefined ? {} : { platforms: options.platforms }),
    });
  };

  beforeEach(async () => {
    temp = await mkdtemp(join(tmpdir(), 'compass-passes-'));
    build();
  });
  afterEach(async () => {
    await rm(temp, { recursive: true, force: true });
  });

  test('issuing records the passes and never voids passes for other sessions', async () => {
    const first = await adapter.issue([AR, B], view(AR, B));
    expect(first.map((i) => i.sessionId)).toEqual([TRIPLE.aRepeat, TRIPLE.b]);
    const second = await adapter.issue([A], view(A, AR, B));
    expect(second).toHaveLength(1);
    const record = (await store.read()).passes;
    expect(record.map((p) => p.sessionCode).sort()).toEqual(
      [`${TRIPLE.codes.a}`, `${TRIPLE.codes.aRepeat}`, `${TRIPLE.codes.b}`].sort(),
    );
    expect(record.every((p) => p.fieldsHash.length === 64)).toBe(true);
    expect([...service.passes().values()].every((p) => p.status === 'active')).toBe(true);
    expect((await adapter.issuedRecord()).map((r) => r.sessionCode).sort()).toEqual(
      [`${TRIPLE.codes.a}`, `${TRIPLE.codes.aRepeat}`, `${TRIPLE.codes.b}`].sort(),
    );
  });

  test('re-issuing a session replaces its record entry', async () => {
    await adapter.issue([A], view(A));
    await adapter.issue([A], view(A));
    expect((await store.read()).passes).toHaveLength(1);
  });

  test('a sync previews and then issues, updates and voids against the schedule', async () => {
    await adapter.issue([AR, B], view(AR, B));
    const plan = await adapter.previewSync(scope([A, B]));
    expect(plan.toIssue).toEqual([TRIPLE.a]);
    expect(plan.toVoid.map((v) => v.sessionCode)).toEqual([`${TRIPLE.codes.aRepeat}`]);
    const result = await adapter.sync({
      ...scope([A, B]),
      confirmEmpty: false,
      allowBulkVoid: false,
    });
    expect(result.issued).toEqual([TRIPLE.a]);
    expect(result.voided).toEqual([TRIPLE.aRepeat]);
    expect([...service.passes().values()].filter((p) => p.status === 'voided')).toHaveLength(1);
  });

  test('an unknown code in the results falls back to the code itself', async () => {
    await adapter.issue([AR], view(AR));
    const result = await adapter.sync({
      resolved: [],
      schedule: view(),
      idByCode: new Map(),
      confirmEmpty: true,
      allowBulkVoid: false,
    });
    expect(result.voided).toEqual([`${TRIPLE.codes.aRepeat}`]);
  });

  test('a narrowed sync never touches passes outside the narrowing (CTO review H1)', async () => {
    await adapter.issue([A, AR, B], view(A, AR, B));
    const before = new Map([...service.passes()].map(([serial, pass]) => [serial, pass.status]));
    const plan = await adapter.previewSync(scope([AR], [AR]));
    expect(plan.toVoid).toEqual([]);
    expect(plan.toUpdate).toEqual([TRIPLE.aRepeat]);
    const result = await adapter.sync({
      ...scope([AR], [AR]),
      confirmEmpty: false,
      allowBulkVoid: false,
    });
    expect(result.voided).toEqual([]);
    expect(result.updated.concat(result.issued)).toEqual(expect.arrayContaining([]));
    for (const [serial, pass] of service.passes()) {
      expect(pass.status).toBe(before.get(serial));
    }
    expect((await store.read()).passes.map((p) => p.sessionCode).sort()).toEqual(
      [`${TRIPLE.codes.a}`, `${TRIPLE.codes.aRepeat}`, `${TRIPLE.codes.b}`].sort(),
    );
  });

  test('a narrowed sync that cancels one session voids only that one', async () => {
    await adapter.issue([A, B], view(A, B));
    const result = await adapter.sync({
      ...scope([], [B]),
      confirmEmpty: true,
      allowBulkVoid: false,
    });
    expect(result.voided).toEqual([TRIPLE.b]);
    expect((await store.read()).passes.map((p) => p.sessionCode)).toEqual([`${TRIPLE.codes.a}`]);
  });

  test('S4 refuses an empty or bulk void without the flags, and the adapter maps that to a pass error', async () => {
    await adapter.issue([A], view(A));
    const error: unknown = await adapter
      .sync({ ...scope([]), confirmEmpty: false, allowBulkVoid: false })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CompassError);
    expect((error as CompassError).code).toBe('PassError');
    expect((error as CompassError).details.summary).toContain('empty');
  });

  test('a hand-off returns the board URL, its expiry and three QR renders', async () => {
    await adapter.issue([A], view(A));
    const [record] = await adapter.issuedRecord();
    const result = await adapter.handoff([String(record?.serialNumber)]);
    const url = new URL(result.boardUrl);
    expect(url.origin).toBe('https://compass.invalid');
    expect(url.pathname).toBe('/board');
    expect(url.hash).toMatch(/^#h=[A-Za-z0-9_-]{22}$/);
    expect(result.expiresAt).toBe(new Date(Date.parse(NOW) + 15 * 60 * 1000).toISOString());
    expect(result.terminalQr.length).toBeGreaterThan(10);
    expect(result.chatText.length).toBeGreaterThan(10);
    expect([...result.chatPng.slice(0, 4)]).toEqual([137, 80, 78, 71]);
  });

  test('the calendar is built and saved', async () => {
    const out = await adapter.exportCalendar({
      sessions: [A],
      personalTime: [
        {
          personalTimeId: 'p1',
          startDateTime: '2026-12-01T12:00:00-08:00',
          endDateTime: '2026-12-01T12:30:00-08:00',
          title: 'Lunch',
          description: '',
        },
      ],
    });
    expect(out.ics).toContain('BEGIN:VCALENDAR');
    expect(await readFile(out.path, 'utf8')).toBe(out.ics);
  });

  test('forget me voids and removes local data, or reports what was not done', async () => {
    await adapter.issue([A], view(A));
    expect(await adapter.forgetMe()).toEqual({ ok: true });
    expect(service.passes().size).toBe(0);
    expect(await adapter.issuedRecord()).toEqual([]);
    const odd: HttpTransport = {
      request: () =>
        Promise.resolve({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ voided: 0, deleted: 0 }),
        }),
    };
    build({ transport: odd });
    const outcome = await adapter.forgetMe();
    expect(outcome).toMatchObject({ ok: false });
  });

  test('options: an attendee name and a narrower platform list are accepted', async () => {
    build({ attendeeName: 'Alex Gupta', platforms: ['apple'] });
    const issued = await adapter.issue([A], view(A));
    expect(issued).toHaveLength(1);
    expect((await store.read()).passes[0]?.platforms).toEqual(['apple']);
  });

  test('a rate limit becomes RateLimited with the wait, a 401 becomes NotSignedIn', async () => {
    build({
      transport: {
        request: () =>
          Promise.resolve({
            ...problemResponse(429),
            headers: { 'retry-after': '9', 'content-type': 'application/problem+json' },
          }),
      },
    });
    const limited: unknown = await adapter.issue([A], view(A)).catch((e: unknown) => e);
    expect(limited).toMatchObject({ code: 'RateLimited', details: { retryAfterSeconds: 9 } });
    build({ transport: { request: () => Promise.resolve(problemResponse(401)) } });
    const unsigned: unknown = await adapter.issue([A], view(A)).catch((e: unknown) => e);
    expect(unsigned).toMatchObject({ code: 'NotSignedIn' });
  });

  test('a service answer that misses a session is a pass error', async () => {
    build({
      transport: {
        request: () =>
          Promise.resolve({
            status: 201,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ passes: [] }),
          }),
      },
    });
    const error: unknown = await adapter.issue([A], view(A)).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'PassError' });
  });

  test('more than 25 sessions are issued in chunks of 25', async () => {
    const many = [...catalog.byId.values()]
      .map((e) => e.session)
      .filter((s) => s.startsAt !== undefined && s.endsAt !== undefined && s.venue !== undefined)
      .slice(0, 27);
    expect(many).toHaveLength(27);
    const issued = await adapter.issue(many, view(...many));
    expect(issued).toHaveLength(27);
    expect(service.passes().size).toBe(27);
  });
});

function problemResponse(status: number): HttpResponse {
  return {
    status,
    headers: { 'content-type': 'application/problem+json' },
    body: JSON.stringify({
      type: 'https://compass.invalid/problems/x',
      title: 'x',
      status,
      code: 'x',
    }),
  };
}

describe('mapPassError', () => {
  test('maps the client and pass errors onto fixed codes and rethrows anything else', () => {
    const limited = mapPassError(
      new PassClientError('compass.rate_limited', 'wait', { retryAfterSeconds: 7 }),
    );
    expect(limited).toMatchObject({ code: 'RateLimited', details: { retryAfterSeconds: 7 } });
    const noWait = mapPassError(new PassClientError('compass.rate_limited', 'wait'));
    expect(noWait).toMatchObject({ code: 'RateLimited', details: {} });
    expect(mapPassError(new PassClientError('compass.no_id_token', 'x'))).toMatchObject({
      code: 'NotSignedIn',
    });
    expect(
      mapPassError(new PassClientError('compass.problem', 'x', { status: 401 })),
    ).toMatchObject({ code: 'NotSignedIn' });
    expect(
      mapPassError(new PassClientError('compass.http_error', 'x', { status: 500 })),
    ).toMatchObject({ code: 'PassError' });
    expect(mapPassError(new PassError('sync.x', 'Nothing was changed.'))).toMatchObject({
      code: 'PassError',
      details: { summary: 'Nothing was changed.' },
    });
    const other = new Error('boom');
    expect(mapPassError(other)).toBe(other);
  });
});

describe('narrowStore', () => {
  const pass = (code: string): IssuedPass => ({
    serialNumber: `s-${code}`,
    sessionCode: code,
    fieldsHash: 'h',
    platforms: ['apple'],
  });

  function baseStore() {
    const calls: string[] = [];
    let passes = [pass('IN1'), pass('OUT1'), pass('IN2')];
    const store: PassStore = {
      read: () => Promise.resolve({ passes }),
      readWithSuperseded: () =>
        Promise.resolve({ record: { passes }, superseded: [pass('IN1'), pass('OUT1')] }),
      write: (record) => {
        passes = record.passes;
        return Promise.resolve();
      },
      readPendingVoids: () => (calls.push('readPendingVoids'), Promise.resolve(['p'])),
      writePendingVoids: (serials) => (
        calls.push(`writePendingVoids ${serials.join(',')}`),
        Promise.resolve()
      ),
      deleteRecord: () => (calls.push('deleteRecord'), Promise.resolve()),
      withLock: (fn) => (calls.push('withLock'), fn()),
      heartbeat: () => (calls.push('heartbeat'), Promise.resolve()),
    };
    return { store, calls, current: () => passes };
  }

  test('shows only the narrowed entries and merges untouched entries back on write', async () => {
    const { store, calls, current } = baseStore();
    const view = narrowStore(store, new Set(['IN1', 'IN2']));
    expect((await view.read()).passes.map((p) => p.sessionCode)).toEqual(['IN1', 'IN2']);
    const withSuperseded = await view.readWithSuperseded();
    expect(withSuperseded.record.passes.map((p) => p.sessionCode)).toEqual(['IN1', 'IN2']);
    expect(withSuperseded.superseded.map((p) => p.sessionCode)).toEqual(['IN1']);
    await view.write({ passes: [pass('IN2'), pass('OUT1')] });
    expect(
      current()
        .map((p) => p.sessionCode)
        .sort(),
    ).toEqual(['IN2', 'OUT1']);
    expect(await view.readPendingVoids()).toEqual(['p']);
    await view.writePendingVoids(['a', 'b']);
    await view.deleteRecord();
    await view.heartbeat();
    expect(await view.withLock(() => Promise.resolve(7))).toBe(7);
    expect(calls).toEqual([
      'readPendingVoids',
      'writePendingVoids a,b',
      'deleteRecord',
      'heartbeat',
      'withLock',
    ]);
  });
});
