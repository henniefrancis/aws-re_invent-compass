import { describe, expect, test, vi } from 'vitest';
import fc from 'fast-check';
import { SessionWireSchema, type PersonalTimeInput, type SessionWire } from '@compass/contracts';
import { listEvents } from '../../src/api/list-events.js';
import { getEvent } from '../../src/api/get-event.js';
import { listSessions } from '../../src/api/list-sessions.js';
import { getSession } from '../../src/api/get-session.js';
import { getSchedule } from '../../src/api/get-schedule.js';
import { reserveSessions } from '../../src/api/reserve-sessions.js';
import { cancelReservation } from '../../src/api/cancel-reservation.js';
import { associateFavorites } from '../../src/api/associate-favorites.js';
import { disassociateFavorite } from '../../src/api/disassociate-favorite.js';
import { createPersonalTime } from '../../src/api/create-personal-time.js';
import { updatePersonalTime } from '../../src/api/update-personal-time.js';
import { deletePersonalTime } from '../../src/api/delete-personal-time.js';
import { fetchAllSessions } from '../../src/catalog/paginate.js';
import { computeSessionInterval } from '../../src/catalog/session-time.js';
import { resolveEventWindow } from '../../src/catalog/event-window.js';
import { NotFoundError, RateLimitedError, UnauthorizedError } from '../../src/api/errors.js';
import { createSimulatedTransport } from '../../src/simulated/simulated-transport.js';
import type { ClientRequest, OperationName } from '../../src/api/transport.js';
import { EVENT, simRig, testFixtures } from './sim-harness.js';

// Tests for the simulated transport (events-client, S1, tasks 14.1 to 14.5). The
// catalog is the repository's read-only synthetic catalog. Nothing here touches the
// network: fetch is stubbed to fail loudly wherever it matters.

const ZONE = 'America/Los_Angeles';
const catalog: SessionWire[] = testFixtures().catalog();
const reservable = catalog.filter((s) => s.isReservable === true);

function interval(s: SessionWire): { start: number; end: number } | undefined {
  const i = computeSessionInterval(s.sessionTime, ZONE);
  return i === undefined ? undefined : { start: i.startMs, end: i.endMs };
}
function overlaps(a: SessionWire, b: SessionWire): boolean {
  const x = interval(a);
  const y = interval(b);
  return x !== undefined && y !== undefined && x.start < y.end && y.start < x.end;
}

/** Two reservable sessions whose times overlap, and one that overlaps neither. */
const clashPair = ((): [SessionWire, SessionWire] => {
  for (const a of reservable) {
    for (const b of reservable) {
      if (a !== b && overlaps(a, b)) return [a, b];
    }
  }
  throw new Error('the synthetic catalog has no overlapping reservable pair');
})();
const [clashA, clashB] = clashPair;
const freeSession = ((): SessionWire => {
  const found = reservable.find(
    (s) => !overlaps(s, clashA) && !overlaps(s, clashB) && interval(s) !== undefined,
  );
  if (found === undefined) throw new Error('no free reservable session');
  return found;
})();
const notReservable = catalog.find((s) => s.isReservable !== true);

const input: PersonalTimeInput = {
  startDateTime: '2026-12-01T20:00:00',
  endDateTime: '2026-12-01T21:00:00',
  title: 'Lunch',
  description: 'Break',
};

