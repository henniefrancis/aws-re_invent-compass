import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { createHarness, response } from './operation-harness.js';
import { listEvents } from '../../src/api/list-events.js';
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
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.eventId).toBe('reinvent2026');
    expect(h.sent[0]?.operation).toBe('ListEvents');
  });

  test('getEvent returns the wrapped event and encodes the id in the path', async () => {
    const h = createHarness({ responses: [response(200, { event: sampleEvent })] });
    const result = await getEvent(h.ctx, 'a b/c');
    expect(result.event.eventId).toBe('reinvent2026');
    expect(h.sent[0]?.path).toBe('/events/a%20b%2Fc');
  });

  test('listSessions passes nextToken and includeAbstracts as query and validates', async () => {
    const h = createHarness({
      responses: [response(200, { items: [], totalCount: 0, nextToken: 'next' })],
    });
    const result = await listSessions(h.ctx, { nextToken: 't', includeAbstracts: false });
    expect(result.nextToken).toBe('next');
    expect(h.sent[0]?.query).toEqual({ nextToken: 't', includeAbstracts: 'false' });
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
  });

  test('getSchedule validates the envelope', async () => {
    const h = createHarness({
      responses: [response(200, { schedule: { reserved: [], favorites: [], personalTime: [] } })],
    });
    const result = await getSchedule(h.ctx);
    expect(result.schedule.reserved).toEqual([]);
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
  });
});

describe('Feature: events-client, Property 19: Bulk results pass through successful and failed faithfully', () => {
  const idArb = fc.string({ minLength: 1, maxLength: 8 });
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
