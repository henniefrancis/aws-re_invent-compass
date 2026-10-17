import { describe, expect, test } from 'vitest';
import { GUIDED_CLASH } from '../../src/lib/demo/demo-catalog';
import { focusTargetAfter } from '../../src/lib/demo/demo-focus';
import { reduceDemo, type DemoAction, type DemoState } from '../../src/lib/demo/demo-state';
import { makeDeps, run } from '../support/demo-harness';

const deps = makeDeps();
const apply = (state: DemoState, action: DemoAction) => reduceDemo(state, action, deps);
const target = (state: DemoState, action: DemoAction) =>
  focusTargetAfter(action, state, apply(state, action));

const starter = run([{ type: 'loadStarter' }], deps);
const blocked = apply(starter, { type: 'add', sessionId: GUIDED_CLASH.tryAdd });
const swapOffered = apply(blocked, { type: 'startSwap' });
const reserved = apply(swapOffered, { type: 'advanceSwap' });
const confirmed = apply(reserved, { type: 'advanceSwap' });
const done = apply(confirmed, { type: 'advanceSwap' });

describe('where focus goes when the focused control is removed (QA M1)', () => {
  test('removing an item focuses the Remove button of the item that follows it, else the one before, else the week heading', () => {
    const ids = starter.commitments.map((c) => (c.kind === 'reservedSession' ? c.sessionId : ''));
    expect(target(starter, { type: 'remove', ref: ids[0] as string })).toBe(
      `remove-${ids[1] as string}`,
    );
    expect(target(starter, { type: 'remove', ref: ids.at(-1) as string })).toBe(
      `remove-${ids.at(-2) as string}`,
    );
    const single = run([{ type: 'add', sessionId: 'syn-002' }], deps);
    expect(target(single, { type: 'remove', ref: 'syn-002' })).toBe('demo-week');
    expect(target(starter, { type: 'remove', ref: 'nope' })).toBeNull();
  });

  test('Start the safe swap focuses the swap heading, and each step focuses the next control', () => {
    expect(target(blocked, { type: 'startSwap' })).toBe('swap-title');
    expect(target(swapOffered, { type: 'advanceSwap' })).toBe('swap-next');
    expect(target(reserved, { type: 'advanceSwap' })).toBe('swap-next');
    expect(target(confirmed, { type: 'advanceSwap' })).toBe('swap-add');
    expect(target(starter, { type: 'advanceSwap' })).toBeNull();
    expect(target(starter, { type: 'startSwap' })).toBeNull();
    // A finished swap is cleared by the next action, so focus goes to the week.
    expect(target(done, { type: 'advanceSwap' })).toBe('demo-week');
  });

  test('a stopped swap focuses the swap heading', () => {
    const strict = makeDeps({
      planSafeSwap: () => ({ outcome: 'unsafe', steps: [], clashesWith: [], reason: 'No.' }),
    });
    const s0 = run(
      [
        { type: 'loadStarter' },
        { type: 'add', sessionId: GUIDED_CLASH.tryAdd },
        { type: 'startSwap' },
        { type: 'advanceSwap' },
      ],
      strict,
    );
    const next = reduceDemo(s0, { type: 'advanceSwap' }, strict);
    expect(next.swap?.step).toBe('stopped');
    expect(focusTargetAfter({ type: 'advanceSwap' }, s0, next)).toBe('swap-title');
  });

  test('Keep my week and Close focus the week heading, or the swap heading while a swap goes on', () => {
    expect(target(blocked, { type: 'dismiss' })).toBe('demo-week');
    expect(target(done, { type: 'dismiss' })).toBe('demo-week');
    expect(target(reserved, { type: 'dismiss' })).toBe('demo-week');
    expect(target(starter, { type: 'dismiss' })).toBeNull();
    expect(focusTargetAfter({ type: 'dismiss' }, blocked, { ...reserved, pending: null })).toBe(
      'swap-title',
    );
  });

  test('Add anyway focuses the week heading, and Try this repeat the new verdict or the week', () => {
    const warn = makeDeps({
      checkReservation: () => ({ decision: 'warn', reasons: ['Careful.'] }),
    });
    const asked = run([{ type: 'add', sessionId: 'syn-002' }], warn);
    expect(
      focusTargetAfter(
        { type: 'confirmWarn' },
        asked,
        reduceDemo(asked, { type: 'confirmWarn' }, warn),
      ),
    ).toBe('demo-week');
    expect(target(starter, { type: 'confirmWarn' })).toBeNull();
    const book = { type: 'bookRepeat', sessionId: 'syn-002' } as const;
    expect(focusTargetAfter(book, asked, reduceDemo(asked, book, warn))).toBe('verdict-title');
    const repeat = { type: 'bookRepeat', sessionId: 'syn-009' } as const;
    expect(focusTargetAfter(repeat, blocked, apply(blocked, repeat))).toBe('demo-week');
    expect(target(starter, repeat)).toBeNull();
  });

  test('the Add button of a finished swap focuses the verdict or the week; an Add in the list moves nothing', () => {
    const add = { type: 'add', sessionId: GUIDED_CLASH.tryAdd } as const;
    expect(['verdict-title', 'demo-week']).toContain(focusTargetAfter(add, done, apply(done, add)));
    expect(target(starter, { type: 'add', sessionId: 'syn-088' })).toBeNull();
  });

  test('Add this layover focuses the week heading, and a layover that changes nothing moves nothing', () => {
    const layover = {
      type: 'addLayover',
      start: '2026-12-04T14:00:00-08:00',
      end: '2026-12-04T14:30:00-08:00',
    } as const;
    expect(target(starter, layover)).toBe('demo-week');
    const added = apply(starter, layover);
    expect(focusTargetAfter(layover, added, apply(added, layover))).toBeNull();
  });

  test('the buttons that stay in place never move focus', () => {
    for (const action of [
      { type: 'loadStarter' },
      { type: 'reset' },
      { type: 'selectPass', sessionId: 'syn-003' },
    ] as const) {
      expect(target(starter, action)).toBeNull();
    }
  });
});
