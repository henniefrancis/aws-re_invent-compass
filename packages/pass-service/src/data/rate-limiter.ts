// Fixed-window rate limits in DynamoDB (Requirement 6, review H2, H3 and M4).
//
// Windows are one hour long and aligned to the epoch hour. Each count is one conditional
// DynamoDB update, so concurrent requests cannot together exceed a limit. A counter item
// expires at its window end and its ttl follows 120 seconds later. `record` adds without
// ever refusing, which is how update and void stay available (Requirement 6.5).
import { COUNTER_TTL_MARGIN_SECONDS, RATE_PREFIX, SUB_PREFIX, rateKey, ttlOf } from './keys.js';
import type { TableClient } from './table-client.js';

export type LimitKind =
  | 'passWrites' // issue (units per pass), update and void are recorded here
  | 'handoffs'
  | 'forgetMe'
  | 'updates' // per SubHash: updates that fan out
  | 'passUpdate' // per pass (scope = serial): updates that fan out
  | 'handoffReads'; // per hand-off (scope = hand-off hash): reads

/** Limits per one-hour window, except handoffReads which lasts as long as the hand-off. */
export const LIMITS: Readonly<Record<LimitKind, number>> = {
  passWrites: 60,
  handoffs: 10,
  forgetMe: 5,
  updates: 120,
  passUpdate: 20,
  handoffReads: 30,
};

export const ACTIVE_PASS_LIMIT = 80;

const WINDOW_SECONDS = 3600;
const UNLIMITED = Number.MAX_SAFE_INTEGER;

export interface LimitDecision {
  allowed: boolean;
  /** Whole seconds until the window ends, at least 1. */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  /** Refuses when the count plus `units` would exceed the limit. */
  consume(
    subHash: string,
    kind: LimitKind,
    units: number,
    now: number,
    scope?: string,
  ): Promise<LimitDecision>;
  /** Counts without refusing. */
  record(
    subHash: string,
    kind: LimitKind,
    units: number,
    now: number,
    scope?: string,
  ): Promise<void>;
  /** Counts one read of a hand-off; the counter lives until the hand-off expires. */
  consumeHandoffRead(
    subHash: string,
    handoffHash: string,
    handoffExpiresAtMs: number,
  ): Promise<boolean>;
}

function windowOf(now: number): { startSec: number; endMs: number } {
  const startSec = Math.floor(now / 1000 / WINDOW_SECONDS) * WINDOW_SECONDS;
  return { startSec, endMs: (startSec + WINDOW_SECONDS) * 1000 };
}

function counterName(kind: LimitKind, scope: string | undefined): string {
  return scope === undefined ? kind : `${kind}:${scope}`;
}

function counterAttributes(
  subHash: string,
  kind: LimitKind,
  name: string,
  startSec: number,
  endMs: number,
): Record<string, unknown> {
  return {
    subHash,
    kind,
    windowStartSec: startSec,
    expiresAtMs: endMs,
    ttl: ttlOf(endMs) + COUNTER_TTL_MARGIN_SECONDS,
    gsi2pk: `${SUB_PREFIX}${subHash}`,
    gsi2sk: `${RATE_PREFIX}${name}#${startSec}`,
  };
}

export function createRateLimiter(table: TableClient): RateLimiter {
  async function add(
    subHash: string,
    kind: LimitKind,
    units: number,
    now: number,
    scope: string | undefined,
    max: number,
  ): Promise<LimitDecision> {
    const { startSec, endMs } = windowOf(now);
    const name = counterName(kind, scope);
    const { allowed } = await table.addCounter(
      rateKey(subHash, name, startSec),
      units,
      max,
      counterAttributes(subHash, kind, name, startSec, endMs),
    );
    return { allowed, retryAfterSeconds: Math.max(1, Math.ceil((endMs - now) / 1000)) };
  }

  return {
    consume: (subHash, kind, units, now, scope) =>
      add(subHash, kind, units, now, scope, LIMITS[kind]),

    async record(subHash, kind, units, now, scope) {
      await add(subHash, kind, units, now, scope, UNLIMITED);
    },

    async consumeHandoffRead(subHash, handoffHash, handoffExpiresAtMs) {
      const name = counterName('handoffReads', handoffHash);
      const { allowed } = await table.addCounter(
        rateKey(subHash, name, 0),
        1,
        LIMITS.handoffReads,
        counterAttributes(subHash, 'handoffReads', name, 0, handoffExpiresAtMs),
      );
      return allowed;
    },
  };
}
