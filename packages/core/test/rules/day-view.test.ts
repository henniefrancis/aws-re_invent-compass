import { describe, expect, test } from 'vitest';
import * as fc from 'fast-check';
import { boardingFor } from '../../src/rules/boarding.js';
import { classifyConnection } from '../../src/rules/connections.js';
import { connectionsForDay, energyForDay } from '../../src/rules/day-view.js';
import { scoreEnergy } from '../../src/rules/energy.js';
import { resolveCommitment } from '../../src/rules/resolve.js';
import { personal, scheduleOf, session, testContext } from './helpers.js';

// Tests for the per-day helpers (itinerary-rules, S2). All sample data is self-made.

const MIDNIGHT = Date.parse('2026-12-01T08:00:00Z'); // 00:00 Pacific on 1 December 2026
const iso = (ms: number): string => new Date(ms).toISOString();
const clock = (h: number, m = 0): number => h * 60 + m;
const slot = (
  code: string,
  startMin: number,
  endMin: number,
  venue: string | undefined = 'Alpha Hall',
  overrides = {},
) =>
  session({
    sessionId: code.toLowerCase(),
    code,
    venue,
    startsAt: iso(MIDNIGHT + startMin * 60_000),
    endsAt: iso(MIDNIGHT + endMin * 60_000),
    ...overrides,
  });

describe('connectionsForDay', () => {
  test('gives the verdict between each pair of consecutive commitments, in time order', () => {
    const a = slot('AAA1', clock(9), clock(10), 'Alpha Hall');
    const b = slot('BBB1', clock(10, 33), clock(11, 30), 'Beta Tower');
    const c = slot('CCC1', clock(13), clock(14), 'Gamma Plaza');
    const result = connectionsForDay(scheduleOf([c, a, b]), testContext());
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.connections.map((x) => [x.from, x.to, x.result.classification])).toEqual([
        ['AAA1', 'BBB1', 'tight'],
        ['BBB1', 'CCC1', 'comfortable'],
      ]);
      expect(result.skipped).toEqual([]);
    }
  });

  test('a day with fewer than two commitments has no connections', () => {
    expect(connectionsForDay(scheduleOf([]), testContext())).toEqual({
      status: 'ok',
      connections: [],
      skipped: [],
    });
    const one = connectionsForDay(scheduleOf([slot('AAA1', 600, 660)]), testContext());
    expect(one).toMatchObject({ status: 'ok', connections: [] });
  });

  test('keeps only the asked-for day, leaves out all-day items, and lists unplaceable ones', () => {
    const monday = [
      slot('AAA1', clock(9), clock(10)),
      slot('BBB1', clock(12), clock(13), 'Beta Tower'),
    ];
    const tuesday = slot('TUE1', clock(24 + 9), clock(24 + 10));
    const expo = slot('EXPO', clock(9), clock(10), 'Alpha Hall', {
      isAllDay: true,
      endsAt: undefined,
    });
    const noStart = slot('NOSTART', 0, 60, 'Alpha Hall', { startsAt: undefined });
    const schedule = scheduleOf([...monday, tuesday, expo, noStart]);
    const result = connectionsForDay(schedule, testContext(), '2026-12-01');
    expect(result).toMatchObject({ status: 'ok' });
    if (result.status === 'ok') {
      expect(result.connections.map((x) => `${x.from}>${x.to}`)).toEqual(['AAA1>BBB1']);
      expect(result.skipped).toEqual([
        {
          ref: 'NOSTART',
          reason: 'The start time of "NOSTART" is missing. It is left out of the day view.',
        },
      ]);
    }
    const other = connectionsForDay(schedule, testContext(), '2026-12-02');
    expect(other).toMatchObject({ status: 'ok', connections: [] });
  });

  test('a missing or unrecognised timezone is unknown', () => {
    const schedule = scheduleOf([slot('AAA1', 600, 660)]);
    const missing = connectionsForDay(schedule, testContext({ eventTimezone: undefined }));
    expect(missing).toMatchObject({ status: 'unknown' });
    expect(missing.status === 'unknown' && missing.reason).toContain('timezone is missing');
    expect(connectionsForDay(schedule, testContext({ eventTimezone: 'Nope/Nowhere' })).status).toBe(
      'unknown',
    );
  });

  // Feature: itinerary-rules, Property 5: Connection classification follows spare time against the due time, with walking minutes and a naming reason
  test('Property 5: each day connection equals classifyConnection on the same pair', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            start: fc.integer({ min: 0, max: 1200 }),
            length: fc.integer({ min: 1, max: 120 }),
            venue: fc.constantFrom<string | undefined>(
              'Alpha Hall',
              'Beta Tower',
              'Gamma Plaza',
              undefined,
            ),
          }),
          { maxLength: 6 },
        ),
        (raw) => {
          const sessions = raw.map((r, i) => slot(`S${i}`, r.start, r.start + r.length, r.venue));
          const schedule = scheduleOf(sessions);
          const context = testContext();
          const result = connectionsForDay(schedule, context);
          expect(result.status).toBe('ok');
          if (result.status !== 'ok') return;
          const sorted = sessions
            .map((s) =>
              resolveCommitment(
                { kind: 'reservedSession', sessionId: s.sessionId, startsAt: '', endsAt: '' },
                schedule.sessions,
              ),
            )
            .sort((a, b) => Date.parse(a.startsAt!) - Date.parse(b.startsAt!));
          expect(result.connections).toHaveLength(Math.max(0, raw.length - 1));
          result.connections.forEach((connection, i) => {
            const from = sorted[i];
            const to = sorted[i + 1];
            const boarding = boardingFor(
              { isReservable: to.isReservable, startsAt: to.startsAt },
              context,
            );
            expect(connection).toEqual({
              from: from.ref,
              to: to.ref,
              result: classifyConnection(from, to, boarding, context),
            });
          });
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('connectionsForDay and stay-put personal time', () => {
  const rest = (title: string, startMin: number, endMin: number) =>
    personal(title, iso(MIDNIGHT + startMin * 60_000), iso(MIDNIGHT + endMin * 60_000));

  test('stay-put time takes the venue before it, and no connection is drawn into it', () => {
    const a = slot('AAA1', clock(9), clock(10), 'Beta Tower');
    const b = slot('BBB1', clock(11), clock(12), 'Alpha Hall');
    const schedule = scheduleOf([a, b], [rest('Rest', clock(10), clock(10, 30))]);
    const result = connectionsForDay(schedule, testContext());
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      // AAA1 to Rest is skipped (stay put). Rest to BBB1 leaves from Beta Tower, the venue it kept.
      expect(result.connections.map((c) => `${c.from}>${c.to}:${c.result.classification}`)).toEqual(
        ['Rest>BBB1:tight'],
      );
      expect(result.connections[0].result.reason).toContain('"Beta Tower" to "Alpha Hall"');
    }
  });

  test('stay-put time with nothing before it has no venue to leave from: skipped, not unknown', () => {
    const b = slot('BBB1', clock(11), clock(12), 'Alpha Hall');
    const result = connectionsForDay(
      scheduleOf([b], [rest('Rest', clock(8), clock(9))]),
      testContext(),
    );
    expect(result).toMatchObject({ status: 'ok', connections: [] });
  });
});

