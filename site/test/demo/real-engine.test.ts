// The demo against the real rules engine (@compass/core/rules, S2) and the real venue file
// (data/venues.json). Nothing here hard codes a walking time: expectations come from the data
// through the engine's own answers.

import { createPassFieldsSchema } from '@compass/contracts';
import { validateVenueData } from '@compass/core/rules';
import ICAL from 'ical.js';
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { DEMO_EVENT, DEMO_SESSIONS, GUIDED_CLASH } from '../../src/lib/demo/demo-catalog';
import { createDemoRuntime, type DemoDeps } from '../../src/lib/demo/demo-deps';
import {
  EMPTY_DEMO,
  reduceDemo,
  type DemoAction,
  type DemoState,
} from '../../src/lib/demo/demo-state';
import { demoCalendarText } from '../../src/lib/demo/ics';
import { neighboursOf } from '../../src/lib/demo/neighbours';
import { REAL_ENGINE, isRulesEngineReady } from '../../src/lib/demo/rules-port';
import { buildSamplePass } from '../../src/lib/demo/sample-pass';
import { commitmentRef, sortCommitments, toScheduleInput } from '../../src/lib/demo/schedule';
import { DEMO_VENUE_DATA } from '../../src/lib/demo/venue-data';
import { buildCatalogView, buildWeekView } from '../../src/lib/demo/week-view';
import { heldIds, run, runStates } from '../support/demo-harness';

const deps = createDemoRuntime(REAL_ENGINE, DEMO_VENUE_DATA) as DemoDeps;
const schema = createPassFieldsSchema({
  start: DEMO_EVENT.windowStart,
  end: DEMO_EVENT.windowEnd,
  timezone: DEMO_EVENT.timezone,
});

describe('the real engine and the real venue data', () => {
  test('the engine is complete, the venue file is valid and the runtime is built', () => {
    expect(isRulesEngineReady(REAL_ENGINE)).toBe(true);
    expect(deps).not.toBeNull();
    const validation = validateVenueData(DEMO_VENUE_DATA);
    expect(validation).toMatchObject({ ok: true });
  });

  test('every demo venue is in the venue file', () => {
    const names = (DEMO_VENUE_DATA as { venues: { venue: { name: string } }[] }).venues.map(
      (v) => v.venue.name,
    );
    for (const session of DEMO_SESSIONS) {
      if (session.venue !== undefined) {
        expect(names).toContain(session.venue);
      }
    }
  });

  test('the catalog view shows a boarding line for every session', () => {
    const sessions = buildCatalogView(EMPTY_DEMO, deps).flatMap((d) => d.sessions);
    expect(sessions).toHaveLength(DEMO_SESSIONS.length);
    const reservable = sessions.find((s) => s.reservable);
    expect(reservable?.boarding).toMatch(/^Seat released at \d{1,2}:\d{2} (AM|PM)$/);
    for (const session of sessions) {
      expect(session.boarding.length).toBeGreaterThan(0);
    }
  });
});

