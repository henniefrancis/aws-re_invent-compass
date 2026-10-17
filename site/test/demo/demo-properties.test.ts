import fc from 'fast-check';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Verdict } from '@compass/contracts';
import { DEMO_SESSIONS, DEMO_SOURCE_IDS, GUIDED_CLASH } from '../../src/lib/demo/demo-catalog';
import { createDemoRuntime } from '../../src/lib/demo/demo-deps';
import {
  EMPTY_DEMO,
  reduceDemo,
  type DemoAction,
  type DemoState,
} from '../../src/lib/demo/demo-state';
import type { SwapPlan } from '../../src/lib/demo/rules-port';
import { sortCommitments } from '../../src/lib/demo/schedule';
import { createFakeEngine, createRecordingEngine } from '../doubles/rules-double';
import { VENUE_DATA, heldIds, makeDeps, run, runStates } from '../support/demo-harness';

const POPULAR = [
  'syn-003',
  'syn-002',
  'syn-047',
  'syn-026',
  'syn-118',
  'syn-009',
  'syn-009',
  'syn-088',
];
const sessionIdArb = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom(...POPULAR) },
  { weight: 1, arbitrary: fc.constantFrom(...DEMO_SOURCE_IDS) },
);
const layoverArb = fc.constantFrom(
  { start: '2026-12-04T14:00:00-08:00', end: '2026-12-04T14:30:00-08:00' },
  { start: '2026-12-01T13:00:00-08:00', end: '2026-12-01T13:30:00-08:00' },
);

const actionArb: fc.Arbitrary<DemoAction> = fc.oneof(
  { weight: 1, arbitrary: fc.constant<DemoAction>({ type: 'loadStarter' }) },
  {
    weight: 5,
    arbitrary: sessionIdArb.map((sessionId): DemoAction => ({ type: 'add', sessionId })),
  },
  { weight: 2, arbitrary: fc.constant<DemoAction>({ type: 'confirmWarn' }) },
  { weight: 1, arbitrary: fc.constant<DemoAction>({ type: 'dismiss' }) },
  { weight: 1, arbitrary: sessionIdArb.map((ref): DemoAction => ({ type: 'remove', ref })) },
  {
    weight: 1,
    arbitrary: sessionIdArb.map((sessionId): DemoAction => ({ type: 'bookRepeat', sessionId })),
  },
  { weight: 2, arbitrary: fc.constant<DemoAction>({ type: 'startSwap' }) },
  { weight: 3, arbitrary: fc.constant<DemoAction>({ type: 'advanceSwap' }) },
  { weight: 1, arbitrary: layoverArb.map((l): DemoAction => ({ type: 'addLayover', ...l })) },
  {
    weight: 1,
    arbitrary: sessionIdArb.map((sessionId): DemoAction => ({ type: 'selectPass', sessionId })),
  },
  { weight: 1, arbitrary: fc.constant<DemoAction>({ type: 'reset' }) },
);
const actionsArb = fc.array(actionArb, { maxLength: 25 });

const reasonArb = fc.array(fc.stringMatching(/^[A-Za-z0-9 .]{3,30}$/), {
  minLength: 1,
  maxLength: 3,
});
const verdictArb: fc.Arbitrary<Verdict> = fc.oneof(
  fc.constantFrom<Verdict>(
    { decision: 'allow', reasons: [] },
    { decision: 'allow', reasons: ['Context.'] },
  ),
  reasonArb.map((reasons): Verdict => ({ decision: 'warn', reasons })),
  reasonArb.map((reasons): Verdict => ({ decision: 'block', reasons })),
);
const outcomeArb = fc.constantFrom<SwapPlan['outcome']>('safe', 'unsafe', 'failed');

const interval = (id: string): [number, number] => {
  const s = DEMO_SESSIONS.find((x) => x.sessionId === id);
  return [Date.parse(s?.startsAt ?? ''), Date.parse(s?.endsAt ?? '')];
};
const overlaps = (a: string, b: string): boolean => {
  const [a0, a1] = interval(a);
  const [b0, b1] = interval(b);
  return a0 < b1 && b0 < a1;
};

afterEach(() => {
  vi.useRealTimers();
});

