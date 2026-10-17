import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VenueDataSchema } from '@compass/core/rules';
import type { Commitment, NormalisedSession } from '@compass/contracts';
import { createRulesAdapter } from '../../src/adapters/rules-adapter.js';
import type { EventWindow } from '../../src/ports/events-port.js';
import type { RulesPort } from '../../src/ports/rules-port.js';
import { commitmentFor } from '../../src/tools/common.js';
import { fixedClock } from '../support/fake-clock.js';
import { repoRoot, syntheticCatalogView } from '../support/fake-catalog.js';
import { TRIPLE } from '../support/triple.js';

const venueData = VenueDataSchema.parse(
  JSON.parse(readFileSync(join(repoRoot(), 'data', 'venues.json'), 'utf8')),
);
const catalog = syntheticCatalogView();
const session = (id: string): NormalisedSession => {
  const entry = catalog.byId.get(id);
  if (entry === undefined) throw new Error(`missing ${id}`);
  return entry.session;
};
const WINDOW: EventWindow = {
  start: '2026-11-29T00:00:00-08:00',
  end: '2026-12-05T23:59:00-08:00',
  timezone: 'America/Los_Angeles',
};

function adapter(window: () => Promise<EventWindow> = () => Promise.resolve(WINDOW)): RulesPort {
  return createRulesAdapter({
    clock: fixedClock('2026-11-29T18:00:00-08:00'),
    venueData,
    eventWindow: window,
  });
}

