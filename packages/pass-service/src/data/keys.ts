// The DynamoDB key formats (design, Data Models). One table, two GSIs.
import type { Key } from './table-client.js';

/** A pass and its registrations are kept 24 hours after the session ends (ADR-022). */
export const EXPIRY_GRACE_MS = 24 * 60 * 60 * 1000;
export const HANDOFF_LIFETIME_MS = 15 * 60 * 1000;
/** A Rate_Counter lives 120 seconds past its window end. */
export const COUNTER_TTL_MARGIN_SECONDS = 120;

export function ttlOf(expiresAtMs: number): number {
  return Math.ceil(expiresAtMs / 1000);
}

/** Expiry is code: every read treats an item at or past its expiry as absent. */
export function isLive(item: Record<string, unknown>, now: number): boolean {
  return typeof item.expiresAtMs === 'number' && now < item.expiresAtMs;
}

export const PASS_PREFIX = 'PASS#';
export const DEVICE_PREFIX = 'DEV#';
export const REGISTRATION_PREFIX = 'REG#';
export const HANDOFF_PREFIX = 'HANDOFF#';
export const RATE_PREFIX = 'RATE#';
export const SUB_PREFIX = 'SUB#';

export function passKey(serialNumber: string): Key {
  return { pk: `${PASS_PREFIX}${serialNumber}`, sk: 'PASS' };
}

export function registrationKey(deviceHash: string, serialNumber: string): Key {
  return { pk: `${DEVICE_PREFIX}${deviceHash}`, sk: `${REGISTRATION_PREFIX}${serialNumber}` };
}

export function handoffKey(handoffHash: string): Key {
  return { pk: `${HANDOFF_PREFIX}${handoffHash}`, sk: 'HANDOFF' };
}

export function subIndexKey(subHash: string): string {
  return `${SUB_PREFIX}${subHash}`;
}