describe('events-client, task 14.1: the simulated transport routes on the official paths', () => {
  test('every one of the twelve client operations works end to end', async () => {
    const { ctx } = simRig();
    expect((await listEvents(ctx)).items[0]?.eventId).toBe('reinvent2026');
    expect((await getEvent(ctx, 'reinvent2026')).event.timezone).toBe(ZONE);
    expect((await listSessions(ctx)).totalCount).toBe(catalog.length);
    expect((await getSession(ctx, clashA.sessionId)).session.sessionId).toBe(clashA.sessionId);
    expect((await reserveSessions(ctx, [freeSession.sessionId])).result.successful).toEqual([
      freeSession.sessionId,
    ]);
    expect((await associateFavorites(ctx, [clashA.sessionId])).result.successful).toEqual([
      clashA.sessionId,
    ]);
    await createPersonalTime(ctx, input);
    const schedule = (await getSchedule(ctx)).schedule;
    expect(schedule.reserved).toEqual([freeSession.sessionId]);
    expect(schedule.favorites).toEqual([clashA.sessionId]);
    const id = schedule.personalTime[0]?.personalTimeId ?? '';
    await updatePersonalTime(ctx, id, { ...input, title: 'Long lunch' });
    await deletePersonalTime(ctx, id);
    await disassociateFavorite(ctx, clashA.sessionId);
    await cancelReservation(ctx, freeSession.sessionId);
    expect((await getSchedule(ctx)).schedule).toEqual({
      reserved: [],
      favorites: [],
      personalTime: [],
    });
  });

  test('unknown routes, other methods, extra segments and bad encodings are 404', async () => {
    const transport = createSimulatedTransport({}, testFixtures());
    const cases: [string, string][] = [
      ['GET', '/nowhere'],
      ['GET', '/events/reinvent2026/unknown'],
      ['POST', '/events'],
      ['POST', '/events/reinvent2026'],
      ['DELETE', '/events/reinvent2026/schedule'],
      ['GET', '/events/reinvent2026/schedule/extra'],
      ['GET', '/events/reinvent2026/sessions/a/b'],
      ['PUT', '/events/reinvent2026/reservations'],
      ['GET', '/events/reinvent2026/sessions/%E0%A4%A'],
    ];
    for (const [method, path] of cases) {
      const res = await transport.send({
        operation: 'GetSchedule',
        method: method as ClientRequest['method'],
        path,
      });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ message: 'Unknown route' });
    }
  });

  test('another event id is a 404 for every event-scoped route', async () => {
    const transport = createSimulatedTransport({}, testFixtures());
    const res = await transport.send({
      operation: 'GetSchedule',
      method: 'GET',
      path: '/events/other/schedule',
    });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Event not found' });
    const ev = await transport.send({
      operation: 'GetEvent',
      method: 'GET',
      path: '/events/other',
    });
    expect(ev.status).toBe(404);
  });

  test('unknown ids and bad bodies are refused with the matching status', async () => {
    const { ctx } = simRig();
    await expect(getSession(ctx, 'nope')).rejects.toBeInstanceOf(NotFoundError);
    await expect(cancelReservation(ctx, 'nope')).rejects.toBeInstanceOf(NotFoundError);
    await expect(disassociateFavorite(ctx, 'nope')).rejects.toBeInstanceOf(NotFoundError);
    await expect(updatePersonalTime(ctx, 'nope', input)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deletePersonalTime(ctx, 'nope')).rejects.toBeInstanceOf(NotFoundError);
    const raw = createSimulatedTransport({}, testFixtures());
    const base = {
      operation: 'ReserveSessions',
      method: 'POST',
      path: '/events/reinvent2026/reservations',
    } as const;
    expect((await raw.send({ ...base, body: { sessionIds: 'x' } })).status).toBe(400);
    expect(
      (await raw.send({ ...base, path: '/events/reinvent2026/favorites', body: {} })).status,
    ).toBe(400);
    expect(
      (
        await raw.send({
          operation: 'CreatePersonalTime',
          method: 'POST',
          path: '/events/reinvent2026/personal-time',
          body: { title: 1 },
        })
      ).status,
    ).toBe(400);
  });

  test('ListSessions pages through the whole catalog by nextToken, with and without abstracts', async () => {
    const { ctx } = simRig({ pageSize: 50 });
    const all = await fetchAllSessions(ctx, { includeAbstracts: true });
    expect(all.map((s) => s.sessionId)).toEqual(catalog.map((s) => s.sessionId));
    const fast = await fetchAllSessions(ctx, { includeAbstracts: false });
    expect(fast.every((s) => s.abstract === undefined)).toBe(true);
    expect(fast).toHaveLength(catalog.length);
    const first = await listSessions(simRig({ pageSize: 7 }).ctx);
    expect(first.items).toHaveLength(7);
    expect(first.nextToken).toBe('7');
    const last = await listSessions(simRig({ pageSize: catalog.length }).ctx);
    expect(last.nextToken).toBeUndefined();
  });

  test('a bad nextToken is a 400', async () => {
    const raw = createSimulatedTransport({}, testFixtures());
    for (const nextToken of ['abc', '-1', '1.5', '99999']) {
      const res = await raw.send({
        operation: 'ListSessions',
        method: 'GET',
        path: '/events/reinvent2026/sessions',
        query: { nextToken },
      });
      expect(res.status).toBe(400);
    }
  });
});

