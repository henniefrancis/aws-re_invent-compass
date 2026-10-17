import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { createHarness, response } from './operation-harness.js';
import { listEvents } from '../../src/api/list-events.js';
import { DEFAULT_RATE_LIMIT_BLOCK_SECONDS } from '../../src/api/execute-operation.js';
import { getEvent } from '../../src/api/get-event.js';
import { listSessions } from '../../src/api/list-sessions.js';
import { getSession } from '../../src/api/get-session.js';
import { getSchedule } from '../../src/api/get-schedule.js';
import { reserveSessions } from '../../src/api/reserve-sessions.js';
import { associateFavorites } from '../../src/api/associate-favorites.js';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  RateLimitedError,
  ServerError,
  UnauthorizedError,
  ValidationError,
  QuotaExceededError,
} from '../../src/api/errors.js';
import type { BulkResult, Event } from '@compass/contracts';

// Tests for the read operations and the two bulk operations (events-client, S1,
// tasks 8.1 and 8.2). Covers Property 19 (bulk results pass through successful and
// failed faithfully, Requirement 10.4) plus the read-operation success, validation
// and retry paths that give the operation path full coverage.

const sampleEvent: Event = {
  eventId: 'reinvent2026',
  name: 'AWS re:Invent 2026',
  eventType: 'conference',
  startDate: '2026-11-30T00:00:00-08:00',
  endDate: '2026-12-04T23:59:59-08:00',
  isOnline: false,
  authenticationRequired: true,
};

