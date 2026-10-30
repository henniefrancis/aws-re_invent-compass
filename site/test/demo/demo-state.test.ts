import { describe, expect, test } from 'vitest';
import { GUIDED_CLASH, STARTER_WEEK } from '../../src/lib/demo/demo-catalog';
import {
  DEMO_MESSAGES,
  EMPTY_DEMO,
  reduceDemo,
  type DemoState,
  type SwapProgress,
} from '../../src/lib/demo/demo-state';
import type { Commitment } from '@compass/contracts';
import { commitmentOfSession } from '../../src/lib/demo/schedule';
import { DEMO_SESSIONS } from '../../src/lib/demo/demo-catalog';
import { createFakeEngine } from '../doubles/rules-double';
import { heldIds, makeDeps, run, runStates } from '../support/demo-harness';

const deps = makeDeps();
const sessionById = (id: string) =>
  DEMO_SESSIONS.find((s) => s.sessionId === id) as (typeof DEMO_SESSIONS)[number];
const starter = run([{ type: 'loadStarter' }], deps);

describe('loading and the guided clash', () => {
  test('the sample week holds the starter sessions in start order and names the session to try', () => {
    expect(heldIds(starter)).toEqual(['TNC334-R', 'SEC411']);
    expect(STARTER_WEEK.every((id) => heldIds(starter).includes(id))).toBe(true);
    expect(starter.announcement).toContain('CMP340');
    expect(starter.pending).toBeNull();
  });

  test('a blocked clash is reached in two actions and changes nothing', () => {
    const states = runStates(
      [{ type: 'loadStarter' }, { type: 'add', sessionId: GUIDED_CLASH.tryAdd }],
      deps,
    );
    const blocked = states[1] as DemoState;
    expect(blocked.pending?.kind).toBe('block');
    expect(blocked.commitments).toEqual(starter.commitments);
    if (blocked.pending?.kind === 'block') {
      expect(blocked.pending.reasons).toEqual(['CMP340 overlaps TNC334-R.']);
      expect(blocked.pending.rebook.message).toBe('No alternative found for CMP340.');
      expect(blocked.pending.swapOffer).toEqual({
        originalSessionId: GUIDED_CLASH.clashesWith,
        repeatSessionId: GUIDED_CLASH.heldRepeat,
      });
    }
    expect(blocked.announcement).toContain('Blocked: CMP340 was not added.');
    expect(blocked.announcement).toContain('CMP340 overlaps TNC334-R.');
  });

  test('sessions missing from the catalog are skipped and the hint names the id', () => {
    const smaller = {
      ...deps,
      catalog: new Map([...deps.catalog].filter(([id]) => id !== 'CMP340' && id !== 'SEC411')),
    };
    const state = reduceDemo(EMPTY_DEMO, { type: 'loadStarter' }, smaller);
    expect(heldIds(state)).toEqual(['TNC334-R']);
    expect(state.announcement).toContain('Sample week loaded: 1 sessions. Try adding CMP340');
  });

  test('the sample week is not asked to pass the guardrail', () => {
    expect(starter.commitments).toHaveLength(2);
  });
});

