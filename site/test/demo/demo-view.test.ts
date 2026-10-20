import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { GUIDED_CLASH } from '../../src/lib/demo/demo-catalog';
import { EMPTY_DEMO, type DemoState } from '../../src/lib/demo/demo-state';
import {
  DEMO_TEXT,
  buildSwapView,
  buildVerdictView,
  guidedHint,
} from '../../src/lib/demo/demo-view';
import { PASS_WIDTH, fitValue, layoutPass, wrapText } from '../../src/lib/demo/pass-layout';
import { buildSamplePass } from '../../src/lib/demo/sample-pass';
import { makeDeps, run, richWeek } from '../support/demo-harness';

const deps = makeDeps();
const starter = richWeek();
const blocked = run(
  [{ type: 'loadStarter' }, { type: 'add', sessionId: GUIDED_CLASH.tryAdd }],
  deps,
);
const swapStates = run(
  [{ type: 'loadStarter' }, { type: 'add', sessionId: GUIDED_CLASH.tryAdd }, { type: 'startSwap' }],
  deps,
);

describe('verdict view', () => {
  test('is null with nothing pending', () => {
    expect(buildVerdictView(starter, deps)).toBeNull();
  });

  test('a block lists every reason, the rebooking message and the safe swap offer', () => {
    const view = buildVerdictView(blocked, deps);
    expect(view).toMatchObject({
      kind: 'block',
      title: 'ARC228 was blocked',
      reasons: ['ARC228 overlaps BWP213.'],
      rebook: { message: 'No alternative found for ARC228.', options: [] },
    });
    expect(view?.swapOffer?.text).toBe(
      'Safe swap: move BWP213 to its repeat BWP213-R. Reserve the repeat first, confirm, then cancel the original.',
    );
  });

  test('rebooking options name the code and the reason, and only repeats can be booked', () => {
    const state: DemoState = {
      ...starter,
      pending: {
        kind: 'block',
        sessionId: 'syn-076',
        reasons: ['No.'],
        rebook: {
          status: 'ok',
          message: 'Found two.',
          options: [
            { kind: 'repeat', sessionId: 'syn-025', startsAt: 'a', reason: 'It repeats.' },
            { kind: 'standby', sessionId: 'other', startsAt: 'b', reason: 'A backup.' },
          ],
        },
        swapOffer: null,
      },
    };
    const view = buildVerdictView(state, deps);
    expect(view?.rebook?.options).toEqual([
      { sessionId: 'syn-025', text: 'BWP213-R: It repeats.', canBook: true },
      { sessionId: 'other', text: 'other: A backup.', canBook: false },
    ]);
    expect(view?.swapOffer).toBeNull();
  });

  test('a warning lists its reasons and offers no rebooking', () => {
    const warn = makeDeps({
      checkReservation: () => ({ decision: 'warn', reasons: ['Careful.'] }),
    });
    const state = run([{ type: 'add', sessionId: 'syn-002' }], warn);
    expect(buildVerdictView(state, warn)).toEqual({
      kind: 'warn',
      title: 'Warning for DAT204',
      reasons: ['Careful.'],
      rebook: null,
      swapOffer: null,
    });
  });
});

describe('swap view', () => {
  test('is null without a swap', () => {
    expect(buildSwapView(starter, deps)).toBeNull();
  });

  test('shows three steps with the next one marked, one button per step', () => {
    const view = buildSwapView(swapStates, deps);
    expect(view?.state).toBe('inProgress');
    expect(view?.steps.map((s) => [s.number, s.status, s.buttonLabel])).toEqual([
      [1, 'next', 'Reserve the repeat'],
      [2, 'waiting', 'Confirm the schedule'],
      [3, 'waiting', 'Cancel the original'],
    ]);
    expect(view?.steps[0]?.label).toBe('Reserve BWP213-R, the repeat (simulated)');
    expect(view?.message).toBe(DEMO_TEXT.swapIntro);
  });

  test('marks finished steps and invites the blocked session at the end', () => {
    const second = run([{ type: 'advanceSwap' }], deps, swapStates);
    expect(buildSwapView(second, deps)?.steps.map((s) => s.status)).toEqual([
      'done',
      'next',
      'waiting',
    ]);
    const done = run(
      [{ type: 'advanceSwap' }, { type: 'advanceSwap' }, { type: 'advanceSwap' }],
      deps,
      swapStates,
    );
    const view = buildSwapView(done, deps);
    expect(view?.state).toBe('done');
    expect(view?.steps.map((s) => s.status)).toEqual(['done', 'done', 'done']);
    expect(view?.invite).toEqual({ sessionId: 'syn-076', text: 'Add ARC228' });
    expect(view?.message).toBe('The swap is done. You can now add ARC228.');
  });

  test('a stopped swap says so and shows the reasons', () => {
    const strict = makeDeps({
      checkReservation: (candidate, schedule, context) =>
        candidate.sessionId === GUIDED_CLASH.heldRepeat
          ? { decision: 'block', reasons: ['The repeat does not fit.'] }
          : makeDeps().rules.checkReservation(candidate, schedule, context),
    });
    const stopped = run(
      [
        { type: 'loadStarter' },
        { type: 'add', sessionId: GUIDED_CLASH.tryAdd },
        { type: 'startSwap' },
      ],
      strict,
    );
    const view = buildSwapView(stopped, strict);
    expect(view).toMatchObject({
      state: 'stopped',
      message: 'This swap cannot be made safely.',
      reasons: ['The repeat does not fit.'],
      invite: null,
    });
    expect(view?.steps.map((s) => s.status)).toEqual(['waiting', 'waiting', 'waiting']);
  });
});

