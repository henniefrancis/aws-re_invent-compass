import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import {
  INITIAL_BOARD_STATE,
  MESSAGES,
  bundleLabel,
  canRetry,
  msUntilExpiry,
  reduceBoard,
  toBoardViewModel,
  type BoardEvent,
  type BoardState,
  type BoardViewModel,
} from '../../src/lib/board/board-state';
import type { HandoffOutcome } from '../../src/lib/board/handoff-client';
import { GOOGLE_SAVE_PREFIX, validateHandoffView } from '../../src/lib/board/handoff-view';
import { FIXED_ID, bodyArb, exampleBody, idArb, isoArb, validated } from '../support/handoff-data';

const READY: BoardState = { kind: 'ready', handoff: validated(exampleBody()) };
const LOADING: BoardState = { kind: 'loading' };
const NOW = Date.parse('2026-11-30T10:00:00-08:00');

describe('reduceBoard examples', () => {
  test('starts in the reading state', () => {
    expect(INITIAL_BOARD_STATE).toEqual({ kind: 'reading' });
  });

  test('a refused fragment ends in invalid link, an accepted one changes nothing', () => {
    expect(
      reduceBoard(INITIAL_BOARD_STATE, { type: 'fragmentRead', result: { ok: false } }),
    ).toEqual({
      kind: 'invalidLink',
    });
    expect(
      reduceBoard(INITIAL_BOARD_STATE, {
        type: 'fragmentRead',
        result: { ok: true, id: FIXED_ID },
      }),
    ).toBe(INITIAL_BOARD_STATE);
    expect(reduceBoard(READY, { type: 'fragmentRead', result: { ok: false } })).toBe(READY);
  });

  test('a request starts only from reading, unavailable or rate limited', () => {
    expect(reduceBoard(INITIAL_BOARD_STATE, { type: 'requestStarted' })).toEqual(LOADING);
    expect(reduceBoard({ kind: 'unavailable' }, { type: 'requestStarted' })).toEqual(LOADING);
    expect(reduceBoard({ kind: 'rateLimited' }, { type: 'requestStarted' })).toEqual(LOADING);
    for (const state of [
      READY,
      LOADING,
      { kind: 'expired' },
      { kind: 'invalidLink' },
    ] as BoardState[]) {
      expect(reduceBoard(state, { type: 'requestStarted' })).toBe(state);
    }
  });

  test('an outcome only applies while loading', () => {
    const event: BoardEvent = {
      type: 'outcome',
      outcome: { kind: 'status', status: 404 },
      validated: null,
      nowMs: NOW,
    };
    expect(reduceBoard(LOADING, event)).toEqual({ kind: 'expired' });
    expect(reduceBoard(READY, event)).toBe(READY);
  });

  test('the clock only expires a ready state', () => {
    expect(reduceBoard(LOADING, { type: 'clock', nowMs: Infinity })).toBe(LOADING);
    expect(reduceBoard(READY, { type: 'clock', nowMs: NOW })).toBe(READY);
    expect(
      reduceBoard(READY, { type: 'clock', nowMs: Date.parse('2026-11-30T10:15:00-08:00') }),
    ).toEqual({ kind: 'expired' });
  });

  test('only unavailable and rate limited can retry', () => {
    expect(canRetry({ kind: 'unavailable' })).toBe(true);
    expect(canRetry({ kind: 'rateLimited' })).toBe(true);
    expect(canRetry(READY)).toBe(false);
    expect(canRetry({ kind: 'expired' })).toBe(false);
  });

  test('msUntilExpiry is negative after expiry', () => {
    const handoff = validated(exampleBody());
    expect(msUntilExpiry(handoff, handoff.expiresAtMs - 5000)).toBe(5000);
    expect(msUntilExpiry(handoff, handoff.expiresAtMs + 1)).toBe(-1);
  });
});