describe('safe swap', () => {
  const offered = run(
    [
      { type: 'loadStarter' },
      { type: 'add', sessionId: GUIDED_CLASH.tryAdd },
      { type: 'startSwap' },
    ],
    deps,
  );

  test('starting the swap checks the repeat first and offers three steps', () => {
    expect(offered.swap?.step).toBe('offered');
    expect(offered.pending).toBeNull();
    expect(offered.commitments).toEqual(starter.commitments);
    expect(offered.announcement).toContain('Step 1 of 3');
  });

  test('runs reserve, confirm, cancel, one per action, then invites the blocked session', () => {
    const states = runStates(
      [{ type: 'advanceSwap' }, { type: 'advanceSwap' }, { type: 'advanceSwap' }],
      deps,
      offered,
    );
    expect(states.map((s) => s.swap?.step)).toEqual(['repeatReserved', 'confirmed', 'done']);
    expect(heldIds(states[0] as DemoState)).toContain('TNC334-R1');
    expect(heldIds(states[0] as DemoState)).toContain('TNC334-R');
    expect(states[1]?.swap?.plan?.outcome).toBe('safe');
    expect(heldIds(states[1] as DemoState)).toContain('TNC334-R');
    expect(heldIds(states[2] as DemoState)).not.toContain('TNC334-R');
    expect(heldIds(states[2] as DemoState)).toContain('TNC334-R1');
    expect(states[2]?.announcement).toContain('You can now add CMP340.');
  });

  test('after the swap the blocked session goes through the guardrail again', () => {
    const done = run(
      [{ type: 'advanceSwap' }, { type: 'advanceSwap' }, { type: 'advanceSwap' }],
      deps,
      offered,
    );
    const next = reduceDemo(done, { type: 'add', sessionId: GUIDED_CLASH.tryAdd }, deps);
    expect(next.swap).toBeNull();
    expect(['allow', 'warn', 'block'].length).toBe(3);
    expect(next.pending?.kind === 'warn' || heldIds(next).includes('CMP340')).toBe(true);
  });

  test('a swap whose repeat is blocked is not started and leaves the week unchanged', () => {
    const strict = makeDeps({
      checkReservation: (candidate, schedule, context) =>
        candidate.sessionId === GUIDED_CLASH.heldRepeat
          ? { decision: 'block', reasons: ['The repeat does not fit.'] }
          : createFakeEngine().checkReservation(candidate, schedule, context),
    });
    const after = run(
      [
        { type: 'loadStarter' },
        { type: 'add', sessionId: GUIDED_CLASH.tryAdd },
        { type: 'startSwap' },
      ],
      strict,
    );
    expect(after.swap?.step).toBe('stopped');
    expect(after.swap?.reasons).toEqual(['The repeat does not fit.']);
    expect(after.commitments).toEqual(starter.commitments);
    expect(after.announcement).toContain(DEMO_MESSAGES.swapUnsafe);
    expect(after.announcement).toContain('The repeat does not fit.');
    expect(reduceDemo(after, { type: 'advanceSwap' }, strict).swap).toBeNull();
  });

  test('a warning on the repeat keeps its reasons with the swap offer', () => {
    const warn = makeDeps({
      checkReservation: (candidate, schedule, context) =>
        candidate.sessionId === GUIDED_CLASH.heldRepeat
          ? { decision: 'warn', reasons: ['The repeat is tight.'] }
          : createFakeEngine().checkReservation(candidate, schedule, context),
    });
    const after = run(
      [
        { type: 'loadStarter' },
        { type: 'add', sessionId: GUIDED_CLASH.tryAdd },
        { type: 'startSwap' },
      ],
      warn,
    );
    expect(after.swap?.step).toBe('offered');
    expect(after.swap?.reasons).toEqual(['The repeat is tight.']);
    expect(after.announcement).toContain('The repeat is tight.');
  });

  test('an unsafe or failed plan removes the repeat and keeps the original', () => {
    for (const outcome of ['unsafe', 'failed'] as const) {
      const scripted = makeDeps({
        planSafeSwap: () => ({
          outcome,
          steps: [],
          clashesWith: ['X'],
          reason: `The plan is ${outcome}.`,
        }),
      });
      const states = runStates(
        [
          { type: 'loadStarter' },
          { type: 'add', sessionId: GUIDED_CLASH.tryAdd },
          { type: 'startSwap' },
          { type: 'advanceSwap' },
          { type: 'advanceSwap' },
        ],
        scripted,
      );
      const last = states[4] as DemoState;
      expect(last.swap?.step).toBe('stopped');
      expect(last.swap?.reasons).toEqual([`The plan is ${outcome}.`]);
      expect(heldIds(last)).toContain('TNC334-R');
      expect(heldIds(last)).not.toContain('TNC334-R1');
      expect(last.commitments).toEqual(starter.commitments);
      expect(last.announcement).toContain(`The plan is ${outcome}.`);
    }
  });

  test('other actions wait while a swap is in progress, and cancel rolls back the repeat', () => {
    const reserved = reduceDemo(offered, { type: 'advanceSwap' }, deps);
    for (const action of [
      { type: 'add', sessionId: 'AIM433' },
      { type: 'loadStarter' },
      { type: 'remove', ref: 'INV530-R1' },
      { type: 'confirmWarn' },
      { type: 'startSwap' },
      { type: 'bookRepeat', sessionId: 'TNC334-R1' },
      { type: 'addLayover', start: '2026-12-03T14:30:00-08:00', end: '2026-12-03T15:00:00-08:00' },
    ] as const) {
      const held = reduceDemo(reserved, action, deps);
      expect(held.commitments).toEqual(reserved.commitments);
      expect(held.swap).toEqual(reserved.swap);
      expect(held.announcement).toBe(DEMO_MESSAGES.finishSwap);
    }
    const cancelled = reduceDemo(reserved, { type: 'dismiss' }, deps);
    expect(cancelled.swap).toBeNull();
    expect(cancelled.commitments).toEqual(starter.commitments);
    expect(reduceDemo(offered, { type: 'dismiss' }, deps).commitments).toEqual(starter.commitments);
    expect(
      reduceDemo(reserved, { type: 'selectPass', sessionId: 'SEC411' }, deps).selectedPassSessionId,
    ).toBe('SEC411');
    expect(reduceDemo(reserved, { type: 'reset' }, deps)).toEqual(EMPTY_DEMO);
  });

  test('odd states are left alone', () => {
    const swap = (step: SwapProgress['step']): SwapProgress => ({
      originalSessionId: 'SEC318-R',
      repeatSessionId: 'TNC334-R1',
      blockedSessionId: 'CMP340',
      step,
      plan: null,
      reasons: [],
    });
    expect(reduceDemo(starter, { type: 'advanceSwap' }, deps)).toBe(starter);
    expect(reduceDemo(starter, { type: 'startSwap' }, deps)).toBe(starter);
    const noOriginal = { ...EMPTY_DEMO, swap: swap('repeatReserved') };
    expect(reduceDemo(noOriginal, { type: 'advanceSwap' }, deps)).toBe(noOriginal);
    const unknownRepeat = { ...starter, swap: { ...swap('offered'), repeatSessionId: 'nope' } };
    expect(reduceDemo(unknownRepeat, { type: 'advanceSwap' }, deps)).toBe(unknownRepeat);
    const unknownOffer = {
      ...starter,
      pending: {
        kind: 'block' as const,
        sessionId: 'CMP340',
        reasons: ['x'],
        rebook: { status: 'ok' as const, options: [], message: 'm' },
        swapOffer: { originalSessionId: 'SEC318-R', repeatSessionId: 'nope' },
      },
    };
    expect(reduceDemo(unknownOffer, { type: 'startSwap' }, deps)).toBe(unknownOffer);
    const finished = { ...starter, swap: swap('done') };
    expect(reduceDemo(finished, { type: 'advanceSwap' }, deps).swap).toBeNull();
    expect(reduceDemo(finished, { type: 'selectPass', sessionId: 'INV530-R1' }, deps).swap).toEqual(
      swap('done'),
    );
  });
});