describe('page text', () => {
  test('the guided hint names the session to try', () => {
    expect(guidedHint(deps)).toContain('ARC228');
    const without = { ...deps, catalog: new Map() };
    expect(guidedHint(without)).toBe(DEMO_TEXT.startSample);
  });

  test('the notes say the sessions are made up and what the walk minutes mean', () => {
    expect(DEMO_TEXT.madeUp).toContain('made up');
    expect(DEMO_TEXT.madeUp).toContain('real schedule');
    expect(DEMO_TEXT.walkNote).toContain('walk plus a buffer');
    expect(DEMO_TEXT.emptyWeek).toBe('Add a session first.');
    expect(EMPTY_DEMO.commitments).toEqual([]);
  });
});

describe('pass layout', () => {
  test('wraps at spaces and breaks a word that is too long', () => {
    expect(wrapText('one two three', 7)).toEqual(['one two', 'three']);
    expect(wrapText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
    expect(wrapText('', 5)).toEqual(['']);
  });

  test('every wrapped line fits, and joining the lines gives back the words', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z]{1,12}( [A-Za-z]{1,12}){0,14}$/),
        fc.integer({ min: 12, max: 40 }),
        (text, width) => {
          const lines = wrapText(text, width);
          for (const line of lines) {
            expect(line.length).toBeLessThanOrEqual(width);
          }
          expect(lines.join(' ')).toBe(text);
        },
      ),
      { numRuns: 200 },
    );
  });

  test('shows the engine reason as a small line when there is no boarding time', () => {
    const base = buildSamplePass('syn-002', starter, deps) as NonNullable<
      ReturnType<typeof buildSamplePass>
    >;
    const layout = layoutPass({
      ...base,
      boardingCloses: 'Not needed',
      boardingNote: 'X needs no reservation.',
    });
    const note = layout.lines.find((l) => l.text === 'X needs no reservation.');
    expect(note).toMatchObject({ kind: 'small', onCard: false });
  });

  test('fitValue keeps two lines of 13 characters and shortens the rest with dots', () => {
    expect(fitValue('MGM Grand')).toEqual(['MGM Grand']);
    expect(fitValue('Room not published')).toEqual(['Room not', 'published']);
    const long = fitValue('Mandalay Bay Convention Center Hall');
    expect(long).toHaveLength(2);
    expect(long[1]?.endsWith('...')).toBe(true);
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Za-z]{1,40}( [A-Za-z]{1,40}){0,8}$/), (text) => {
        const lines = fitValue(text);
        expect(lines.length).toBeLessThanOrEqual(2);
        for (const line of lines) {
          expect(line.length).toBeLessThanOrEqual(13);
        }
      }),
      { numRuns: 200 },
    );
  });

  test('lays out every field of the pass with growing y positions on the card', () => {
    const pass = buildSamplePass('syn-002', starter, deps);
    const layout = layoutPass(pass as NonNullable<typeof pass>);
    expect(layout.width).toBe(PASS_WIDTH);
    const texts = layout.lines.map((l) => l.text);
    for (const label of ['SESSION', 'TERMINAL', 'GATE', 'FLIGHT NAME', 'DATE', 'BOARDING CLOSES']) {
      expect(texts).toContain(label);
    }
    expect(texts).toContain('DAT204');
    expect(texts).toContain(pass?.boardingCloses as string);
    expect(texts).toContain(pass?.date as string);
    expect(texts).toContain('Sample pass. Made-up session.');
    expect(texts).toContain('Unofficial. Your badge is your ticket.');
    expect(texts.some((t) => t.startsWith('40 min walk from'))).toBe(true);
    expect(texts).toContain('Next connection: not known');
    expect(texts.join(' ')).not.toContain('Seat released');
    const ys = layout.lines.map((l) => l.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    const onCard = layout.lines.filter((l) => l.onCard);
    expect(onCard.every((l) => l.y < layout.cardHeight)).toBe(true);
    expect(layout.lines.filter((l) => !l.onCard).every((l) => l.y > layout.cardHeight)).toBe(true);
    expect(layout.height).toBeGreaterThan(ys.at(-1) ?? 0);
    const first = buildSamplePass('syn-003', starter, deps);
    const firstTexts = layoutPass(first as NonNullable<typeof first>).lines.map((l) => l.text);
    expect(firstTexts).toContain('Walk from the previous session: not known');
    expect(firstTexts.some((t) => t.startsWith('Next: BWP213 at'))).toBe(true);
  });
});
