import { describe, expect, test, vi } from 'vitest';
import * as fc from 'fast-check';
import * as rules from '../../src/rules/index.js';
import type { Commitment, NormalisedSession } from '@compass/contracts';
import { personal, reserved, scheduleOf, session, testContext, testVenueData } from './helpers.js';

// Tests for the public surface of @compass/core/rules (itinerary-rules, S2): that it exposes
// what consumers need, runs with no I/O, is deterministic, and never changes an input.
// Requirements: 8.1, 10.1, 10.3, 10.5, 10.6. All sample data is self-made.

const MIDNIGHT = Date.parse('2026-12-01T08:00:00Z');
const iso = (ms: number): string => new Date(ms).toISOString();
const slot = (code: string, startMin: number, endMin: number, venue = 'Alpha Hall') =>
  session({
    sessionId: code.toLowerCase(),
    code,
    venue,
    startsAt: iso(MIDNIGHT + startMin * 60_000),
    endsAt: iso(MIDNIGHT + endMin * 60_000),
  });

/** Freeze a value and everything inside it, so any write to it throws in strict mode. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    (Object.values(value) as unknown[]).forEach((inner) => deepFreeze(inner));
  }
  return value;
}

interface Sample {
  candidate: NormalisedSession;
  schedule: ReturnType<typeof scheduleOf>;
  original: Commitment;
  repeat: NormalisedSession;
  favorites: NormalisedSession[];
  candidates: NormalisedSession[];
  context: ReturnType<typeof testContext>;
}

function sample(): Sample {
  const earlier = slot('OLD1', 9 * 60, 10 * 60, 'Beta Tower');
  const repeat = session({
    sessionId: 'rep',
    code: 'NEW1-R',
    startsAt: iso(MIDNIGHT + (24 * 60 + 10 * 60) * 60_000),
    endsAt: iso(MIDNIGHT + (24 * 60 + 11 * 60) * 60_000),
  });
  const candidate = slot('NEW1', 10 * 60 + 33, 11 * 60 + 33);
  const lunch = personal(
    'Lunch',
    iso(MIDNIGHT + 12 * 60 * 60_000),
    iso(MIDNIGHT + 12.5 * 60 * 60_000),
    'Alpha Hall',
  );
  return {
    candidate,
    schedule: scheduleOf([earlier], [lunch]),
    original: reserved(candidate),
    repeat,
    favorites: [repeat],
    candidates: [repeat, candidate],
    context: testContext(),
  };
}

/** Call every exported function with the sample inputs, returning each result. */
function callAll(s: Sample): Record<string, unknown> {
  const resolvedA = rules.resolveCommitment(s.schedule.commitments[0], s.schedule.sessions);
  const resolvedB = rules.resolveCommitment(reserved(s.candidate), {
    [s.candidate.sessionId]: s.candidate,
  });
  const boarding = rules.boardingFor(
    { isReservable: resolvedB.isReservable, startsAt: resolvedB.startsAt },
    s.context,
  );
  return {
    withContextDefaults: rules.withContextDefaults({
      now: s.context.now,
      venueData: s.context.venueData,
    }),
    resolveCommitment: resolvedA,
    computeBoarding: rules.computeBoarding(s.candidate, s.context),
    boardingFor: boarding,
    classifyConnection: rules.classifyConnection(resolvedA, resolvedB, boarding, s.context),
    findClashes: rules.findClashes(s.schedule, s.context),
    checkLayovers: rules.checkLayovers(s.schedule, s.context),
    isOverloaded: rules.isOverloaded([resolvedA, resolvedB], s.context),
    scoreEnergy: rules.scoreEnergy([resolvedA, resolvedB], s.context),
    connectionsForDay: rules.connectionsForDay(s.schedule, s.context),
    energyForDay: rules.energyForDay(s.schedule, s.context),
    findRebookingOptions: rules.findRebookingOptions('NEW1', s.candidates, s.favorites, s.context),
    planSafeSwap: rules.planSafeSwap(s.original, s.repeat, s.schedule, s.context),
    checkReservation: rules.checkReservation(s.candidate, s.schedule, s.context),
    validateVenueData: rules.validateVenueData(testVenueData()),
  };
}