describe('verdicts', () => {
  const only = (decision: 'allow' | 'warn' | 'block', reasons: string[] = []) =>
    makeDeps({ checkReservation: () => ({ decision, reasons }) });

  test('allow adds the session and announces it with the reasons', () => {
    const d = only('allow', ['All clear.']);
    const state = run([{ type: 'add', sessionId: 'AIM433' }], d);
    expect(heldIds(state)).toEqual(['AIM433']);
    expect(state.announcement).toBe('Allowed: AIM433 was added to your week. All clear.');
  });

  test('warn waits for the user, and Add anyway adds without asking again', () => {
    const d = only('warn', ['Careful.', 'Really careful.']);
    const asked = run([{ type: 'add', sessionId: 'AIM433' }], d);
    expect(asked.commitments).toEqual([]);
    expect(asked.pending).toEqual({
      kind: 'warn',
      sessionId: 'AIM433',
      reasons: ['Careful.', 'Really careful.'],
    });
    expect(asked.announcement).toBe(
      'Warning for AIM433. Careful. Really careful. Choose Add anyway or Keep my week.',
    );
    const added = reduceDemo(asked, { type: 'confirmWarn' }, d);
    expect(heldIds(added)).toEqual(['AIM433']);
    expect(added.pending).toBeNull();
    expect(added.announcement).toBe('Added anyway: AIM433 is in your week.');
    const kept = reduceDemo(asked, { type: 'dismiss' }, d);
    expect(kept.commitments).toEqual([]);
    expect(kept.pending).toBeNull();
    expect(kept.announcement).toBe('Your week is unchanged.');
  });

  test('block keeps the week and shows every reason and the rebooking message', () => {
    const d = only('block', ['No.', 'Still no.']);
    const state = run([{ type: 'add', sessionId: 'AIM433' }], d);
    expect(state.commitments).toEqual([]);
    expect(state.pending?.kind === 'block' && state.pending.reasons).toEqual(['No.', 'Still no.']);
    expect(state.pending?.kind === 'block' && state.pending.swapOffer).toBeNull();
  });

  test('a repeat is looked up by its base code', () => {
    const calls: string[] = [];
    const d = makeDeps({
      checkReservation: () => ({ decision: 'block', reasons: ['x'] }),
      findRebookingOptions: (baseCode) => {
        calls.push(baseCode);
        return { status: 'ok', options: [], message: 'none' };
      },
    });
    run(
      [
        { type: 'add', sessionId: 'TNC334-R1' },
        { type: 'add', sessionId: 'CMP340' },
      ],
      d,
    );
    expect(calls).toEqual(['TNC334', 'CMP340']);
  });

  test('a clash report that is unknown gives no swap offer', () => {
    const d = makeDeps({
      findClashes: () => ({ status: 'unknown', reason: 'No timezone.' }),
    });
    const state = run(
      [{ type: 'loadStarter' }, { type: 'add', sessionId: GUIDED_CLASH.tryAdd }],
      d,
    );
    expect(state.pending?.kind === 'block' && state.pending.swapOffer).toBeNull();
  });

  test('a clash with a session that has no repeat, or with personal time, gives no swap offer', () => {
    const noRepeat = run(
      [
        { type: 'add', sessionId: 'ANT414' },
        { type: 'add', sessionId: 'SEC318-R1' },
      ],
      makeDeps(),
    );
    expect(noRepeat.pending?.kind === 'block' && noRepeat.pending.swapOffer).toBeNull();
    const withLayover = run(
      [
        {
          type: 'addLayover',
          start: '2026-12-02T07:00:00-08:00',
          end: '2026-12-02T08:00:00-08:00',
        },
        { type: 'add', sessionId: 'ACT053' },
      ],
      only('block', ['No.']),
    );
    expect(withLayover.pending?.kind === 'block' && withLayover.pending.swapOffer).toBeNull();
  });

  test('a repeat that is already held is not offered again', () => {
    const state = run(
      [
        { type: 'add', sessionId: 'TNC334-R' },
        { type: 'add', sessionId: 'TNC334-R1' },
        { type: 'confirmWarn' },
        { type: 'add', sessionId: 'CMP340' },
      ],
      makeDeps(),
    );
    expect(state.pending?.kind === 'block' && state.pending.swapOffer).toBeNull();
  });

  test('a clash pair that lists the candidate first still finds the held session', () => {
    const flipped = makeDeps({
      findClashes: (schedule) => ({
        status: 'ok',
        clashes: [
          {
            a: 'CMP340',
            b: 'TNC334-R',
            overlap: 'same time',
            reason: 'overlap',
            aIndex: schedule.commitments.length - 1,
            bIndex: schedule.commitments.findIndex(
              (c) => c.kind === 'reservedSession' && c.sessionId === 'TNC334-R',
            ),
          },
        ],
        unknown: [],
      }),
    });
    const state = run(
      [{ type: 'loadStarter' }, { type: 'add', sessionId: GUIDED_CLASH.tryAdd }],
      flipped,
    );
    expect(state.pending?.kind === 'block' && state.pending.swapOffer?.originalSessionId).toBe(
      'TNC334-R',
    );
  });

  test('bookRepeat goes through the same guardrail as add', () => {
    const viaAdd = run([{ type: 'add', sessionId: 'TNC334-R1' }], deps);
    const viaBook = run([{ type: 'bookRepeat', sessionId: 'TNC334-R1' }], deps);
    expect(viaBook).toEqual(viaAdd);
  });

  test('unknown and already held sessions are reported, not added', () => {
    expect(run([{ type: 'add', sessionId: 'nope' }], deps).announcement).toBe(
      DEMO_MESSAGES.unknownSession,
    );
    const twice = run(
      [
        { type: 'add', sessionId: 'AIM433' },
        { type: 'add', sessionId: 'AIM433' },
      ],
      deps,
    );
    expect(heldIds(twice)).toEqual(['AIM433']);
    expect(twice.announcement).toBe('AIM433 is already in your week.');
  });
});