describe('Feature: events-client, Property 36: Simulated responses conform to configuration and never reach the live API', () => {
  // Validates: Requirements 18.1, 18.5, 18.7
  test('every served session validates against SessionWireSchema', async () => {
    const { ctx } = simRig({ pageSize: 25 });
    const all = await fetchAllSessions(ctx, { includeAbstracts: true });
    for (const s of all) {
      expect(SessionWireSchema.safeParse(s).success).toBe(true);
    }
  });

  test('for any operation a configured throttle answers 429 with a whole-second Retry-After from 1 to 60, and no fetch is made', async () => {
    const ops: OperationName[] = [
      'ListEvents',
      'GetEvent',
      'ListSessions',
      'GetSession',
      'GetSchedule',
      'ReserveSessions',
      'CancelReservation',
      'AssociateFavorites',
      'DisassociateFavorite',
      'CreatePersonalTime',
      'UpdatePersonalTime',
      'DeletePersonalTime',
    ];
    const paths: Record<OperationName, [ClientRequest['method'], string]> = {
      ListEvents: ['GET', '/events'],
      GetEvent: ['GET', '/events/reinvent2026'],
      ListSessions: ['GET', '/events/reinvent2026/sessions'],
      GetSession: ['GET', '/events/reinvent2026/sessions/x'],
      GetSchedule: ['GET', '/events/reinvent2026/schedule'],
      ReserveSessions: ['POST', '/events/reinvent2026/reservations'],
      CancelReservation: ['DELETE', '/events/reinvent2026/reservations/x'],
      AssociateFavorites: ['POST', '/events/reinvent2026/favorites'],
      DisassociateFavorite: ['DELETE', '/events/reinvent2026/favorites/x'],
      CreatePersonalTime: ['POST', '/events/reinvent2026/personal-time'],
      UpdatePersonalTime: ['PUT', '/events/reinvent2026/personal-time/x'],
      DeletePersonalTime: ['DELETE', '/events/reinvent2026/personal-time/x'],
    };
    const fetchSpy = vi.fn(() => Promise.reject(new Error('live fetch attempted')));
    vi.stubGlobal('fetch', fetchSpy);
    try {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...ops),
          fc.integer({ min: 1, max: 60 }),
          async (op, seconds) => {
            const loader = testFixtures({
              [`${op}/error-429`]: {
                status: 429,
                headers: { 'Retry-After': String(seconds) },
                body: { message: 'slow down' },
              },
            });
            const transport = createSimulatedTransport({ throttleOps: [op] }, loader);
            const [method, path] = paths[op];
            const res = await transport.send({ operation: op, method, path });
            expect(res.status).toBe(429);
            const header = res.headers.get('retry-after') ?? '';
            expect(header).toBe(String(seconds));
            expect(Number.isInteger(Number(header))).toBe(true);
            expect(Number(header)).toBeGreaterThanOrEqual(1);
            expect(Number(header)).toBeLessThanOrEqual(60);
          },
        ),
        { numRuns: 100 },
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('a throttle fixture with an out-of-range Retry-After is refused rather than served', async () => {
    for (const bad of ['0', '61', 'abc', '1.5', '']) {
      const loader = testFixtures({
        'GetSchedule/error-429': { status: 429, headers: { 'retry-after': bad }, body: {} },
      });
      const transport = createSimulatedTransport({ throttleOps: ['GetSchedule'] }, loader);
      await expect(
        transport.send({
          operation: 'GetSchedule',
          method: 'GET',
          path: '/events/reinvent2026/schedule',
        }),
      ).rejects.toThrow('Retry-After');
    }
    const missing = testFixtures({ 'GetSchedule/error-429': { status: 429 } });
    await expect(
      createSimulatedTransport({ throttleOps: ['GetSchedule'] }, missing).send({
        operation: 'GetSchedule',
        method: 'GET',
        path: '/events/reinvent2026/schedule',
      }),
    ).rejects.toThrow('Retry-After');
  });
});

/** The reference model for Property 37: the schedule after a sequence of writes. */
interface Model {
  reserved: string[];
  favorites: string[];
  personalTime: { id: string; title: string }[];
  next: number;
}

type Op =
  | { kind: 'reserve'; id: string }
  | { kind: 'cancel'; id: string }
  | { kind: 'favorite'; id: string }
  | { kind: 'unfavorite'; id: string }
  | { kind: 'ptCreate'; title: string }
  | { kind: 'ptUpdate'; n: number; title: string }
  | { kind: 'ptDelete'; n: number };

const poolIds = [clashA.sessionId, clashB.sessionId, freeSession.sessionId, 'unknown-id'];
const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant('reserve' as const), id: fc.constantFrom(...poolIds) }),
  fc.record({ kind: fc.constant('cancel' as const), id: fc.constantFrom(...poolIds) }),
  fc.record({ kind: fc.constant('favorite' as const), id: fc.constantFrom(...poolIds) }),
  fc.record({ kind: fc.constant('unfavorite' as const), id: fc.constantFrom(...poolIds) }),
  fc.record({ kind: fc.constant('ptCreate' as const), title: fc.constantFrom('A', 'B', 'C') }),
  fc.record({
    kind: fc.constant('ptUpdate' as const),
    n: fc.integer({ min: 1, max: 4 }),
    title: fc.constantFrom('X', 'Y'),
  }),
  fc.record({ kind: fc.constant('ptDelete' as const), n: fc.integer({ min: 1, max: 4 }) }),
);