describe('expiry when the answer arrives (QA M4)', () => {
  const handoff = validated(exampleBody());
  const ok = { kind: 'ok', body: {} } as const;

  test('an answer that arrives after expiresAt is Expired, never Ready', () => {
    for (const late of [
      handoff.expiresAtMs,
      handoff.expiresAtMs + 1,
      handoff.expiresAtMs + 86_400_000,
    ]) {
      const state = reduceBoard(LOADING, {
        type: 'outcome',
        outcome: ok,
        validated: handoff,
        nowMs: late,
      });
      expect(state).toEqual({ kind: 'expired' });
    }
    const early = reduceBoard(LOADING, {
      type: 'outcome',
      outcome: ok,
      validated: handoff,
      nowMs: handoff.expiresAtMs - 1,
    });
    expect(early.kind).toBe('ready');
  });

  test('the minutes shown never exceed 15, even when expiresAt is far away', () => {
    const far = { ...handoff, expiresAtMs: NOW + 3 * 3_600_000 };
    expect(toBoardViewModel({ kind: 'ready', handoff: far }, NOW).expiresText).toBe(
      'This link works for about 15 more minutes.',
    );
    const fourteen = { ...handoff, expiresAtMs: NOW + 14 * 60_000 };
    expect(toBoardViewModel({ kind: 'ready', handoff: fourteen }, NOW).expiresText).toBe(
      'This link works for about 14 more minutes.',
    );
  });
});

describe('toBoardViewModel examples', () => {
  test('the ready view lists sessions, actions, the hint, the expiry and one timezone note', () => {
    const vm = toBoardViewModel(READY, NOW);
    expect(vm.heading).toBe('Your boarding passes are ready');
    expect(vm.actions.map((a) => [a.kind, a.label])).toEqual([
      ['apple', 'Add to Apple Wallet'],
      ['google', 'Save to Google Wallet'],
      ['calendar', 'Download calendar'],
    ]);
    expect(vm.sessions[0]).toEqual({
      code: 'DAT302',
      title: 'Made-up session about data',
      time: 'Monday 30 November, 10:30 AM',
    });
    expect(vm.timezoneNote).toBe('Times are event local time (UTC-08:00).');
    expect(vm.expiresText).toBe('This link works for about 15 more minutes.');
    expect(vm.deviceHint).toBe(MESSAGES.deviceHint);
    expect(vm.announcement).toBe('Your boarding passes are ready. 2 sessions.');
    expect(vm.busy).toBe(false);
  });

  test('one session reads "1 session" and the last minute reads "1 more minute"', () => {
    const body = { ...exampleBody(), sessions: [exampleBody().sessions[0] as never] };
    const handoff = validated(body);
    const vm = toBoardViewModel({ kind: 'ready', handoff }, handoff.expiresAtMs - 30_000);
    expect(vm.announcement).toBe('Your boarding passes are ready. 1 session.');
    expect(vm.expiresText).toBe('This link works for about 1 more minute.');
    expect(
      toBoardViewModel({ kind: 'ready', handoff }, handoff.expiresAtMs + 5000).expiresText,
    ).toBe('This link works for about 1 more minute.');
  });

  test('different offsets show an offset on each row and no note', () => {
    const base = exampleBody();
    const body = {
      ...base,
      sessions: [
        base.sessions[0] as never,
        { ...(base.sessions[1] as object), startsAt: '2026-12-01T14:00:00-07:00' } as never,
      ],
    };
    const vm = toBoardViewModel({ kind: 'ready', handoff: validated(body) }, NOW);
    expect(vm.timezoneNote).toBeNull();
    expect(vm.sessions.map((s) => s.time)).toEqual([
      'Monday 30 November, 10:30 AM (UTC-08:00)',
      'Tuesday 1 December, 2:00 PM (UTC-07:00)',
    ]);
  });

  test('bundles are labelled "bundle N of M" only when there is more than one', () => {
    expect(bundleLabel({ path: '/p', number: 1, of: 1 })).toBe('Add to Apple Wallet');
    expect(bundleLabel({ path: '/p', number: 2, of: 3 })).toBe(
      'Add to Apple Wallet (bundle 2 of 3)',
    );
  });

  test('every other state has constant text, no links, and the right busy and retry flags', () => {
    const cases: [BoardState, Partial<BoardViewModel>][] = [
      [INITIAL_BOARD_STATE, { heading: MESSAGES.readingHeading, busy: true, canRetry: false }],
      [LOADING, { message: MESSAGES.loadingMessage, busy: true, canRetry: false }],
      [{ kind: 'invalidLink' }, { heading: MESSAGES.invalidHeading, busy: false, canRetry: false }],
      [{ kind: 'expired' }, { message: MESSAGES.expiredMessage, canRetry: false }],
      [{ kind: 'rateLimited' }, { message: MESSAGES.rateLimitedMessage, canRetry: true }],
      [{ kind: 'unavailable' }, { message: MESSAGES.unavailableMessage, canRetry: true }],
    ];
    for (const [state, expected] of cases) {
      const vm = toBoardViewModel(state, NOW);
      expect(vm).toMatchObject(expected);
      expect(vm.actions).toEqual([]);
      expect(vm.sessions).toEqual([]);
      expect(vm.announcement).toBe(`${vm.heading}. ${vm.message}`);
    }
  });

  test('the incomplete link sentence is not repeated between heading and message', () => {
    const vm = toBoardViewModel({ kind: 'invalidLink' }, NOW);
    expect(vm.heading).toBe('This link is not complete');
    expect(vm.message).toBe('Scan the QR code again on your computer.');
    expect(vm.message).not.toContain(vm.heading);
    expect(vm.announcement).toBe(
      'This link is not complete. Scan the QR code again on your computer.',
    );
  });
});