describe('the week', () => {
  const layover = { start: '2026-12-03T14:30:00-08:00', end: '2026-12-03T15:00:00-08:00' };

  test('adding a layover adds personal time once, and it can be removed', () => {
    const once = run([{ type: 'loadStarter' }, { type: 'addLayover', ...layover }], deps);
    const layoverItem = once.commitments.find((c) => c.kind === 'personalTime');
    expect(layoverItem).toMatchObject({
      title: 'Layover',
      startsAt: layover.start,
      endsAt: layover.end,
    });
    expect(once.announcement).toBe('Added a layover from 2:30 PM to 3:00 PM.');
    expect(reduceDemo(once, { type: 'addLayover', ...layover }, deps)).toBe(once);
    const removed = reduceDemo(once, { type: 'remove', ref: `layover-${layover.start}` }, deps);
    expect(removed.commitments).toEqual(starter.commitments);
    expect(removed.announcement).toBe('Removed Layover from your week.');
  });

  test('remove takes out a session by its key and clears its selected pass', () => {
    const selected = reduceDemo(starter, { type: 'selectPass', sessionId: 'TNC334-R' }, deps);
    expect(selected.selectedPassSessionId).toBe('TNC334-R');
    const removed = reduceDemo(selected, { type: 'remove', ref: 'TNC334-R' }, deps);
    expect(heldIds(removed)).not.toContain('TNC334-R');
    expect(removed.selectedPassSessionId).toBeNull();
    expect(removed.announcement).toContain('Streamlining Claims Processing');
    const other = reduceDemo(selected, { type: 'remove', ref: 'SEC411' }, deps);
    expect(other.selectedPassSessionId).toBe('TNC334-R');
    expect(reduceDemo(starter, { type: 'remove', ref: 'nope' }, deps)).toBe(starter);
  });

  test('a session in the week without a title is named by its id', () => {
    const bare: Commitment = {
      kind: 'reservedSession',
      sessionId: 'INV530-R1',
      startsAt: 'a',
      endsAt: 'b',
    };
    const state: DemoState = { ...EMPTY_DEMO, commitments: [bare] };
    expect(reduceDemo(state, { type: 'remove', ref: 'INV530-R1' }, deps).announcement).toBe(
      'Removed INV530-R1 from your week.',
    );
  });

  test('selectPass only selects a reserved session in the week', () => {
    expect(reduceDemo(starter, { type: 'selectPass', sessionId: 'CMP340' }, deps)).toBe(starter);
    expect(
      reduceDemo(starter, { type: 'selectPass', sessionId: 'SEC411' }, deps).selectedPassSessionId,
    ).toBe('SEC411');
  });

  test('reset returns the empty state and confirmWarn without a warning does nothing', () => {
    expect(reduceDemo(starter, { type: 'reset' }, deps)).toEqual(EMPTY_DEMO);
    expect(reduceDemo(starter, { type: 'confirmWarn' }, deps)).toBe(starter);
    const blockedState = run(
      [{ type: 'loadStarter' }, { type: 'add', sessionId: GUIDED_CLASH.tryAdd }],
      deps,
    );
    expect(reduceDemo(blockedState, { type: 'confirmWarn' }, deps)).toBe(blockedState);
  });

  test('commitments are built from the catalog session', () => {
    const session = sessionById('ACT053');
    expect(commitmentOfSession(session)).toEqual({
      kind: 'reservedSession',
      sessionId: 'ACT053',
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      title: session.title,
    });
  });
});