function applyToModel(model: Model, op: Op): void {
  const byId = new Map(catalog.map((s) => [s.sessionId, s]));
  switch (op.kind) {
    case 'reserve': {
      const s = byId.get(op.id);
      if (s?.isReservable !== true || model.reserved.includes(op.id)) return;
      if (model.reserved.some((r) => overlaps(s, byId.get(r) as SessionWire))) return;
      model.reserved.push(op.id);
      return;
    }
    case 'cancel':
      model.reserved = model.reserved.filter((r) => r !== op.id);
      return;
    case 'favorite':
      if (byId.has(op.id) && !model.favorites.includes(op.id)) model.favorites.push(op.id);
      return;
    case 'unfavorite':
      model.favorites = model.favorites.filter((f) => f !== op.id);
      return;
    case 'ptCreate':
      model.personalTime.push({ id: `pt-${String(model.next)}`, title: op.title });
      model.next += 1;
      return;
    case 'ptUpdate': {
      const entry = model.personalTime.find((p) => p.id === `pt-${String(op.n)}`);
      if (entry !== undefined) entry.title = op.title;
      return;
    }
    case 'ptDelete':
      model.personalTime = model.personalTime.filter((p) => p.id !== `pt-${String(op.n)}`);
  }
}

describe('Feature: events-client, Property 37: Simulated writes are reflected by a later GetSchedule', () => {
  // Validates: Requirements 18.3
  test('after any sequence of writes GetSchedule equals the reference model', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { maxLength: 20 }), async (ops) => {
        const { ctx } = simRig();
        const model: Model = { reserved: [], favorites: [], personalTime: [], next: 1 };
        for (const op of ops) {
          const run = async (): Promise<unknown> => {
            switch (op.kind) {
              case 'reserve':
                return reserveSessions(ctx, [op.id]);
              case 'cancel':
                return cancelReservation(ctx, op.id);
              case 'favorite':
                return associateFavorites(ctx, [op.id]);
              case 'unfavorite':
                return disassociateFavorite(ctx, op.id);
              case 'ptCreate':
                return createPersonalTime(ctx, { ...input, title: op.title });
              case 'ptUpdate':
                return updatePersonalTime(ctx, `pt-${String(op.n)}`, { ...input, title: op.title });
              case 'ptDelete':
                return deletePersonalTime(ctx, `pt-${String(op.n)}`);
            }
          };
          await run().catch((e: unknown) => {
            expect(e).toBeInstanceOf(NotFoundError);
          });
          applyToModel(model, op);
        }
        const { schedule } = await getSchedule(ctx);
        expect(schedule.reserved).toEqual(model.reserved);
        expect(schedule.favorites).toEqual(model.favorites);
        expect(schedule.personalTime.map((p) => [p.personalTimeId, p.title])).toEqual(
          model.personalTime.map((p) => [p.id, p.title]),
        );
      }),
      { numRuns: 100 },
    );
  });

  test('a schedule snapshot is a copy: changing it does not change the attendee schedule', async () => {
    const { ctx } = simRig();
    await associateFavorites(ctx, [clashA.sessionId]);
    const first = await getSchedule(ctx);
    first.schedule.favorites.push('tampered');
    expect((await getSchedule(ctx)).schedule.favorites).toEqual([clashA.sessionId]);
  });
});