describe('Property 10: The demo week follows the guardrail exactly', () => {
  // Feature: showcase-site, Property 10: The demo week follows the guardrail exactly
  test('a session enters the week only through allow, a confirmed warn or a swap step, and reasons are copied', () => {
    fc.assert(
      fc.property(
        fc.array(verdictArb, {
          minLength: DEMO_SOURCE_IDS.length,
          maxLength: DEMO_SOURCE_IDS.length,
        }),
        outcomeArb,
        actionsArb,
        (verdictList, outcome, actions) => {
          const verdicts = new Map(DEMO_SOURCE_IDS.map((id, i) => [id, verdictList[i] as Verdict]));
          const engine = createFakeEngine({
            checkReservation: (candidate) => verdicts.get(candidate.sessionId) as Verdict,
            planSafeSwap: () => ({
              outcome,
              steps: [],
              clashesWith: [],
              reason: `plan ${outcome}`,
            }),
          });
          const deps = createDemoRuntime(engine, VENUE_DATA);
          expect(deps).not.toBeNull();
          let prev: DemoState = EMPTY_DEMO;
          for (const action of actions) {
            const next = reduceDemo(prev, action, deps as NonNullable<typeof deps>);
            const before = new Set(heldIds(prev));
            const added = heldIds(next).filter((id) => !before.has(id));
            const inSwap =
              prev.swap !== null &&
              ['offered', 'repeatReserved', 'confirmed'].includes(prev.swap.step);
            if (action.type === 'loadStarter') {
              // The sample week is the one place a session is held without a verdict.
            } else if (action.type === 'add' || action.type === 'bookRepeat') {
              const verdict = verdicts.get(action.sessionId) as Verdict;
              if (inSwap || before.has(action.sessionId)) {
                expect(added).toEqual([]);
              } else if (verdict.decision === 'allow') {
                expect(added).toEqual([action.sessionId]);
              } else {
                expect(added).toEqual([]);
                expect(next.pending).toMatchObject({
                  kind: verdict.decision,
                  sessionId: action.sessionId,
                  reasons: verdict.reasons,
                });
              }
            } else if (action.type === 'confirmWarn') {
              const expected =
                !inSwap && prev.pending?.kind === 'warn' ? [prev.pending.sessionId] : [];
              expect(added).toEqual(expected);
            } else if (action.type === 'advanceSwap') {
              const expected = prev.swap?.step === 'offered' ? [prev.swap.repeatSessionId] : [];
              expect(added).toEqual(expected);
            } else {
              expect(added).toEqual([]);
            }
            if (
              action.type === 'startSwap' &&
              prev.pending?.kind === 'block' &&
              prev.pending.swapOffer !== null &&
              next.swap !== null
            ) {
              const verdict = verdicts.get(prev.pending.swapOffer.repeatSessionId) as Verdict;
              expect(next.swap.reasons).toEqual(verdict.reasons);
              expect(next.swap.step).toBe(verdict.decision === 'block' ? 'stopped' : 'offered');
              expect(next.commitments).toEqual(prev.commitments);
            }
            prev = next;
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  test('every reason shown is the reasons list the port returned for that call, in order', () => {
    fc.assert(
      fc.property(actionsArb, (actions) => {
        const { engine, calls } = createRecordingEngine(createFakeEngine());
        const deps = createDemoRuntime(engine, VENUE_DATA);
        let state: DemoState = EMPTY_DEMO;
        for (const action of actions) {
          const before = calls.length;
          state = reduceDemo(state, action, deps as NonNullable<typeof deps>);
          const verdicts = calls
            .slice(before)
            .filter(([name]) => name === 'checkReservation')
            .map(([, , result]) => result as Verdict);
          if (
            (action.type === 'add' || action.type === 'bookRepeat') &&
            state.pending !== null &&
            verdicts[0] !== undefined
          ) {
            expect(state.pending.reasons).toEqual(verdicts[0].reasons);
            expect(state.announcement).toContain(verdicts[0].reasons.join(' '));
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe('Property 11: The demo week stays consistent', () => {
  // Feature: showcase-site, Property 11: The demo week stays consistent
  const deps = makeDeps();

  test('commitments stay ordered by start and reserved sessions never overlap', () => {
    fc.assert(
      fc.property(actionsArb, (actions) => {
        for (const state of runStates(actions, deps)) {
          expect(state.commitments).toEqual(sortCommitments(state.commitments));
          const ids = heldIds(state);
          expect(new Set(ids).size).toBe(ids.length);
          for (const a of ids) {
            for (const b of ids) {
              if (a !== b) {
                expect(overlaps(a, b), `${a} ${b}`).toBe(false);
              }
            }
          }
          if (state.selectedPassSessionId !== null) {
            expect(ids).toContain(state.selectedPassSessionId);
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  test('findClashes over the week reports no clash between reserved sessions', () => {
    fc.assert(
      fc.property(actionsArb, (actions) => {
        const state = run(actions, deps);
        const report = deps.rules.findClashes(
          {
            commitments: state.commitments.filter((c) => c.kind === 'reservedSession'),
            sessions: Object.fromEntries(deps.catalog),
          },
          deps.context,
        );
        expect(report.status === 'ok' && report.clashes).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  test('removing a just-added commitment returns the previous week', () => {
    fc.assert(
      fc.property(actionsArb, sessionIdArb, (actions, id) => {
        const before = run(actions, deps);
        const after = reduceDemo(before, { type: 'add', sessionId: id }, deps);
        fc.pre(heldIds(after).includes(id) && !heldIds(before).includes(id));
        expect(reduceDemo(after, { type: 'remove', ref: id }, deps).commitments).toEqual(
          before.commitments,
        );
      }),
      { numRuns: 300 },
    );
  });

  test('reset returns the empty state after any sequence', () => {
    fc.assert(
      fc.property(actionsArb, (actions) => {
        expect(reduceDemo(run(actions, deps), { type: 'reset' }, deps)).toEqual(EMPTY_DEMO);
      }),
      { numRuns: 100 },
    );
  });

  test('the guided path reaches a block in at most three actions', () => {
    const blocked = run(
      [{ type: 'loadStarter' }, { type: 'add', sessionId: GUIDED_CLASH.tryAdd }],
      deps,
    );
    expect(blocked.pending?.kind).toBe('block');
  });
});

describe('Property 12: The safe swap runs in order and cancels only after a safe confirmation', () => {
  // Feature: showcase-site, Property 12: The safe swap runs in order and cancels only after a safe confirmation
  const swapActionArb = fc.constantFrom<DemoAction>(
    { type: 'advanceSwap' },
    { type: 'advanceSwap' },
    { type: 'advanceSwap' },
    { type: 'dismiss' },
    { type: 'selectPass', sessionId: 'syn-003' },
  );

  test('steps follow the order, the original goes only after safe, and a stop restores the week', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Verdict['decision']>('allow', 'warn', 'block'),
        outcomeArb,
        fc.array(swapActionArb, { maxLength: 7 }),
        (repeatDecision, outcome, actions) => {
          const base = createFakeEngine();
          const { engine, calls } = createRecordingEngine(
            createFakeEngine({
              checkReservation: (candidate, schedule, context) =>
                candidate.sessionId === GUIDED_CLASH.heldRepeat
                  ? {
                      decision: repeatDecision,
                      reasons: repeatDecision === 'allow' ? [] : ['Scripted reason.'],
                    }
                  : base.checkReservation(candidate, schedule, context),
              planSafeSwap: () => ({
                outcome,
                steps: [],
                clashesWith: [],
                reason: `plan ${outcome}`,
              }),
            }),
          );
          const deps = createDemoRuntime(engine, VENUE_DATA) as NonNullable<
            ReturnType<typeof createDemoRuntime>
          >;
          const offered = run(
            [{ type: 'loadStarter' }, { type: 'add', sessionId: GUIDED_CLASH.tryAdd }],
            deps,
          );
          const preSwap = offered.commitments;
          const states = runStates([{ type: 'startSwap' }, ...actions], deps, offered);
          const order = ['offered', 'repeatReserved', 'confirmed', 'done'];
          const seen = states
            .flatMap((s) => (s.swap === null ? [] : [s.swap.step]))
            .filter((step, i, all) => step !== all[i - 1]);
          const path = seen.filter((step) => step !== 'stopped');
          expect(path).toEqual(order.slice(0, path.length));
          const final = states.at(-1) as DemoState;
          const planCalls = calls.filter(([name]) => name === 'planSafeSwap');
          const originalHeld = heldIds(final).includes(GUIDED_CLASH.clashesWith);
          if (!originalHeld) {
            // The original left the week only after a safe plan for a schedule that held the repeat.
            expect(outcome).toBe('safe');
            expect(planCalls.length).toBeGreaterThan(0);
            const schedule = planCalls[0]?.[1][2] as {
              commitments: { kind: string; sessionId?: string }[];
            };
            expect(schedule.commitments.some((c) => c.sessionId === GUIDED_CLASH.heldRepeat)).toBe(
              true,
            );
            expect(seen).toContain('done');
          } else if (final.swap === null || final.swap.step === 'stopped') {
            // The swap was stopped or cancelled, so the repeat is not left behind.
            expect(final.commitments).toEqual(preSwap);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('Property 13: The demo is deterministic and clock free', () => {
  // Feature: showcase-site, Property 13: The demo is deterministic and clock free
  test('the same actions from the empty state give deeply equal states, whatever the clock says', () => {
    fc.assert(
      fc.property(actionsArb, fc.integer({ min: 0, max: 4_000_000_000_000 }), (actions, clock) => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(0));
        const first = runStates(actions, makeDeps());
        vi.setSystemTime(new Date(clock));
        const second = runStates(actions, makeDeps());
        expect(second).toEqual(first);
        vi.useRealTimers();
      }),
      { numRuns: 100 },
    );
  });
});
