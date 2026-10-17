import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import {
  MAX_CATALOG_PAGES,
  MAX_CATALOG_SESSIONS,
  fetchAllSessions,
} from '../../src/catalog/paginate.js';
import { CatalogIncompleteError } from '../../src/catalog/errors.js';
import { createHarness, response } from '../api/operation-harness.js';
import type { SessionWire } from '@compass/contracts';

// Tests for catalog pagination (events-client, S1, tasks 13.3 to 13.5).

function session(id: string): SessionWire {
  return { sessionId: id, title: `Title ${id}` };
}

describe('Feature: events-client, Property 23: Pagination returns every page in order and stops only when nextToken is absent', () => {
  // Validates: Requirements 13.1, 13.2, 13.3, 13.4
  test('for any page sequence every page is requested in order, short pages included', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 1, maxLength: 8 }),
        fc.boolean(),
        async (sizes, includeAbstracts) => {
          let n = 0;
          const pages = sizes.map((size, i) => ({
            items: Array.from({ length: size }, () => session(`s${String(n++)}`)),
            nextToken: i < sizes.length - 1 ? `token-${String(i)}` : undefined,
          }));
          const h = createHarness({
            responses: pages.map((p) =>
              response(200, { items: p.items, totalCount: n, nextToken: p.nextToken }),
            ),
          });
          const got = await fetchAllSessions(h.ctx, { includeAbstracts });
          expect(got).toEqual(pages.flatMap((p) => p.items));
          expect(h.sent).toHaveLength(pages.length);
          h.sent.forEach((req, i) => {
            expect(req.query?.includeAbstracts).toBe(String(includeAbstracts));
            expect(req.query?.nextToken).toBe(i === 0 ? undefined : `token-${String(i - 1)}`);
          });
        },
      ),
      { numRuns: 100 },
    );
  });

  test('a fast pass sends includeAbstracts=false on every request', async () => {
    const h = createHarness({
      responses: [
        response(200, { items: [], totalCount: 0, nextToken: 'a' }),
        response(200, { items: [], totalCount: 0 }),
      ],
    });
    await fetchAllSessions(h.ctx, { includeAbstracts: false });
    expect(h.sent.map((r) => r.query?.includeAbstracts)).toEqual(['false', 'false']);
  });

  test('an empty nextToken is treated as absent', async () => {
    const h = createHarness({
      responses: [response(200, { items: [session('a')], totalCount: 1, nextToken: '' })],
    });
    await expect(fetchAllSessions(h.ctx, { includeAbstracts: true })).resolves.toHaveLength(1);
    expect(h.sent).toHaveLength(1);
  });

  test('a repeated nextToken stops the fetch as incomplete instead of looping', async () => {
    const page = response(200, { items: [], totalCount: 0, nextToken: 'same' });
    const h = createHarness({ responses: [page, page, page] });
    const failure = await fetchAllSessions(h.ctx, { includeAbstracts: true }).catch(
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(CatalogIncompleteError);
    expect((failure as CatalogIncompleteError).pagesFetched).toBe(2);
    expect(h.sent).toHaveLength(2);
  });
});

describe('Feature: events-client, Property 24: Page 429 waits once then fails; non-retryable stops without completing', () => {
  // Validates: Requirements 13.5, 13.6
  const ok = (token?: string): ReturnType<typeof response> =>
    response(200, { items: [session('x')], totalCount: 1, nextToken: token });

  test('a 429 waits once, retries the same page, and the fetch continues', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 120 }), async (seconds) => {
        const h = createHarness({
          responses: [ok('t1'), response(429, undefined, { 'retry-after': String(seconds) }), ok()],
        });
        const got = await fetchAllSessions(h.ctx, { includeAbstracts: false });
        expect(got).toHaveLength(2);
        expect(h.sleeps()).toEqual([seconds * 1000]);
        expect(h.sent[1]?.query?.nextToken).toBe('t1');
        expect(h.sent[2]?.query?.nextToken).toBe('t1');
      }),
      { numRuns: 100 },
    );
  });

  test('a persistent 429 fails with one wait only and a did-not-complete error', async () => {
    const h = createHarness({
      responses: [
        ok('t1'),
        response(429, undefined, { 'retry-after': '3' }),
        response(429, undefined, { 'retry-after': '3' }),
      ],
    });
    const failure = await fetchAllSessions(h.ctx, { includeAbstracts: true }).catch(
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(CatalogIncompleteError);
    expect((failure as CatalogIncompleteError).status).toBe(429);
    expect((failure as CatalogIncompleteError).pagesFetched).toBe(1);
    expect(h.sleeps()).toEqual([3000]);
  });

  test('any non-retryable page error stops the fetch without completing', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(400, 403, 404, 409, 500, 503),
        fc.integer({ min: 0, max: 3 }),
        async (status, goodPages) => {
          const responses = [
            ...Array.from({ length: goodPages }, (_, i) => ok(`t${String(i)}`)),
            response(status, undefined),
            ok(),
          ];
          const h = createHarness({ responses });
          const failure = await fetchAllSessions(h.ctx, { includeAbstracts: true }).catch(
            (e: unknown) => e,
          );
          expect(failure).toBeInstanceOf(CatalogIncompleteError);
          expect((failure as CatalogIncompleteError).status).toBe(status);
          expect((failure as CatalogIncompleteError).pagesFetched).toBe(goodPages);
          expect(h.sent).toHaveLength(goodPages + 1);
        },
      ),
      { numRuns: 100 },
    );
  });

  test('an invalid page body and a client quota stop are also did-not-complete', async () => {
    const bad = createHarness({ responses: [response(200, { items: 'no' })] });
    await expect(fetchAllSessions(bad.ctx, { includeAbstracts: true })).rejects.toBeInstanceOf(
      CatalogIncompleteError,
    );
    const pages = Array.from({ length: 120 }, (_, i) =>
      response(200, { items: [], totalCount: 0, nextToken: `q${String(i)}` }),
    );
    const quota = createHarness({ responses: pages });
    const failure = await fetchAllSessions(quota.ctx, { includeAbstracts: true }).catch(
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(CatalogIncompleteError);
    expect((failure as CatalogIncompleteError).status).toBeUndefined();
  });

  test('a non-Events-API failure is also did-not-complete with no status', async () => {
    const h = createHarness({ responses: [] });
    const failure = await fetchAllSessions(h.ctx, { includeAbstracts: true }).catch(
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(CatalogIncompleteError);
    expect((failure as CatalogIncompleteError).status).toBeUndefined();
  });
});

