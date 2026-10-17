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
export function isLive(item: object, now: number): boolean {
  const expiresAtMs = (item as { expiresAtMs?: unknown }).expiresAtMs;
  return typeof expiresAtMs === 'number' && now < expiresAtMs;
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

export function rateKey(subHash: string, name: string, windowStartSec: number): Key {
  return { pk: `${RATE_PREFIX}${subHash}`, sk: `${name}#${windowStartSec}` };
}

/**
 * Marker items live in the base table, so they can be counted with a strongly consistent
 * query (an index read is only eventually consistent). They exist to make two caps hold when
 * requests run at the same time (code review M2 and N7):
 *   ACTIVE#<subHash> / <serial>      one per live pass, counted against the 80 active pass cap
 *   PASSREG#<serial> / <deviceHash>  a copy of each registration, counted against the 10 devices cap
 */
export const ACTIVE_PREFIX = 'ACTIVE#';
export const PASSREG_PREFIX = 'PASSREG#';

export function activeMarkerKey(subHash: string, serialNumber: string): Key {
  return { pk: `${ACTIVE_PREFIX}${subHash}`, sk: serialNumber };
}

export function passRegistrationKey(serialNumber: string, deviceHash: string): Key {
  return { pk: `${PASSREG_PREFIX}${serialNumber}`, sk: deviceHash };
}

/** True for the marker items, which are bookkeeping and never counted as the attendee data. */
export function isMarker(item: { pk: string }): boolean {
  return item.pk.startsWith(ACTIVE_PREFIX) || item.pk.startsWith(PASSREG_PREFIX);
}