const outcomeArb: fc.Arbitrary<HandoffOutcome> = fc.oneof(
  fc.integer({ min: 100, max: 599 }).map((status): HandoffOutcome => ({ kind: 'status', status })),
  fc.constant<HandoffOutcome>({ kind: 'ok', body: {} }),
  fc.constant<HandoffOutcome>({ kind: 'notJson' }),
  fc.constant<HandoffOutcome>({ kind: 'network' }),
  fc.constant<HandoffOutcome>({ kind: 'timeout' }),
);

describe('Property 5: Every request outcome maps to exactly one board state', () => {
  // Feature: showcase-site, Property 5: Every request outcome maps to exactly one board state
  test('outcomes map to ready, expired, rate limited or unavailable, and only ready has links', () => {
    fc.assert(
      fc.property(outcomeArb, fc.boolean(), (outcome, hasValidated) => {
        const handoff = hasValidated ? validated(exampleBody()) : null;
        const state = reduceBoard(LOADING, {
          type: 'outcome',
          outcome,
          validated: handoff,
          nowMs: NOW,
        });
        const isOk = outcome.kind === 'ok' && handoff !== null;
        const is404 = outcome.kind === 'status' && outcome.status === 404;
        const is429 = outcome.kind === 'status' && outcome.status === 429;
        const expected = isOk ? 'ready' : is404 ? 'expired' : is429 ? 'rateLimited' : 'unavailable';
        expect(state.kind).toBe(expected);
        if (state.kind !== 'ready') {
          expect(toBoardViewModel(state, NOW).actions).toEqual([]);
        }
      }),
      { numRuns: 500 },
    );
  });
});