describe('events-client, N6 and L5: pagination is bounded and failures keep a safe reason code', () => {
  const unlimited = (h: ReturnType<typeof createHarness>): void => {
    h.ctx.quota = { check: () => 'allow', record: () => undefined, note429: () => undefined };
  };

  test('more than 200 pages is an incomplete fetch with the page-limit reason', async () => {
    const pages = Array.from({ length: 205 }, (_, i) =>
      response(200, { items: [], totalCount: 0, nextToken: `t${String(i)}` }),
    );
    const h = createHarness({ responses: pages });
    unlimited(h);
    const failure = await fetchAllSessions(h.ctx, { includeAbstracts: true }).catch(
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(CatalogIncompleteError);
    expect((failure as CatalogIncompleteError).reason).toBe('page-limit');
    expect(h.sent).toHaveLength(MAX_CATALOG_PAGES);
  });

  test('exactly 200 pages ending in a last page still completes', async () => {
    const pages = Array.from({ length: 200 }, (_, i) =>
      response(200, {
        items: [],
        totalCount: 0,
        ...(i < 199 ? { nextToken: `t${String(i)}` } : {}),
      }),
    );
    const h = createHarness({ responses: pages });
    unlimited(h);
    await expect(fetchAllSessions(h.ctx, { includeAbstracts: true })).resolves.toEqual([]);
  });

  test('more than 20,000 sessions is an incomplete fetch with the session-limit reason', async () => {
    const big = (n: number, token?: string): ReturnType<typeof response> =>
      response(200, {
        items: Array.from({ length: 10_000 }, (_, i) => session(`s${String(n)}-${String(i)}`)),
        totalCount: 30_000,
        ...(token === undefined ? {} : { nextToken: token }),
      });
    const h = createHarness({ responses: [big(1, 'a'), big(2, 'b'), big(3)] });
    unlimited(h);
    const failure = await fetchAllSessions(h.ctx, { includeAbstracts: false }).catch(
      (e: unknown) => e,
    );
    expect((failure as CatalogIncompleteError).reason).toBe('session-limit');
    expect(MAX_CATALOG_SESSIONS).toBe(20_000);
  });

  test('a repeated token, a failing request and a typed failure carry their reason and class name only', async () => {
    const page = response(200, { items: [], totalCount: 0, nextToken: 'same' });
    const repeated = await fetchAllSessions(createHarness({ responses: [page, page] }).ctx, {
      includeAbstracts: true,
    }).catch((e: unknown) => e);
    expect((repeated as CatalogIncompleteError).reason).toBe('repeated-token');
    const failed = await fetchAllSessions(
      createHarness({ responses: [response(403, undefined)] }).ctx,
      { includeAbstracts: true },
    ).catch((e: unknown) => e);
    expect((failed as CatalogIncompleteError).reason).toBe('request-failed');
    expect((failed as CatalogIncompleteError).failure).toBe('ForbiddenError');
    expect((failed as CatalogIncompleteError).status).toBe(403);
    const untyped = await fetchAllSessions(createHarness({ responses: [] }).ctx, {
      includeAbstracts: true,
    }).catch((e: unknown) => e);
    expect((untyped as CatalogIncompleteError).failure).toBeUndefined();
  });
});