describe('public surface', () => {
  test('exposes the guardrail, the rules and the helpers consumers need', () => {
    for (const name of [
      'checkReservation',
      'computeBoarding',
      'boardingFor',
      'classifyConnection',
      'findClashes',
      'checkLayovers',
      'isOverloaded',
      'scoreEnergy',
      'connectionsForDay',
      'energyForDay',
      'findRebookingOptions',
      'planSafeSwap',
      'resolveCommitment',
      'withContextDefaults',
      'validateVenueData',
    ]) {
      expect(typeof (rules as Record<string, unknown>)[name]).toBe('function');
    }
    expect(rules.ContextSchema).toBeDefined();
    expect(rules.VenueDataSchema).toBeDefined();
    expect(rules.CONTEXT_DEFAULTS.bufferMinutes).toBe(10);
  });

  test('does not leak internal helpers', () => {
    const names = Object.keys(rules);
    for (const internal of ['parseInstant', 'checkZone', 'clean', 'label', 'lookupWalk']) {
      expect(names).not.toContain(internal);
    }
  });

  test('resolveCommitment and withContextDefaults let a caller build classifyConnection inputs', () => {
    const context = rules.withContextDefaults({
      now: '2026-12-01T06:00:00-08:00',
      eventTimezone: 'America/Los_Angeles',
      venueData: testVenueData(),
    });
    const a = slot('AAA1', 9 * 60, 10 * 60, 'Alpha Hall');
    const b = slot('BBB1', 11 * 60, 12 * 60, 'Beta Tower');
    const sessions = { [a.sessionId]: a, [b.sessionId]: b };
    const from = rules.resolveCommitment(reserved(a), sessions);
    const to = rules.resolveCommitment(reserved(b), sessions);
    const toBoarding = rules.boardingFor(
      { isReservable: to.isReservable, startsAt: to.startsAt },
      context,
    );
    expect(rules.classifyConnection(from, to, toBoarding, context)).toMatchObject({
      classification: 'comfortable',
      walkingMinutes: 20,
    });
  });
});

describe('subpath export', () => {
  test('@compass/core/rules resolves to this public surface', async () => {
    const specifier = '@compass/core/rules';
    // The package subpath resolves to the built output, which exists once tsc -b has run.
    const viaSubpath = (await import(specifier).catch(() => undefined)) as
      Record<string, unknown> | undefined;
    if (viaSubpath === undefined) return;
    expect(Object.keys(viaSubpath).sort()).toEqual(Object.keys(rules).sort());
    const viaFn = viaSubpath.checkReservation as typeof rules.checkReservation;
    const { candidate, schedule, context } = sample();
    expect(viaFn(candidate, schedule, context)).toEqual(
      rules.checkReservation(candidate, schedule, context),
    );
  });
});

describe('browser-safe execution (no I/O)', () => {
  test('every exported function runs without a reference error and without any I/O', () => {
    const spies = [
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'error'),
      vi.spyOn(globalThis, 'setTimeout'),
      vi.spyOn(globalThis, 'setInterval'),
      vi.spyOn(globalThis, 'fetch'),
    ];
    const results = callAll(sample());
    expect(Object.keys(results).length).toBeGreaterThanOrEqual(15);
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });

  test('every function gives usable answers for the sample', () => {
    const results = callAll(sample());
    expect(results.checkReservation).toMatchObject({ decision: 'warn' });
    expect(results.findClashes).toMatchObject({ status: 'ok' });
    expect(results.computeBoarding).toMatchObject({ status: 'closes' });
  });
});

describe('no clock, randomness, performance timer or network at run time', () => {
  test('checkReservation and the rules run with every such source made to throw', () => {
    const boom = (): never => {
      throw new Error('forbidden at run time');
    };
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(boom);
    const random = vi.spyOn(Math, 'random').mockImplementation(boom);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(boom);
    vi.stubGlobal('performance', new Proxy({}, { get: boom }));
    try {
      // A throw anywhere inside checkReservation would be caught and turned into a block, so the
      // verdict itself proves nothing was called. The other functions are called directly.
      const s = sample();
      const verdict = rules.checkReservation(s.candidate, s.schedule, s.context);
      expect(verdict.reasons.join(' ')).not.toContain('internal error');
      expect(() => callAll(s)).not.toThrow();
      expect(dateNow).not.toHaveBeenCalled();
      expect(random).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      dateNow.mockRestore();
      random.mockRestore();
      fetchSpy.mockRestore();
    }
  });
});

describe('determinism and purity', () => {
  test('calling each exported function twice on deeply equal inputs gives deeply equal results', () => {
    expect(callAll(sample())).toEqual(callAll(sample()));
    const shared = sample();
    expect(callAll(shared)).toEqual(callAll(shared));
  });

  // Feature: itinerary-rules, Property 16: Inputs are never mutated
  test('Property 16: no input is modified, even when every input is frozen', () => {
    const times = fc.integer({ min: 0, max: 1300 });
    fc.assert(
      fc.property(
        times,
        fc.integer({ min: 1, max: 200 }),
        fc.boolean(),
        fc.boolean(),
        (start, length, hasVenue, zoneMissing) => {
          const s = sample();
          s.candidate = {
            ...slot('NEW1', start, start + length),
            venue: hasVenue ? 'Beta Tower' : undefined,
          };
          s.original = reserved(s.candidate);
          s.candidates = [s.repeat, s.candidate];
          if (zoneMissing) s.context = testContext({ eventTimezone: undefined });
          const before = structuredClone(s);
          deepFreeze(s);
          // A frozen input would throw on any write, and the snapshot would differ on any change.
          callAll(s);
          expect(s).toEqual(before);
        },
      ),
      { numRuns: 100 },
    );
  });
});