describe('Property 6: The hand-off id never reaches visible text, the title or the console', () => {
  // Feature: showcase-site, Property 6: The hand-off id never reaches visible text, the title or the console
  const eventArb = (id: ReturnType<typeof validated>): fc.Arbitrary<BoardEvent> =>
    fc.oneof(
      fc.constant<BoardEvent>({ type: 'fragmentRead', result: { ok: false } }),
      fc.constant<BoardEvent>({ type: 'requestStarted' }),
      outcomeArb.map((outcome): BoardEvent => ({
        type: 'outcome',
        outcome,
        validated: outcome.kind === 'ok' ? id : null,
        nowMs: NOW,
      })),
      fc
        .integer({ min: 0, max: 4_000_000_000_000 })
        .map((nowMs): BoardEvent => ({ type: 'clock', nowMs })),
    );

  function strings(vm: BoardViewModel): string[] {
    return [
      vm.heading,
      vm.message,
      vm.announcement,
      vm.expiresText ?? '',
      vm.timezoneNote ?? '',
      vm.deviceHint ?? '',
      ...vm.sessions.flatMap((s) => [s.code, s.title, s.time]),
      ...vm.actions.map((a) => a.label),
    ];
  }

  test('the id appears only in action hrefs that start with the hand-off path', () => {
    fc.assert(
      fc.property(
        idArb.chain((id) =>
          fc.tuple(
            fc.constant(id),
            bodyArb(id).map((body) => validateHandoffView(body, id)),
          ),
        ),
        fc.nat(),
        (pair, seed) => {
          const [id, handoff] = pair;
          fc.pre(handoff !== null);
          const ready = handoff;
          const events = fc.sample(eventArb(ready), { numRuns: 12, seed });
          let state: BoardState = INITIAL_BOARD_STATE;
          const views = [
            toBoardViewModel(state, NOW),
            toBoardViewModel({ kind: 'ready', handoff: ready }, NOW),
          ];
          for (const event of events) {
            state = reduceBoard(state, event);
            views.push(toBoardViewModel(state, NOW));
          }
          for (const vm of views) {
            for (const text of strings(vm)) {
              expect(text.includes(id)).toBe(false);
            }
            for (const action of vm.actions) {
              if (action.kind === 'google') {
                expect(action.href.startsWith(GOOGLE_SAVE_PREFIX)).toBe(true);
              } else {
                expect(action.href.startsWith(`/api/v1/handoffs/${id}/`)).toBe(true);
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 7: Local expiry removes every action', () => {
  // Feature: showcase-site, Property 7: Local expiry removes every action
  test('the state after a clock event is expired with no actions exactly at or after expiry', () => {
    fc.assert(
      fc.property(
        idArb.chain((id) => bodyArb(id).map((body) => validateHandoffView(body, id))),
        fc.integer({ min: -3, max: 3 }),
        fc.boolean(),
        (handoff, delta, atBoundary) => {
          fc.pre(handoff !== null);
          const h = handoff;
          const nowMs = atBoundary ? h.expiresAtMs + delta : h.expiresAtMs + delta * 1_000_000;
          const ready: BoardState = { kind: 'ready', handoff: h };
          const next = reduceBoard(ready, { type: 'clock', nowMs });
          if (nowMs >= h.expiresAtMs) {
            expect(next).toEqual({ kind: 'expired' });
            expect(toBoardViewModel(next, nowMs).actions).toEqual([]);
          } else {
            expect(next).toBe(ready);
            expect(toBoardViewModel(next, nowMs).actions).toEqual(
              toBoardViewModel(ready, nowMs).actions,
            );
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  test('isoArb values parse to real instants (generator sanity)', () => {
    fc.assert(
      fc.property(isoArb, (iso) => Number.isFinite(Date.parse(iso))),
      { numRuns: 100 },
    );
  });
});

describe('Property 8: Apple bundle labels cover each bundle exactly once', () => {
  // Feature: showcase-site, Property 8: Apple bundle labels cover each bundle exactly once
  test('labels name bundles 1 to N once each, and a single bundle has no number', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 8 }), (count) => {
        const labels = Array.from({ length: count }, (_, index) =>
          bundleLabel({ path: `/p/${String(index)}`, number: index + 1, of: count }),
        );
        expect(new Set(labels).size).toBe(count);
        if (count === 1) {
          expect(labels).toEqual(['Add to Apple Wallet']);
        } else {
          labels.forEach((label, index) => {
            expect(label).toBe(
              `Add to Apple Wallet (bundle ${String(index + 1)} of ${String(count)})`,
            );
          });
        }
      }),
      { numRuns: 100 },
    );
  });

  test('a validated hand-off yields one apple action per bundle, labelled in order', () => {
    fc.assert(
      fc.property(
        idArb.chain((id) => bodyArb(id).map((body) => validateHandoffView(body, id))),
        (handoff) => {
          fc.pre(handoff !== null);
          const h = handoff;
          const apple = toBoardViewModel({ kind: 'ready', handoff: h }, NOW).actions.filter(
            (a) => a.kind === 'apple',
          );
          expect(apple.map((a) => a.href)).toEqual(h.appleBundles.map((b) => b.path));
          expect(new Set(apple.map((a) => a.label)).size).toBe(apple.length);
        },
      ),
      { numRuns: 200 },
    );
  });
});