describe('Feature: events-client, Property 38: Simulated bulk results are derived from in-memory state', () => {
  // Validates: Requirements 18.4
  const fullId = freeSession.sessionId;

  test('for any request the per-session result follows the in-memory state', async () => {
    const pool = [
      clashA.sessionId,
      clashB.sessionId,
      fullId,
      notReservable?.sessionId ?? 'x',
      'unknown-id',
    ];
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.constantFrom(...pool), { minLength: 1, maxLength: 5 }),
        fc.boolean(),
        async (ids, reserveFirstA) => {
          const { ctx } = simRig({ fullSessionIds: [fullId] });
          if (reserveFirstA) {
            await reserveSessions(ctx, [clashA.sessionId]);
          }
          const { result } = await reserveSessions(ctx, ids);
          const reserved = new Set<string>(reserveFirstA ? [clashA.sessionId] : []);
          const byId = new Map(catalog.map((s) => [s.sessionId, s]));
          for (const id of ids) {
            const s = byId.get(id);
            const failure = result.failed.find((f) => f.sessionId === id);
            if (s?.isReservable !== true) {
              expect(failure?.code).toBe('sessionNotReservable');
            } else if (reserved.has(id)) {
              expect(failure?.code).toBe('alreadyScheduled');
            } else if (id === fullId) {
              expect(failure?.code).toBe('sessionFull');
            } else {
              const clashes = [...reserved].filter((r) => overlaps(s, byId.get(r) as SessionWire));
              if (clashes.length > 0) {
                expect(failure?.code).toBe('scheduleConflict');
                expect(failure?.conflictsWith).toEqual(clashes);
              } else {
                expect(failure).toBeUndefined();
                expect(result.successful).toContain(id);
                reserved.add(id);
              }
            }
          }
          expect(result.successful.length + result.failed.length).toBe(ids.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  test('named cases: sessionFull, scheduleConflict with conflictsWith, alreadyScheduled', async () => {
    const { ctx } = simRig({ fullSessionIds: [fullId] });
    expect((await reserveSessions(ctx, [fullId])).result.failed).toEqual([
      { sessionId: fullId, code: 'sessionFull', refusal: 'known' },
    ]);
    await reserveSessions(ctx, [clashA.sessionId]);
    expect((await reserveSessions(ctx, [clashB.sessionId])).result.failed).toEqual([
      {
        sessionId: clashB.sessionId,
        code: 'scheduleConflict',
        conflictsWith: [clashA.sessionId],
        refusal: 'known',
      },
    ]);
    expect((await reserveSessions(ctx, [clashA.sessionId])).result.failed).toEqual([
      { sessionId: clashA.sessionId, code: 'alreadyScheduled', refusal: 'known' },
    ]);
  });

  test('a session in the same request counts as reserved for the next one', async () => {
    const { ctx } = simRig();
    const { result } = await reserveSessions(ctx, [clashA.sessionId, clashB.sessionId]);
    expect(result.successful).toEqual([clashA.sessionId]);
    expect(result.failed[0]?.code).toBe('scheduleConflict');
  });

  test('favorites report unknown sessions as other and repeats as alreadyFavorited', async () => {
    const { ctx } = simRig();
    await associateFavorites(ctx, [clashA.sessionId]);
    const { result } = await associateFavorites(ctx, [clashA.sessionId, 'unknown-id']);
    expect(result.failed).toEqual([
      { sessionId: clashA.sessionId, code: 'alreadyFavorited', refusal: 'known' },
      { sessionId: 'unknown-id', code: 'other', refusal: 'known' },
    ]);
  });

  test('a session with no usable time never clashes', async () => {
    const noTime: SessionWire = { sessionId: 'no-time', title: 'T', isReservable: true };
    const loader = {
      ...testFixtures(),
      catalog: () => [noTime, { ...noTime, sessionId: 'no-time-2' }],
    };
    const transport = createSimulatedTransport({}, loader);
    const res = await transport.send({
      operation: 'ReserveSessions',
      method: 'POST',
      path: '/events/reinvent2026/reservations',
      body: { sessionIds: ['no-time', 'no-time-2'] },
    });
    expect(res.body).toEqual({ result: { successful: ['no-time', 'no-time-2'], failed: [] } });
  });
});

describe('events-client, task 14.5: signed-in presentation and the expired-token 401', () => {
  test('a whole session of calls makes no OAuth or credential call and no fetch', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('live fetch attempted')));
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const rig = simRig();
      await listEvents(rig.ctx);
      await getSchedule(rig.ctx);
      await reserveSessions(rig.ctx, [freeSession.sessionId]);
      expect(rig.credentialCalls).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('a configured expired-token 401 is refreshed once and the retry succeeds', async () => {
    const rig = simRig({ expiredTokenOps: ['GetSchedule'] });
    await expect(getSchedule(rig.ctx)).resolves.toBeDefined();
    expect(rig.refreshes()).toBe(1);
  });

  test('a persistent expired token ends as UnauthorizedError, and a reservation is never re-sent', async () => {
    const persistent = simRig({ expiredTokenOps: ['GetSchedule'], scenarioRepeats: 5 });
    await expect(getSchedule(persistent.ctx)).rejects.toBeInstanceOf(UnauthorizedError);
    const reserve = simRig({ expiredTokenOps: ['ReserveSessions'] });
    await expect(reserveSessions(reserve.ctx, [freeSession.sessionId])).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect((await getSchedule(reserve.ctx)).schedule.reserved).toEqual([]);
  });

  test('a configured throttle is waited out once and the retry succeeds; a persistent one fails', async () => {
    const rig = simRig({ throttleOps: ['GetSchedule'] });
    await expect(getSchedule(rig.ctx)).resolves.toBeDefined();
    expect(rig.sleeps).toEqual([2000]);
    const persistent = simRig({ throttleOps: ['GetSchedule'], scenarioRepeats: 5 });
    await expect(getSchedule(persistent.ctx)).rejects.toBeInstanceOf(RateLimitedError);
  });

  test('expired-token takes precedence over throttle when both are configured for an operation', async () => {
    const rig = simRig({ expiredTokenOps: ['GetSchedule'], throttleOps: ['GetSchedule'] });
    const res = await rig.ctx.transport.send({
      operation: 'GetSchedule',
      method: 'GET',
      path: '/events/reinvent2026/schedule',
    });
    expect(res.status).toBe(401);
  });

  test('the event window can be resolved from the simulated ListEvents and GetEvent', async () => {
    const rig = simRig();
    const events = await listEvents(rig.ctx);
    const event = await getEvent(rig.ctx, EVENT.eventId);
    expect(events.items[0]?.timezone).toBe(event.event.timezone);
  });
});

describe('events-client, S3 change request: the demo catalog and clock', () => {
  const DEMO_NOW = Date.parse('2026-11-29T18:00:00-08:00');

  test('the base BWP213 (syn-024) and its repeat BWP213-R (syn-025) are both served by list and get', async () => {
    const { ctx } = simRig();
    const all = await fetchAllSessions(ctx, { includeAbstracts: true });
    expect(all).toHaveLength(120);
    expect(all.find((s) => s.sessionId === 'syn-024')?.abbreviation).toBe('BWP213');
    expect(all.find((s) => s.sessionId === 'syn-025')?.abbreviation).toBe('BWP213-R');
    expect((await getSession(ctx, 'syn-024')).session.abbreviation).toBe('BWP213');
    expect((await getSession(ctx, 'syn-025')).session.abbreviation).toBe('BWP213-R');
  });

  test('the simulated event is 30 Nov to 4 Dec with an IANA timezone', async () => {
    const { ctx } = simRig();
    const { event } = await getEvent(ctx, 'reinvent2026');
    expect(event.startDate.startsWith('2026-11-30')).toBe(true);
    expect(event.endDate.startsWith('2026-12-04')).toBe(true);
    expect(event.timezone).toBe('America/Los_Angeles');
    const window = resolveEventWindow(await listEvents(ctx), { event });
    expect(window.timezone).toBe('America/Los_Angeles');
  });

  test('with a fixed demo clock before the event every session can be reserved; sessions already started answer timePassed', async () => {
    const before = simRig({ now: () => DEMO_NOW });
    expect((await reserveSessions(before.ctx, ['syn-096'])).result.successful).toEqual(['syn-096']);
    const after = simRig({ now: () => Date.parse('2026-12-04T10:00:00-08:00') });
    expect((await reserveSessions(after.ctx, ['syn-096'])).result.failed).toEqual([
      { sessionId: 'syn-096', code: 'timePassed', refusal: 'known' },
    ]);
    const noClock = simRig();
    expect((await reserveSessions(noClock.ctx, ['syn-096'])).result.successful).toEqual([
      'syn-096',
    ]);
  });

  test('a session with no usable time is never timePassed even with a clock', async () => {
    const noTime: SessionWire = { sessionId: 'no-time', title: 'T', isReservable: true };
    const transport = createSimulatedTransport(
      { now: () => DEMO_NOW },
      { ...testFixtures(), catalog: () => [noTime] },
    );
    const res = await transport.send({
      operation: 'ReserveSessions',
      method: 'POST',
      path: '/events/reinvent2026/reservations',
      body: { sessionIds: ['no-time'] },
    });
    expect(res.body).toEqual({ result: { successful: ['no-time'], failed: [] } });
  });
});

describe('events-client: an event without a timezone does not stop the simulation', () => {
  test('sessions then rely on their own timezone, and clashes are still found', async () => {
    const { timezone: _timezone, ...bare } = EVENT;
    void _timezone;
    const loader = testFixtures({
      'GetEvent/success': { status: 200, body: { event: bare } },
    });
    const { ctx } = simRig({}, loader);
    const { result } = await reserveSessions(ctx, [clashA.sessionId, clashB.sessionId]);
    expect(result.successful).toEqual([clashA.sessionId]);
    expect(result.failed[0]?.code).toBe('scheduleConflict');
  });
});

describe('events-client, QA M5: the simulation enforces the OpenAPI request constraints', () => {
  const base = {
    operation: 'ReserveSessions',
    method: 'POST',
    path: '/events/reinvent2026/reservations',
  } as const;
  const send = (path: string, method: ClientRequest['method'], body: unknown) =>
    createSimulatedTransport({}, testFixtures()).send({
      operation: 'ReserveSessions',
      method,
      path,
      body,
    });
  const ids = (n: number): string[] =>
    Array.from({ length: n }, (_, i) => `syn-${String(i + 1).padStart(3, '0')}`);

  test('bulk requests need 1 to 10 unique ids of 1 to 128 characters, else 400 and nothing changes', async () => {
    const transport = createSimulatedTransport({}, testFixtures());
    const bad: unknown[] = [
      undefined,
      null,
      'x',
      {},
      { sessionIds: 'syn-001' },
      { sessionIds: [] },
      { sessionIds: ids(11) },
      { sessionIds: ['syn-001', 'syn-001'] },
      { sessionIds: [''] },
      { sessionIds: ['x'.repeat(129)] },
      { sessionIds: [1] },
    ];
    for (const path of ['/events/reinvent2026/reservations', '/events/reinvent2026/favorites']) {
      for (const body of bad) {
        const res = await transport.send({ ...base, path, body });
        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body)).not.toContain('syn-001');
      }
    }
    const schedule = await transport.send({
      operation: 'GetSchedule',
      method: 'GET',
      path: '/events/reinvent2026/schedule',
    });
    expect(schedule.body).toEqual({ schedule: { reserved: [], favorites: [], personalTime: [] } });
  });

  test('exactly 1 and exactly 10 ids, and a 128 character id, are accepted', async () => {
    for (const sessionIds of [ids(1), ids(10), ['x'.repeat(128)]]) {
      expect((await send(base.path, 'POST', { sessionIds })).status).toBe(200);
    }
  });

  const good = {
    startDateTime: '2026-12-01T20:00:00',
    endDateTime: '2026-12-01T21:05:00',
    title: 'T',
    description: 'D',
  };

  test('personal time must follow the documented format, order, step and length rules', async () => {
    const bad: Record<string, unknown>[] = [
      { ...good, startDateTime: '2026-12-01T20:00:00Z' },
      { ...good, startDateTime: '2026-12-01T20:00:00-08:00' },
      { ...good, startDateTime: '2026-12-01T12:00' },
      { ...good, startDateTime: '2026-12-01 20:00:00' },
      { ...good, startDateTime: '2026-12-01T20:00:30' },
      { ...good, endDateTime: '2026-12-01T21:00:30' },
      { ...good, startDateTime: '2026-02-31T20:00:00' },
      { ...good, startDateTime: '2026-12-01T25:00:00' },
      { ...good, endDateTime: '2026-12-01T20:00:00' },
      { ...good, endDateTime: '2026-12-01T19:00:00' },
      { ...good, endDateTime: '2026-12-01T21:03:00' },
      { ...good, startDateTime: 5 },
      { ...good, title: '' },
      { ...good, title: 'x'.repeat(129) },
      { ...good, description: '' },
      { ...good, description: 'x'.repeat(251) },
      { ...good, location: '' },
      { ...good, location: 'x'.repeat(256) },
      { ...good, location: 7 },
    ];
    for (const body of bad) {
      for (const [method, path] of [
        ['POST', '/events/reinvent2026/personal-time'],
        ['PUT', '/events/reinvent2026/personal-time/pt-1'],
      ] as const) {
        const res = await send(path, method, body);
        expect(res.status).toBe(400);
        expect((res.body as { message: string }).message).toContain('Personal time is invalid');
      }
    }
    expect((await send('/events/reinvent2026/personal-time', 'POST', null)).status).toBe(400);
  });

  test('valid personal time, including the length limits and a location, is stored', async () => {
    const { ctx } = simRig();
    await createPersonalTime(ctx, {
      ...good,
      title: 'x'.repeat(128),
      description: 'y'.repeat(250),
      location: 'z'.repeat(255),
    });
    await createPersonalTime(ctx, good);
    const { schedule } = await getSchedule(ctx);
    expect(schedule.personalTime).toHaveLength(2);
    expect(schedule.personalTime[0]?.location).toHaveLength(255);
    expect(schedule.personalTime[1]?.location).toBeUndefined();
    await updatePersonalTime(ctx, 'pt-2', { ...good, endDateTime: '2026-12-01T20:05:00' });
  });

  test('a scenario for an operation without that fixture is refused when the transport is created', () => {
    const loader = {
      ...testFixtures(),
      fixture: (op: OperationName, scenario: string) => {
        if (op === 'ListEvents' && scenario.startsWith('error-')) {
          throw new Error('ENOENT');
        }
        return testFixtures().fixture(op, scenario);
      },
    };
    expect(() => createSimulatedTransport({ throttleOps: ['ListEvents'] }, loader)).toThrow(
      'no error-429 scenario for ListEvents',
    );
    expect(() => createSimulatedTransport({ expiredTokenOps: ['ListEvents'] }, loader)).toThrow(
      'no error-401-expired-token scenario for ListEvents',
    );
    expect(() => createSimulatedTransport({ throttleOps: ['GetSchedule'] }, loader)).not.toThrow();
  });
});