describe('the guided path on the real engine', () => {
  const starter = run([{ type: 'loadStarter' }], deps);
  const blocked = reduceDemo(starter, { type: 'add', sessionId: GUIDED_CLASH.tryAdd }, deps);

  test('a clash is blocked with the engine reasons and the week is unchanged', () => {
    expect(blocked.pending?.kind).toBe('block');
    expect(blocked.commitments).toEqual(starter.commitments);
    const verdict = deps.rules.checkReservation(
      deps.catalog.get(GUIDED_CLASH.tryAdd) as NonNullable<ReturnType<typeof deps.catalog.get>>,
      toScheduleInput(starter.commitments, deps.catalog),
      deps.context,
    );
    expect(verdict.decision).toBe('block');
    expect(blocked.pending?.reasons).toEqual(verdict.reasons);
    for (const reason of verdict.reasons) {
      expect(blocked.announcement).toContain(reason);
    }
  });

  test('the safe swap is offered and runs in order, ending with the repeat held', () => {
    expect(blocked.pending?.kind === 'block' && blocked.pending.swapOffer).toEqual({
      originalSessionId: GUIDED_CLASH.clashesWith,
      repeatSessionId: GUIDED_CLASH.heldRepeat,
    });
    const steps = runStates(
      [
        { type: 'startSwap' },
        { type: 'advanceSwap' },
        { type: 'advanceSwap' },
        { type: 'advanceSwap' },
      ],
      deps,
      blocked,
    );
    const seen = steps.map((s) => s.swap?.step);
    expect(seen).toEqual(['offered', 'repeatReserved', 'confirmed', 'done']);
    const final = steps.at(-1) as DemoState;
    expect(heldIds(final)).toContain(GUIDED_CLASH.heldRepeat);
    expect(heldIds(final)).not.toContain(GUIDED_CLASH.clashesWith);
    expect(final.announcement).toContain('You can now add');
  });

  test('every connection view repeats the engine walk, and the layover lines are the engine reasons', () => {
    const view = buildWeekView(starter, deps);
    for (const day of view) {
      const report = deps.rules.connectionsForDay(
        toScheduleInput(starter.commitments, deps.catalog),
        deps.context,
        day.date,
      );
      expect(report.status).toBe('ok');
      if (report.status === 'ok') {
        expect(day.connections).toHaveLength(report.connections.length);
        report.connections.forEach((connection, index) => {
          const minutes = connection.result.walkingMinutes;
          expect(day.connections[index]?.text).toContain(connection.result.reason);
          expect(day.connections[index]?.walk).toBe(
            minutes === undefined
              ? 'Walk time unknown.'
              : `Walk plus buffer: ${String(minutes)} minutes.`,
          );
        });
      }
    }
  });

  test('every pass of the sample week validates, and the calendar alarms use the engine walk', () => {
    for (const id of heldIds(starter)) {
      const pass = buildSamplePass(id, starter, deps);
      expect(schema.safeParse(pass?.passFields).success, id).toBe(true);
    }
    const events = new ICAL.Component(
      ICAL.parse(demoCalendarText(starter, deps)) as unknown[],
    ).getAllSubcomponents('vevent');
    starter.commitments.forEach((commitment, index) => {
      const previous = neighboursOf(commitmentRef(commitment), starter, deps).previous;
      const walk = previous?.walkClass === 'impossible' ? null : (previous?.walkMinutes ?? null);
      const alarms = events[index]
        ?.getAllSubcomponents('valarm')
        .map((a) => -(a.getFirstPropertyValue('trigger') as ICAL.Duration).toSeconds() / 60);
      expect(alarms).toEqual(walk === null ? [10] : [10, 10 + walk]);
    });
  });
});

describe('properties on the real engine', () => {
  const ids = DEMO_SESSIONS.map((s) => s.sessionId);
  const actionArb: fc.Arbitrary<DemoAction> = fc.oneof(
    { weight: 1, arbitrary: fc.constant<DemoAction>({ type: 'loadStarter' }) },
    {
      weight: 4,
      arbitrary: fc
        .constantFrom(...ids)
        .map((sessionId): DemoAction => ({ type: 'add', sessionId })),
    },
    { weight: 2, arbitrary: fc.constant<DemoAction>({ type: 'confirmWarn' }) },
    { weight: 1, arbitrary: fc.constant<DemoAction>({ type: 'dismiss' }) },
    { weight: 2, arbitrary: fc.constant<DemoAction>({ type: 'startSwap' }) },
    { weight: 3, arbitrary: fc.constant<DemoAction>({ type: 'advanceSwap' }) },
    {
      weight: 1,
      arbitrary: fc.constantFrom(...ids).map((ref): DemoAction => ({ type: 'remove', ref })),
    },
  );

  test('the week stays ordered, no two reserved sessions overlap, and runs are repeatable', () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 18 }), (actions) => {
        const states = runStates(actions, deps);
        expect(runStates(actions, deps)).toEqual(states);
        for (const state of states) {
          expect(state.commitments).toEqual(sortCommitments(state.commitments));
          const report = deps.rules.findClashes(
            {
              commitments: state.commitments.filter((c) => c.kind === 'reservedSession'),
              sessions: Object.fromEntries(deps.catalog),
            },
            deps.context,
          );
          expect(report.status === 'ok' && report.clashes).toEqual([]);
        }
      }),
      { numRuns: 60 },
    );
  });

  test('a block or warning shows exactly the reasons the engine gave', () => {
    fc.assert(
      fc.property(
        fc.array(actionArb, { maxLength: 12 }),
        fc.constantFrom(...ids),
        (actions, id) => {
          const before = run(actions, deps);
          const after = reduceDemo(before, { type: 'add', sessionId: id }, deps);
          fc.pre(after.pending !== null && after.pending !== before.pending);
          const verdict = deps.rules.checkReservation(
            deps.catalog.get(id) as NonNullable<ReturnType<typeof deps.catalog.get>>,
            toScheduleInput(before.commitments, deps.catalog),
            deps.context,
          );
          expect(after.pending?.reasons).toEqual(verdict.reasons);
          expect(after.pending?.kind).toBe(verdict.decision);
        },
      ),
      { numRuns: 100 },
    );
  });
});