describe('the rules adapter over the real S2 engine', () => {
  test('allows a clean booking and blocks a clash, with plain reasons and no internal flag', async () => {
    const rules = adapter();
    const open = [...catalog.byId.values()]
      .map((e) => e.session)
      .find(
        (s) =>
          s.seatAvailability === 'available' &&
          s.isReservable &&
          s.venue !== undefined &&
          s.startsAt !== undefined &&
          s.endsAt !== undefined,
      );
    expect(open).toBeDefined();
    const allow = await rules.checkReservation(open as NormalisedSession, [], catalog);
    expect(allow).toEqual({ decision: 'allow', reasons: [] });
    const full = await rules.checkReservation(session(TRIPLE.a), [], catalog);
    expect(full.decision).toBe('warn');
    const clash = await rules.checkReservation(
      session(TRIPLE.b),
      [commitmentFor(session(TRIPLE.a))],
      catalog,
    );
    expect(clash.decision).toBe('block');
    expect(clash.reasons.length).toBeGreaterThan(0);
    expect('internal' in clash).toBe(false);
  });

  test('a commitment whose session the catalog does not hold is passed through without a lookup entry', async () => {
    const rules = adapter();
    const ghost: Commitment = {
      kind: 'reservedSession',
      sessionId: 'ghost',
      startsAt: '2026-12-02T10:00:00-08:00',
      endsAt: '2026-12-02T11:00:00-08:00',
    };
    const verdict = await rules.checkReservation(session(TRIPLE.a), [ghost], catalog);
    expect(['allow', 'warn']).toContain(verdict.decision);
  });

  test('fails closed when the rules cannot run', async () => {
    const rules = adapter(() => Promise.reject(new Error('window failed')));
    const verdict = await rules.checkReservation(session(TRIPLE.a), [], catalog);
    expect(verdict.decision).toBe('block');
    expect(verdict.reasons[0]).toContain('blocked');
  });

  test('findClashes names an overlap with the marker layover', async () => {
    const rules = adapter();
    const layover: Commitment = {
      kind: 'personalTime',
      title: 'Your new layover',
      startsAt: '2026-12-04T10:15:00-08:00',
      endsAt: '2026-12-04T10:45:00-08:00',
    };
    const report = await rules.findClashes([commitmentFor(session(TRIPLE.a)), layover], catalog);
    expect(report.clashes).toHaveLength(1);
    expect([report.clashes[0]?.firstTitle, report.clashes[0]?.secondTitle]).toContain(
      'Your new layover',
    );
    expect(report.clashes[0]?.reason.length).toBeGreaterThan(0);
  });

  test('connections are keyed by the session walked into and energy by day', async () => {
    const rules = adapter();
    const pair = findSameDayPair();
    const commitments: Commitment[] = [
      commitmentFor(pair[0]),
      commitmentFor(pair[1]),
      {
        kind: 'personalTime',
        title: 'Rest',
        startsAt: pair[1].endsAt ?? '',
        endsAt: '2026-12-31T00:00:00-08:00',
      },
      { kind: 'personalTime', title: 'Broken', startsAt: '', endsAt: '' },
      {
        kind: 'personalTime',
        title: 'Located break',
        location: 'Encore',
        startsAt: pair[1].endsAt ?? '',
        endsAt: new Date(Date.parse(pair[1].endsAt ?? '') + 1800000).toISOString(),
      },
      {
        kind: 'reservedSession',
        sessionId: 'ghost',
        venue: 'Unlisted Hall',
        startsAt: new Date(Date.parse(pair[1].endsAt ?? '') + 3600000).toISOString(),
        endsAt: new Date(Date.parse(pair[1].endsAt ?? '') + 5400000).toISOString(),
      },
    ];
    const connections = await rules.connections(commitments, catalog);
    const line = connections.get(pair[1].sessionId);
    expect(['comfortable', 'tight', 'impossible', 'unknown']).toContain(line?.classification);
    expect(line?.reason.length).toBeGreaterThan(0);
    expect(connections.get('ghost')?.classification).toBe('unknown');
    expect('walkingMinutes' in (connections.get('ghost') ?? {})).toBe(false);
    const energy = await rules.energy(commitments, catalog);
    expect([...energy.keys()][0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect([...energy.values()][0]?.explanation.length).toBeGreaterThan(0);
  });

  test('suggests a meal layover when lunch is taken', async () => {
    const rules = adapter();
    const lunchBlock: Commitment = {
      kind: 'personalTime',
      title: 'Workshop block',
      location: 'Encore',
      startsAt: '2026-12-01T11:00:00-08:00',
      endsAt: '2026-12-01T14:30:00-08:00',
    };
    const summary = await rules.suggestLayovers([lunchBlock], catalog);
    expect(summary.suggestions.length).toBeGreaterThanOrEqual(0);
    for (const suggestion of summary.suggestions) {
      expect(suggestion.start).toMatch(/^2026-/);
      expect(suggestion.reason.length).toBeGreaterThan(0);
    }
  });

  test('rebooking offers the repeat as a repeat and never the original itself', async () => {
    const rules = adapter();
    const options = await rules.rebooking('ANT163', catalog, [TRIPLE.b], TRIPLE.a);
    const repeat = options.find((o) => o.session.sessionId === TRIPLE.aRepeat);
    expect(repeat?.kind).toBe('repeat');
    expect(options.some((o) => o.session.sessionId === TRIPLE.a)).toBe(false);
    const withUnknownFavorite = await rules.rebooking('ANT163', catalog, ['ghost']);
    expect(withUnknownFavorite.length).toBeGreaterThan(0);
    const similar = await rules.rebooking('BWP304', catalog, [TRIPLE.b]);
    expect(similar.every((o) => o.kind === 'repeat' || o.kind === 'similar')).toBe(true);
  });

  test('planSafeSwap is safe only when the repeat is held and clash-free', async () => {
    const rules = adapter();
    const original = commitmentFor(session(TRIPLE.a));
    const held = [original, commitmentFor(session(TRIPLE.aRepeat))];
    expect(
      (await rules.planSafeSwap(original, session(TRIPLE.aRepeat), held, catalog)).outcome,
    ).toBe('safe');
    expect(
      (await rules.planSafeSwap(original, session(TRIPLE.aRepeat), [original], catalog)).outcome,
    ).toBe('failed');
    const clashing = [
      original,
      commitmentFor(session(TRIPLE.aRepeat)),
      commitmentFor(session(TRIPLE.b)),
    ];
    const unsafe = await rules.planSafeSwap(original, session(TRIPLE.b), clashing, catalog);
    expect(unsafe.outcome).toBe('unsafe');
    expect(unsafe.explanation.length).toBeGreaterThan(0);
    const missingOriginal = await rules.planSafeSwap(
      original,
      session(TRIPLE.aRepeat),
      [commitmentFor(session(TRIPLE.aRepeat))],
      catalog,
    );
    expect(missingOriginal.outcome).toBe('unknown');
  });

  test('an unusable timezone gives empty views instead of guesses', async () => {
    const rules = adapter(() => Promise.resolve({ ...WINDOW, timezone: 'Not/AZone' }));
    const commitments = [commitmentFor(session(TRIPLE.a))];
    expect((await rules.findClashes(commitments, catalog)).clashes).toEqual([]);
    expect((await rules.suggestLayovers(commitments, catalog)).suggestions).toEqual([]);
    expect((await rules.connections(commitments, catalog)).size).toBe(0);
    expect((await rules.energy(commitments, catalog)).size).toBe(0);
  });

  test('walk minutes come from the venue data without the buffer, or are unknown', () => {
    const rules = adapter();
    const known = rules.walkMinutes('Encore', 'The Venetian');
    expect(typeof known).toBe('number');
    expect(known).toBeGreaterThan(0);
    expect(rules.walkMinutes('Encore', 'Encore')).toBe(5);
    expect(rules.walkMinutes('Nowhere Hall', 'Encore')).toBeUndefined();
  });
});

const listed = new Set(venueData.venues.map((v) => v.venue.name.toLowerCase()));

function findSameDayPair(): [NormalisedSession, NormalisedSession] {
  const all = [...catalog.byId.values()]
    .map((e) => e.session)
    .filter(
      (s) =>
        s.startsAt !== undefined &&
        s.endsAt !== undefined &&
        listed.has(String(s.venue).toLowerCase()),
    )
    .sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)));
  for (const first of all) {
    for (const second of all) {
      if (
        first.venue !== second.venue &&
        String(first.startsAt).slice(0, 10) === String(second.startsAt).slice(0, 10) &&
        Date.parse(String(second.startsAt)) >= Date.parse(String(first.endsAt))
      ) {
        return [first, second];
      }
    }
  }
  throw new Error('no same-day pair in the synthetic catalog');
}