describe('energyForDay', () => {
  test('scores the commitments of the day', () => {
    const schedule = scheduleOf(
      [slot('AAA1', clock(9), clock(10)), slot('BBB1', clock(11), clock(12), 'Beta Tower')],
      [
        personal(
          'Lunch',
          iso(MIDNIGHT + clock(12, 30) * 60_000),
          iso(MIDNIGHT + clock(13) * 60_000),
          'Beta Tower',
        ),
      ],
    );
    const result = energyForDay(schedule, testContext());
    expect(result).toMatchObject({
      status: 'ok',
      energy: { commitmentCount: 3, totalWalkingMinutes: 35, venueChangeCount: 1, score: 80 },
      skipped: [],
    });
  });

  test('keeps only the asked-for day and lists commitments with no usable start', () => {
    const schedule = scheduleOf([
      slot('AAA1', clock(9), clock(10)),
      slot('TUE1', clock(24 + 9), clock(24 + 10)),
      slot('NOSTART', 0, 60, 'Alpha Hall', { startsAt: undefined }),
    ]);
    const result = energyForDay(schedule, testContext(), '2026-12-01');
    expect(result).toMatchObject({ status: 'ok', energy: { commitmentCount: 1 } });
    expect(result.status === 'ok' && result.skipped.map((s) => s.ref)).toEqual(['NOSTART']);
    expect(energyForDay(schedule, testContext(), '2026-12-05')).toMatchObject({
      energy: { commitmentCount: 0, score: 0 },
    });
  });

  test('a missing or unrecognised timezone is unknown', () => {
    const schedule = scheduleOf([slot('AAA1', 600, 660)]);
    expect(energyForDay(schedule, testContext({ eventTimezone: undefined })).status).toBe(
      'unknown',
    );
    const bad = energyForDay(schedule, testContext({ eventTimezone: 'Nope/Nowhere' }));
    expect(bad.status === 'unknown' && bad.reason).toContain('not recognised');
  });

  // Feature: itinerary-rules, Property 11: Energy budget formula, overload threshold and count-only fallback, and explanation
  test('Property 11: the day energy equals scoreEnergy on the resolved day, and respects the threshold', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            start: fc.integer({ min: 0, max: 1200 }),
            length: fc.integer({ min: 1, max: 120 }),
            venue: fc.constantFrom<string | undefined>('Alpha Hall', 'Beta Tower', undefined),
          }),
          { maxLength: 6 },
        ),
        fc.integer({ min: 0, max: 150 }),
        (raw, threshold) => {
          const sessions = raw.map((r, i) => slot(`S${i}`, r.start, r.start + r.length, r.venue));
          const schedule = scheduleOf(sessions);
          const context = testContext({ overloadThreshold: threshold });
          const result = energyForDay(schedule, context, '2026-12-01');
          expect(result.status).toBe('ok');
          if (result.status !== 'ok') return;
          const resolved = schedule.commitments.map((c) => resolveCommitment(c, schedule.sessions));
          expect(result.energy).toEqual(scoreEnergy(resolved, context));
          expect(result.energy.overloaded).toBe(result.energy.score > threshold);
        },
      ),
      { numRuns: 200 },
    );
  });
});
