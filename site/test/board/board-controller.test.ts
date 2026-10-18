import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import type { BoardState } from '../../src/lib/board/board-state';
import {
  BOARD_PATH,
  MAX_TIMER_MS,
  createBoardController,
  type BoardControllerDeps,
} from '../../src/lib/board/board-controller';
import { parseBoardFragment } from '../../src/lib/board/fragment';
import type { FetchLike } from '../../src/lib/board/handoff-client';
import {
  FIXED_ID,
  bodyArb,
  exampleBody,
  idArb,
  makeTimers,
  response,
} from '../support/handoff-data';

interface Rig {
  readonly events: string[];
  readonly states: BoardState[];
  readonly timers: ReturnType<typeof makeTimers>;
  readonly controller: ReturnType<typeof createBoardController>;
  readonly setNow: (ms: number) => void;
  readonly refreshes: () => number;
  readonly fireVisible: () => void;
  readonly listeners: () => number;
  readonly fetchCalls: () => number;
}

function rig(options: { hash: string; fetch?: FetchLike; now?: number }): Rig {
  const events: string[] = [];
  const states: BoardState[] = [];
  const timers = makeTimers();
  let now = options.now ?? Date.parse('2026-11-30T10:00:00-08:00');
  let fetchCalls = 0;
  let refreshCount = 0;
  const visibleListeners = new Set<() => void>();
  const defaultFetch: FetchLike = () =>
    Promise.resolve(response(200, JSON.stringify(exampleBody())));
  const inner = options.fetch ?? defaultFetch;
  const deps: BoardControllerDeps = {
    readHash: () => {
      events.push('readHash');
      return options.hash;
    },
    replaceState: (path) => {
      events.push(`replaceState:${path}`);
    },
    fetch: (url, init) => {
      events.push('fetch');
      fetchCalls += 1;
      return inner(url, init);
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    now: () => now,
    onRefresh: () => {
      refreshCount += 1;
    },
    subscribeVisible: (listener) => {
      visibleListeners.add(listener);
      return () => {
        visibleListeners.delete(listener);
      };
    },
    onChange: (state) => {
      states.push(state);
    },
  };
  return {
    events,
    states,
    timers,
    controller: createBoardController(deps),
    setNow: (ms) => {
      now = ms;
    },
    fetchCalls: () => fetchCalls,
    refreshes: () => refreshCount,
    fireVisible: () => {
      for (const listener of [...visibleListeners]) {
        listener();
      }
    },
    listeners: () => visibleListeners.size,
  };
}

const expiryTimers = (r: Rig) => [...r.timers.pending.values()].filter((t) => t.ms !== 10_000);

describe('board controller flow', () => {
  test('reads the hash once, strips the fragment, then fetches once and shows the passes', async () => {
    const r = rig({ hash: `#h=${FIXED_ID}` });
    expect(r.controller.state()).toEqual({ kind: 'reading' });
    await r.controller.start();
    expect(r.events).toEqual(['readHash', `replaceState:${BOARD_PATH}`, 'fetch']);
    expect(r.states.map((s) => s.kind)).toEqual(['loading', 'ready']);
    expect(r.controller.state().kind).toBe('ready');
  });

  test('an invalid fragment is stripped, ends in invalid link and sends no request', async () => {
    const r = rig({ hash: '#h=short' });
    await r.controller.start();
    expect(r.events).toEqual(['readHash', 'replaceState:/board']);
    expect(r.states.map((s) => s.kind)).toEqual(['invalidLink']);
    await r.controller.retry();
    expect(r.fetchCalls()).toBe(0);
  });

  test('start does nothing the second time', async () => {
    const r = rig({ hash: `#h=${FIXED_ID}` });
    await r.controller.start();
    await r.controller.start();
    expect(r.events.filter((e) => e === 'readHash')).toHaveLength(1);
    expect(r.fetchCalls()).toBe(1);
  });

  test('404, 429 and a failure map to their states, and retry sends exactly one request', async () => {
    let status = 429;
    const r = rig({
      hash: `#h=${FIXED_ID}`,
      fetch: () => Promise.resolve(response(status, 'server text')),
    });
    await r.controller.start();
    expect(r.controller.state().kind).toBe('rateLimited');
    status = 503;
    await r.controller.retry();
    expect(r.controller.state().kind).toBe('unavailable');
    expect(r.fetchCalls()).toBe(2);
    status = 404;
    await r.controller.retry();
    expect(r.controller.state().kind).toBe('expired');
    expect(r.fetchCalls()).toBe(3);
    await r.controller.retry();
    expect(r.fetchCalls()).toBe(3);
  });

  test('a rejected body is unavailable', async () => {
    const r = rig({
      hash: `#h=${FIXED_ID}`,
      fetch: () => Promise.resolve(response(200, '{"expiresAt":1}')),
    });
    await r.controller.start();
    expect(r.controller.state().kind).toBe('unavailable');
  });

  test('one timer expires the hand-off when the device clock reaches expiresAt', async () => {
    const r = rig({ hash: `#h=${FIXED_ID}` });
    await r.controller.start();
    const timers = expiryTimers(r);
    expect(timers).toHaveLength(1);
    expect(timers[0]?.ms).toBe(15 * 60_000);
    r.setNow(Date.parse('2026-11-30T10:15:00-08:00'));
    r.timers.fireAll();
    expect(r.controller.state().kind).toBe('expired');
    expect(r.timers.pending.size).toBe(0);
  });

  test('a timer that fires early waits again instead of expiring', async () => {
    const r = rig({ hash: `#h=${FIXED_ID}` });
    await r.controller.start();
    r.setNow(Date.parse('2026-11-30T10:10:00-08:00'));
    r.timers.fireAll();
    expect(r.controller.state().kind).toBe('ready');
    expect(expiryTimers(r)).toHaveLength(1);
    expect(expiryTimers(r)[0]?.ms).toBe(5 * 60_000);
  });

  test('an answer that arrives after expiry is Expired at once, with no timer, and a far future expiry waits in steps', async () => {
    const past = rig({ hash: `#h=${FIXED_ID}`, now: Date.parse('2026-11-30T11:00:00-08:00') });
    await past.controller.start();
    expect(past.controller.state().kind).toBe('expired');
    expect(expiryTimers(past)).toHaveLength(0);
    const far = rig({
      hash: `#h=${FIXED_ID}`,
      fetch: () =>
        Promise.resolve(
          response(200, JSON.stringify({ ...exampleBody(), expiresAt: '2099-01-01T00:00:00Z' })),
        ),
    });
    await far.controller.start();
    expect(expiryTimers(far)[0]?.ms).toBe(MAX_TIMER_MS);
  });

  test('coming back to the page re-checks the expiry and refreshes the text (visibilitychange, pageshow)', async () => {
    const r = rig({ hash: `#h=${FIXED_ID}` });
    await r.controller.start();
    expect(r.listeners()).toBe(1);
    r.fireVisible();
    expect(r.controller.state().kind).toBe('ready');
    expect(r.refreshes()).toBe(1);
    // The phone was asleep past expiresAt, and the timer never fired.
    r.setNow(Date.parse('2026-11-30T10:20:00-08:00'));
    r.fireVisible();
    expect(r.controller.state().kind).toBe('expired');
    expect(r.refreshes()).toBe(2);
    expect(r.states.at(-1)?.kind).toBe('expired');
  });

  test('the visibility listener is removed on dispose and not added for an invalid link', async () => {
    const bad = rig({ hash: '#h=short' });
    await bad.controller.start();
    expect(bad.listeners()).toBe(0);
    const good = rig({ hash: `#h=${FIXED_ID}` });
    await good.controller.start();
    good.controller.dispose();
    expect(good.listeners()).toBe(0);
    good.fireVisible();
    expect(good.refreshes()).toBe(0);
  });

  test('dispose clears the timer and ignores a late answer', async () => {
    let answer: (value: ReturnType<typeof response>) => void = () => undefined;
    const r = rig({
      hash: `#h=${FIXED_ID}`,
      fetch: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    const started = r.controller.start();
    r.controller.dispose();
    answer(response(200, JSON.stringify(exampleBody())));
    await started;
    expect(r.controller.state().kind).toBe('loading');
    expect(r.states.map((s) => s.kind)).toEqual(['loading']);
    r.controller.dispose();
  });

  test('dispose of a ready page clears its expiry timer', async () => {
    const r = rig({ hash: `#h=${FIXED_ID}` });
    await r.controller.start();
    r.controller.dispose();
    expect(r.timers.pending.size).toBe(0);
  });
});

describe('Property 2: An invalid link never sends a request', () => {
  // Feature: showcase-site, Property 2: An invalid link never sends a request
  test('for any refused fragment the hash is read once, stripped, and no request is made', async () => {
    const refused = fc
      .oneof(
        fc.string({ maxLength: 40 }),
        idArb.map((id) => `#h=${id}x`),
        idArb.map((id) => `#H=${id}`),
        idArb.map((id) => `?h=${id}`),
        idArb.map((id) => `#h=${id.slice(0, 21)}B`),
      )
      .filter((hash) => !parseBoardFragment(hash).ok);
    await fc.assert(
      fc.asyncProperty(refused, async (hash) => {
        const r = rig({ hash });
        await r.controller.start();
        await r.controller.retry();
        expect(r.events).toEqual(['readHash', 'replaceState:/board']);
        expect(r.fetchCalls()).toBe(0);
        expect(r.controller.state()).toEqual({ kind: 'invalidLink' });
        expect(r.timers.pending.size).toBe(0);
      }),
      { numRuns: 300 },
    );
  });

  test('for any valid id the fragment is stripped before the one request, and retries make one each', async () => {
    await fc.assert(
      fc.asyncProperty(
        idArb.chain((id) => fc.tuple(fc.constant(id), bodyArb(id))),
        fc.integer({ min: 0, max: 4 }),
        async ([id, body], retries) => {
          let status = 500;
          const r = rig({
            hash: `#h=${id}`,
            fetch: () =>
              Promise.resolve(
                response(status, JSON.stringify({ ...body, expiresAt: '2099-01-01T00:00:00Z' })),
              ),
          });
          await r.controller.start();
          expect(r.events.slice(0, 3)).toEqual(['readHash', 'replaceState:/board', 'fetch']);
          let expected = 1;
          for (let i = 0; i < retries; i += 1) {
            await r.controller.retry();
            expected += 1;
            expect(r.fetchCalls()).toBe(expected);
          }
          status = 200;
          await r.controller.retry();
          expected += 1;
          expect(r.fetchCalls()).toBe(expected);
          expect(r.controller.state().kind).toBe('ready');
          await r.controller.retry();
          expect(r.fetchCalls()).toBe(expected);
          expect(r.events.filter((e) => e === 'readHash')).toHaveLength(1);
          expect(r.events.filter((e) => e.startsWith('replaceState'))).toHaveLength(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});
