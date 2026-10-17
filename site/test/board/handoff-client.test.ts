import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import {
  HANDOFF_TIMEOUT_MS,
  buildHandoffRequest,
  fetchHandoff,
  type FetchLike,
  type HandoffOutcome,
} from '../../src/lib/board/handoff-client';
import { FIXED_ID, idArb, makeTimers } from '../support/handoff-data';

function deps(fetchFn: FetchLike) {
  const timers = makeTimers();
  return {
    timers,
    value: {
      fetch: fetchFn,
      timeoutMs: HANDOFF_TIMEOUT_MS,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    },
  };
}

const respond =
  (status: number, text: () => Promise<string>): FetchLike =>
  () =>
    Promise.resolve({ status, text });

describe('buildHandoffRequest', () => {
  test('is a relative GET with credentials omitted and no cache or redirect', () => {
    const request = buildHandoffRequest(FIXED_ID);
    expect(request.url).toBe(`/api/v1/handoffs/${FIXED_ID}`);
    expect(request.init).toEqual({
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json' },
    });
    expect(request.init.body).toBeUndefined();
  });

  test('carries an abort signal when given one', () => {
    const controller = new AbortController();
    expect(buildHandoffRequest(FIXED_ID, controller.signal).init.signal).toBe(controller.signal);
  });
});

describe('fetchHandoff outcomes', () => {
  test('a 200 with JSON is ok', async () => {
    const { value, timers } = deps(respond(200, () => Promise.resolve('{"a":1}')));
    expect(await fetchHandoff(FIXED_ID, value)).toEqual({ kind: 'ok', body: { a: 1 } });
    expect(timers.pending.size).toBe(0);
    expect(timers.cleared).toHaveLength(1);
  });

  test('a 200 that is not JSON is notJson', async () => {
    const { value } = deps(respond(200, () => Promise.resolve('<html>')));
    expect(await fetchHandoff(FIXED_ID, value)).toEqual({ kind: 'notJson' });
  });

  test('another status is reported by number and its body is never read', async () => {
    let read = false;
    const { value } = deps(
      respond(404, () => {
        read = true;
        return Promise.resolve('secret server text');
      }),
    );
    expect(await fetchHandoff(FIXED_ID, value)).toEqual({ kind: 'status', status: 404 });
    expect(read).toBe(false);
  });

  test('a failing fetch or a failing body read is a network outcome', async () => {
    const rejecting = deps(() => Promise.reject(new Error('offline')));
    expect(await fetchHandoff(FIXED_ID, rejecting.value)).toEqual({ kind: 'network' });
    const failingBody = deps(respond(200, () => Promise.reject(new Error('cut'))));
    expect(await fetchHandoff(FIXED_ID, failingBody.value)).toEqual({ kind: 'network' });
  });

  test('a fetch that never answers ends in timeout and aborts the request', async () => {
    let signal: AbortSignal | null | undefined;
    const { value, timers } = deps((_url, init) => {
      signal = init.signal;
      return new Promise(() => undefined);
    });
    const pending = fetchHandoff(FIXED_ID, value);
    expect([...timers.pending.values()].map((t) => t.ms)).toEqual([10_000]);
    timers.fireAll();
    expect(await pending).toEqual({ kind: 'timeout' });
    expect(signal?.aborted).toBe(true);
  });
});

describe('Property 3: The hand-off request is one same-origin GET carrying the id only in the path', () => {
  // Feature: showcase-site, Property 3: The hand-off request is one same-origin GET carrying the id only in the path
  test('for any id the request is a relative GET with the id only in the path', () => {
    fc.assert(
      fc.property(idArb, (id) => {
        const { url, init } = buildHandoffRequest(id);
        expect(url).toBe(`/api/v1/handoffs/${id}`);
        expect(url.startsWith('/')).toBe(true);
        expect(init.method).toBe('GET');
        expect(init.credentials).toBe('omit');
        expect(init.cache).toBe('no-store');
        expect(init.redirect).toBe('error');
        expect(init.body ?? null).toBeNull();
        expect(JSON.stringify(init)).not.toContain(id);
      }),
      { numRuns: 200 },
    );
  });

  test('for any fetch behaviour fetch is called exactly once and the call settles', async () => {
    const behaviours = fc.constantFrom('resolve', 'reject', 'never', 'badStatus');
    await fc.assert(
      fc.asyncProperty(idArb, behaviours, async (id, behaviour) => {
        let calls = 0;
        const fetchFn: FetchLike = () => {
          calls += 1;
          if (behaviour === 'reject') {
            return Promise.reject(new Error('x'));
          }
          if (behaviour === 'never') {
            return new Promise(() => undefined);
          }
          return Promise.resolve({
            status: behaviour === 'resolve' ? 200 : 503,
            text: () => Promise.resolve('{}'),
          });
        };
        const { value, timers } = deps(fetchFn);
        const result = fetchHandoff(id, value);
        if (behaviour === 'never') {
          timers.fireAll();
        }
        const outcome: HandoffOutcome = await result;
        expect(calls).toBe(1);
        const expected: Record<string, string> = {
          resolve: 'ok',
          reject: 'network',
          never: 'timeout',
          badStatus: 'status',
        };
        expect(outcome.kind).toBe(expected[behaviour]);
      }),
      { numRuns: 100 },
    );
  });
});
