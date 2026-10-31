import fc from 'fast-check';
import { describe, expect, test, vi } from 'vitest';
import { COUNTER_TTL_MARGIN_SECONDS } from '../../src/data/keys.js';
import {
  ACTIVE_PASS_LIMIT,
  LIMITS,
  createRateLimiter,
  type LimitKind,
} from '../../src/data/rate-limiter.js';
import type { TableClient } from '../../src/data/table-client.js';
import { createMemoryTable } from '../../src/harness/memory-table.js';

const HOUR_MS = 3_600_000;
const EPOCH_HOUR = Math.floor(Date.parse('2026-12-02T12:00:00Z') / HOUR_MS) * HOUR_MS;

// Property tests do real work (signing, TLS, many records) and the machine may be busy.
vi.setConfig({ testTimeout: 120_000 });

describe('Feature: pass-service, rate limiter', () => {
  test('the limits match the amended plan', () => {
    expect(LIMITS).toEqual({
      passWrites: 60,
      handoffs: 10,
      forgetMe: 5,
      updates: 120,
      passUpdate: 20,
      handoffReads: 30,
    });
    expect(ACTIVE_PASS_LIMIT).toBe(80);
  });

  test('consume refuses past the limit with Retry-After to the window end, and a new window starts at zero', async () => {
    const table = createMemoryTable();
    const limiter = createRateLimiter(table);
    const now = EPOCH_HOUR + 10 * 60_000 + 250;
    expect(await limiter.consume('s', 'handoffs', 10, now)).toEqual({
      allowed: true,
      retryAfterSeconds: 3000,
    });
    expect(await limiter.consume('s', 'handoffs', 1, now)).toEqual({
      allowed: false,
      retryAfterSeconds: 3000,
    });
    expect(await limiter.consume('s', 'handoffs', 1, EPOCH_HOUR + HOUR_MS)).toMatchObject({
      allowed: true,
    });
    expect(await limiter.consume('other', 'handoffs', 1, now)).toMatchObject({ allowed: true });
    // The last second of a window still reports at least one second.
    expect(
      (await limiter.consume('s', 'forgetMe', 1, EPOCH_HOUR + HOUR_MS - 1)).retryAfterSeconds,
    ).toBe(1);
  });

  test('scoped counters are separate, and record never refuses', async () => {
    const limiter = createRateLimiter(createMemoryTable());
    for (let i = 0; i < 20; i += 1) {
      expect((await limiter.consume('s', 'passUpdate', 1, EPOCH_HOUR, 'serial-1')).allowed).toBe(
        true,
      );
    }
    expect((await limiter.consume('s', 'passUpdate', 1, EPOCH_HOUR, 'serial-1')).allowed).toBe(
      false,
    );
    expect((await limiter.consume('s', 'passUpdate', 1, EPOCH_HOUR, 'serial-2')).allowed).toBe(
      true,
    );
    for (let i = 0; i < 200; i += 1) {
      await limiter.record('s', 'passWrites', 1, EPOCH_HOUR);
    }
    expect((await limiter.consume('s', 'passWrites', 1, EPOCH_HOUR)).allowed).toBe(false);
  });

  test('hand-off reads are capped at 30 plus 2 for every pass and the counter lives as long as the hand-off', async () => {
    const table = createMemoryTable();
    const limiter = createRateLimiter(table);
    const expiresAtMs = EPOCH_HOUR + 900_000;
    for (let i = 0; i < 32; i += 1) {
      expect(await limiter.consumeHandoffRead('s', 'hash-1', expiresAtMs, 1)).toBe(true);
    }
    expect(await limiter.consumeHandoffRead('s', 'hash-1', expiresAtMs, 1)).toBe(false);
    expect(await limiter.consumeHandoffRead('s', 'hash-2', expiresAtMs, 1)).toBe(true);
    expect(table.snapshot()[0]).toMatchObject({
      expiresAtMs,
      ttl: expiresAtMs / 1000 + COUNTER_TTL_MARGIN_SECONDS,
      gsi2pk: 'SUB#s',
    });
  });

  test('the hand-off read cap grows with the passes, to 190 at 80 passes', async () => {
    const limiter = createRateLimiter(createMemoryTable());
    const expiresAtMs = EPOCH_HOUR + 900_000;
    for (let i = 0; i < 190; i += 1) {
      expect(await limiter.consumeHandoffRead('s', 'hash-80', expiresAtMs, 80)).toBe(true);
    }
    expect(await limiter.consumeHandoffRead('s', 'hash-80', expiresAtMs, 80)).toBe(false);
  });

  // Feature: pass-service, Property 8: The fixed-window limiter allows exactly up to the limit, atomically
  test('Property 8: concurrent consumes never exceed the limit, and each is allowed exactly when it fits at its turn', async () => {
    const kinds: LimitKind[] = ['passWrites', 'handoffs', 'forgetMe', 'updates'];
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...kinds),
        fc.array(fc.integer({ min: 1, max: 25 }), { minLength: 1, maxLength: 30 }),
        fc.integer({ min: 0, max: HOUR_MS - 1 }),
        fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 1, maxLength: 40 }),
        async (kind, unitsList, offset, yields) => {
          const log: { units: number; allowed: boolean }[] = [];
          let step = 0;
          const inner = createMemoryTable({
            interleave: async () => {
              const count = yields[step % yields.length] ?? 0;
              step += 1;
              for (let i = 0; i < count; i += 1) {
                await Promise.resolve();
              }
            },
          });
          const table: TableClient = {
            ...inner,
            async addCounter(key, units, max, attrs) {
              const result = await inner.addCounter(key, units, max, attrs);
              log.push({ units, allowed: result.allowed });
              return result;
            },
          };
          const limiter = createRateLimiter(table);
          const now = EPOCH_HOUR + offset;
          const decisions = await Promise.all(
            unitsList.map((units) => limiter.consume('sub', kind, units, now)),
          );
          const limit = LIMITS[kind];
          let used = 0;
          for (const entry of log) {
            expect(entry.allowed).toBe(used + entry.units <= limit);
            if (entry.allowed) {
              used += entry.units;
            }
          }
          expect(used).toBeLessThanOrEqual(limit);
          const expectedRetry = Math.max(1, Math.ceil((EPOCH_HOUR + HOUR_MS - now) / 1000));
          expect(decisions.every((d) => d.retryAfterSeconds === expectedRetry)).toBe(true);
          const item = inner.snapshot()[0];
          if (used > 0) {
            expect(item).toMatchObject({
              count: used,
              expiresAtMs: EPOCH_HOUR + HOUR_MS,
              ttl: (EPOCH_HOUR + HOUR_MS) / 1000 + COUNTER_TTL_MARGIN_SECONDS,
              windowStartSec: EPOCH_HOUR / 1000,
            });
          }
          // A new window starts at zero.
          expect((await limiter.consume('sub', kind, limit, EPOCH_HOUR + HOUR_MS)).allowed).toBe(
            true,
          );
        },
      ),
      { numRuns: 150 },
    );
  });
});