describe('events-client, task 8.1: read operations', () => {
  test('listEvents returns the wrapped items on a 200', async () => {
    const h = createHarness({ responses: [response(200, { items: [sampleEvent] })] });
    const result = await listEvents(h.ctx);
    expect(h.sent[0]?.path).toBe('/events');
    expect(h.sent[0]?.query).toEqual({});
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.eventId).toBe('reinvent2026');
    expect(h.sent[0]?.operation).toBe('ListEvents');
  });

  test('listEvents sends includePast as a query parameter', async () => {
    const h = createHarness({ responses: [response(200, { items: [] })] });
    await listEvents(h.ctx, { includePast: true });
    expect(h.sent[0]?.query).toEqual({ includePast: 'true' });
  });

  test('getEvent returns the wrapped event and encodes the id in the path', async () => {
    const h = createHarness({ responses: [response(200, { event: sampleEvent })] });
    const result = await getEvent(h.ctx, 'a b');
    expect(result.event.eventId).toBe('reinvent2026');
    expect(h.sent[0]?.path).toBe('/events/a%20b');
  });

  test('listSessions passes nextToken and includeAbstracts as query and validates', async () => {
    const h = createHarness({
      responses: [response(200, { items: [], totalCount: 0, nextToken: 'next' })],
    });
    const result = await listSessions(h.ctx, { nextToken: 't', includeAbstracts: false });
    expect(result.nextToken).toBe('next');
    expect(h.sent[0]?.path).toBe('/events/reinvent2026/sessions');
    expect(h.sent[0]?.query).toEqual({ nextToken: 't', includeAbstracts: 'false' });
  });

  test('listSessions sends locale and url-encodes the event id from the context', async () => {
    const h = createHarness({
      eventId: 'a b',
      responses: [response(200, { items: [], totalCount: 0 })],
    });
    await listSessions(h.ctx, { locale: 'en-US' });
    expect(h.sent[0]?.path).toBe('/events/a%20b/sessions');
    expect(h.sent[0]?.query).toEqual({ locale: 'en-US' });
  });

  test('listSessions with no params sends no query keys', async () => {
    const h = createHarness({ responses: [response(200, { items: [], totalCount: 0 })] });
    await listSessions(h.ctx);
    expect(h.sent[0]?.query).toEqual({});
  });

  test('getSession validates the envelope', async () => {
    const session = { sessionId: 'DAT302', title: 'Deep dive' };
    const h = createHarness({ responses: [response(200, { session })] });
    const result = await getSession(h.ctx, 'DAT302');
    expect(result.session.sessionId).toBe('DAT302');
    expect(h.sent[0]?.path).toBe('/events/reinvent2026/sessions/DAT302');
    expect(h.sent[0]?.query).toEqual({});
  });

  test('getSession encodes the session id and sends locale', async () => {
    const session = { sessionId: 'a b', title: 'Deep dive' };
    const h = createHarness({ responses: [response(200, { session })] });
    await getSession(h.ctx, 'a b', { locale: 'ja-JP' });
    expect(h.sent[0]?.path).toBe('/events/reinvent2026/sessions/a%20b');
    expect(h.sent[0]?.query).toEqual({ locale: 'ja-JP' });
  });

  test('getSchedule validates the envelope', async () => {
    const h = createHarness({
      responses: [response(200, { schedule: { reserved: [], favorites: [], personalTime: [] } })],
    });
    const result = await getSchedule(h.ctx);
    expect(result.schedule.reserved).toEqual([]);
    expect(h.sent[0]?.path).toBe('/events/reinvent2026/schedule');
  });

  test('an invalid 2xx body yields a ValidationError and never the raw body', async () => {
    const h = createHarness({ responses: [response(200, { items: 'not-an-array' })] });
    await expect(listEvents(h.ctx)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('events-client, task 8.1: error-status mapping on reads', () => {
  const cases: ReadonlyArray<{ status: number; error: new (...args: never[]) => Error }> = [
    { status: 400, error: BadRequestError },
    { status: 403, error: ForbiddenError },
    { status: 404, error: NotFoundError },
    { status: 409, error: ConflictError },
    { status: 500, error: ServerError },
  ];
  for (const { status, error } of cases) {
    test(`status ${String(status)} maps to its typed error`, async () => {
      const h = createHarness({ responses: [response(status, undefined)] });
      await expect(getSchedule(h.ctx)).rejects.toBeInstanceOf(error);
    });
  }

  test('a 401 refreshes once and retries once, then succeeds', async () => {
    const h = createHarness({
      responses: [
        response(401, undefined),
        response(200, { schedule: { reserved: [], favorites: [], personalTime: [] } }),
      ],
    });
    await getSchedule(h.ctx);
    expect(h.refreshes()).toBe(1);
    expect(h.sent).toHaveLength(2);
  });

  test('a second 401 after refresh maps to UnauthorizedError', async () => {
    const h = createHarness({ responses: [response(401, undefined), response(401, undefined)] });
    await expect(getSchedule(h.ctx)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(h.refreshes()).toBe(1);
  });

  test('a failed refresh on 401 maps to UnauthorizedError with no retry', async () => {
    const h = createHarness({ responses: [response(401, undefined)], refreshFails: true });
    await expect(getSchedule(h.ctx)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(h.sent).toHaveLength(1);
  });

  test('a 429 with a parseable Retry-After waits once then retries once', async () => {
    const h = createHarness({
      responses: [
        response(429, undefined, { 'retry-after': '2' }),
        response(200, { schedule: { reserved: [], favorites: [], personalTime: [] } }),
      ],
    });
    await getSchedule(h.ctx);
    expect(h.sleeps()).toEqual([2000]);
    expect(h.sent).toHaveLength(2);
  });

  test('a 429 without a parseable Retry-After maps to RateLimitedError without waiting', async () => {
    const h = createHarness({ responses: [response(429, undefined)] });
    await expect(getSchedule(h.ctx)).rejects.toBeInstanceOf(RateLimitedError);
    expect(h.sleeps()).toEqual([]);
  });

  test('a repeated 429 after the single wait maps to RateLimitedError', async () => {
    const h = createHarness({
      responses: [
        response(429, undefined, { 'retry-after': '1' }),
        response(429, undefined, { 'retry-after': '1' }),
      ],
    });
    await expect(getSchedule(h.ctx)).rejects.toBeInstanceOf(RateLimitedError);
    expect(h.sent).toHaveLength(2);
  });

  test('a metered operation over its per-minute limit raises QuotaExceededError before send', async () => {
    const ok = response(200, { schedule: { reserved: [], favorites: [], personalTime: [] } });
    // GetSchedule is metered at 60 per minute; the 61st call in the window is blocked.
    const h = createHarness({ responses: Array.from({ length: 60 }, () => ok) });
    for (let i = 0; i < 60; i += 1) {
      await getSchedule(h.ctx);
    }
    await expect(getSchedule(h.ctx)).rejects.toBeInstanceOf(QuotaExceededError);
    // The blocked call never reached the transport.
    expect(h.sent).toHaveLength(60);
  });
});

describe('events-client, task 8.1: ReserveSessions is never automatically re-sent', () => {
  const result: BulkResult = { successful: ['S1'], failed: [] };

  test('a 200 returns the wrapped BulkResult', async () => {
    const h = createHarness({ responses: [response(200, { result })] });
    const got = await reserveSessions(h.ctx, ['S1']);
    expect(got.result.successful).toEqual(['S1']);
    expect(h.sent[0]?.path).toBe('/events/reinvent2026/reservations');
  });

  test('a 401 refreshes once then fails without re-sending', async () => {
    const h = createHarness({ responses: [response(401, undefined)] });
    await expect(reserveSessions(h.ctx, ['S1'])).rejects.toBeInstanceOf(UnauthorizedError);
    expect(h.refreshes()).toBe(1);
    expect(h.sent).toHaveLength(1);
  });

  test('a 429 fails without waiting or re-sending', async () => {
    const h = createHarness({ responses: [response(429, undefined, { 'retry-after': '2' })] });
    await expect(reserveSessions(h.ctx, ['S1'])).rejects.toBeInstanceOf(RateLimitedError);
    expect(h.sleeps()).toEqual([]);
    expect(h.sent).toHaveLength(1);
  });

  test('a 5xx fails without re-sending', async () => {
    const h = createHarness({ responses: [response(503, undefined)] });
    await expect(reserveSessions(h.ctx, ['S1'])).rejects.toBeInstanceOf(ServerError);
    expect(h.sent).toHaveLength(1);
  });

  test('an out-of-range id list is rejected before any send', () => {
    const h = createHarness({ responses: [] });
    expect(() => reserveSessions(h.ctx, [])).toThrow(ValidationError);
    expect(h.sent).toHaveLength(0);
  });
});

describe('events-client, task 8.1: AssociateFavorites follows the ordinary retry policy', () => {
  test('a 401 refreshes once and retries once', async () => {
    const result: BulkResult = { successful: ['S1'], failed: [] };
    const h = createHarness({
      responses: [response(401, undefined), response(200, { result })],
    });
    const got = await associateFavorites(h.ctx, ['S1']);
    expect(got.result.successful).toEqual(['S1']);
    expect(h.sent).toHaveLength(2);
    expect(h.sent[0]?.path).toBe('/events/reinvent2026/favorites');
  });
});

describe('events-client: the single retry counts against the quota', () => {
  const schedule = { schedule: { reserved: [], favorites: [], personalTime: [] } };
  const ok = response(200, schedule);

  test('a 401 retry that would exceed the limit throws QuotaExceededError and is not sent', async () => {
    // GetSchedule allows 60 per minute. 59 calls, then a call whose first send is the
    // 60th unit; its 401 retry would be the 61st and must be blocked.
    const h = createHarness({
      responses: [...Array.from({ length: 59 }, () => ok), response(401, undefined)],
    });
    for (let i = 0; i < 59; i += 1) {
      await getSchedule(h.ctx);
    }
    await expect(getSchedule(h.ctx)).rejects.toBeInstanceOf(QuotaExceededError);
    expect(h.refreshes()).toBe(1);
    expect(h.sent).toHaveLength(60);
  });

  test('a 401 retry within the limit is recorded as a second unit', async () => {
    const h = createHarness({
      responses: [response(401, undefined), ok, ...Array.from({ length: 58 }, () => ok)],
    });
    await getSchedule(h.ctx);
    // 2 units used by the first call; 58 more fill the window to 60.
    for (let i = 0; i < 58; i += 1) {
      await getSchedule(h.ctx);
    }
    await expect(getSchedule(h.ctx)).rejects.toBeInstanceOf(QuotaExceededError);
  });

  test('a 429 retry blocked by the quota throws QuotaExceededError and is not sent', async () => {
    // The tracker blocks the operation until Retry-After has elapsed. The wrapped
    // sleep waits one millisecond too little, so the retry is still blocked.
    const h = createHarness({
      responses: [response(429, undefined, { 'retry-after': '5' })],
    });
    const realSleep = h.ctx.sleep;
    h.ctx.sleep = async (ms: number) => {
      await realSleep(ms - 1);
    };
    await expect(getSchedule(h.ctx)).rejects.toBeInstanceOf(QuotaExceededError);
    expect(h.sent).toHaveLength(1);
  });

  test('an unmetered operation 401 retry is never blocked by the tracker', async () => {
    const h = createHarness({
      responses: [response(401, undefined), response(200, { items: [] })],
    });
    await listEvents(h.ctx);
    expect(h.sent).toHaveLength(2);
  });
});

describe('Feature: events-client, Property 19: Bulk results pass through successful and failed faithfully', () => {
  const idArb = fc.stringMatching(/^[A-Za-z0-9_-]{1,8}$/);
  const failureArb = fc.record({
    sessionId: idArb,
    code: fc.constantFrom('sessionFull', 'scheduleConflict', 'alreadyScheduled', 'brandNewCode'),
  });

  test('reserveSessions returns exactly the successful and failed arrays from the wire', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(idArb, { minLength: 1, maxLength: 10 }).filter((a) => a.length >= 1),
        fc.array(failureArb, { maxLength: 5 }),
        async (successful, failed) => {
          const wire: BulkResult = { successful, failed };
          const h = createHarness({ responses: [response(200, { result: wire })] });
          const got = await reserveSessions(h.ctx, successful.length > 0 ? successful : ['x']);
          expect(got.result.successful).toEqual(successful);
          expect(got.result.failed).toEqual(failed);
        },
      ),
      { numRuns: 100 },
    );
  });

  test('an empty successful and empty failed pass through unchanged', async () => {
    const wire: BulkResult = { successful: [], failed: [] };
    const h = createHarness({ responses: [response(200, { result: wire })] });
    const got = await associateFavorites(h.ctx, ['only']);
    expect(got.result.successful).toEqual([]);
    expect(got.result.failed).toEqual([]);
  });
});

describe('events-client, QA H1 (Requirement 12.9): every 429 blocks the next call of that operation', () => {
  const schedule = response(200, { schedule: { reserved: [], favorites: [], personalTime: [] } });

  test('a 429 that fails the call (no Retry-After) blocks an immediate second call for 30 seconds', async () => {
    const h = createHarness({ responses: [response(429, undefined), schedule, schedule] });
    await expect(getSchedule(h.ctx)).rejects.toBeInstanceOf(RateLimitedError);
    expect(h.sent).toHaveLength(1);
    await expect(getSchedule(h.ctx)).rejects.toBeInstanceOf(QuotaExceededError);
    expect(h.sent).toHaveLength(1);
  });

  test('the default block is 30 seconds, and an invalid Retry-After uses it too', async () => {
    for (const header of [undefined, 'abc', '121', '-1']) {
      const h = createHarness({
        responses: [
          response(429, undefined, header === undefined ? {} : { 'retry-after': header }),
          schedule,
        ],
      });
      await expect(getSchedule(h.ctx)).rejects.toBeInstanceOf(RateLimitedError);
      await h.ctx.sleep(29_999);
      await expect(getSchedule(h.ctx)).rejects.toBeInstanceOf(QuotaExceededError);
      await h.ctx.sleep(1);
      await expect(getSchedule(h.ctx)).resolves.toBeDefined();
    }
    expect(DEFAULT_RATE_LIMIT_BLOCK_SECONDS).toBe(30);
  });

  test('ReserveSessions is blocked after its 429 as well, with nothing sent', async () => {
    const result: BulkResult = { successful: ['S1'], failed: [] };
    const h = createHarness({
      responses: [response(429, undefined, { 'retry-after': '10' }), response(200, { result })],
    });
    await expect(reserveSessions(h.ctx, ['S1'])).rejects.toBeInstanceOf(RateLimitedError);
    await expect(reserveSessions(h.ctx, ['S1'])).rejects.toBeInstanceOf(QuotaExceededError);
    expect(h.sent).toHaveLength(1);
    await h.ctx.sleep(10_000);
    await expect(reserveSessions(h.ctx, ['S1'])).resolves.toBeDefined();
  });

  test('a 429 on an unmetered operation also blocks the next call', async () => {
    const h = createHarness({
      responses: [response(429, undefined), response(200, { items: [] })],
    });
    await expect(listEvents(h.ctx)).rejects.toBeInstanceOf(RateLimitedError);
    await expect(listEvents(h.ctx)).rejects.toBeInstanceOf(QuotaExceededError);
    expect(h.sent).toHaveLength(1);
  });

  test('a 429 that answers the single retry blocks the next call too', async () => {
    const h = createHarness({
      responses: [
        response(429, undefined, { 'retry-after': '1' }),
        response(429, undefined, { 'retry-after': '20' }),
        schedule,
      ],
    });
    await expect(getSchedule(h.ctx)).rejects.toBeInstanceOf(RateLimitedError);
    expect(h.sent).toHaveLength(2);
    await expect(getSchedule(h.ctx)).rejects.toBeInstanceOf(QuotaExceededError);
    expect(h.sent).toHaveLength(2);
  });

  test('a 429 that answers the retry after a 401 refresh blocks the next call', async () => {
    const h = createHarness({
      responses: [
        response(401, undefined),
        response(429, undefined, { 'retry-after': '20' }),
        schedule,
      ],
    });
    await expect(getSchedule(h.ctx)).rejects.toBeInstanceOf(RateLimitedError);
    await expect(getSchedule(h.ctx)).rejects.toBeInstanceOf(QuotaExceededError);
    expect(h.sent).toHaveLength(2);
  });
});
