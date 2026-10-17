// Keyed hashing of identifiers (ADR-012, security review M1). The pepper is never used
// directly: HKDF-SHA256 derives one sub-key per purpose, named by an info string, so a
// SubHash can never be confused with a DeviceHash or an Auth_Token key.
import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

export const SUB_INFO = 'compass/sub/v1';
export const DEVICE_INFO = 'compass/device/v1';
export const AUTH_TOKEN_INFO = 'compass/authtoken/v1';

/** A 32-byte sub-key derived from the pepper for one purpose. */
export function deriveKey(pepper: string, info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', pepper, '', info, 32));
}

function keyedHex(pepper: string, info: string, value: string): string {
  return createHmac('sha256', deriveKey(pepper, info)).update(value, 'utf8').digest('hex');
}

/** Hex HMAC-SHA256 of the Builder ID `sub`. The only identity the service stores. */
export function subHash(pepper: string, sub: string): string {
  return keyedHex(pepper, SUB_INFO, sub);
}

/** Hex HMAC-SHA256 of Apple's `deviceLibraryIdentifier`. */
export function deviceHash(pepper: string, deviceLibraryIdentifier: string): string {
  return keyedHex(pepper, DEVICE_INFO, deviceLibraryIdentifier);
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Constant-time comparison of two strings. A length mismatch still performs a dummy
 * comparison so the time does not reveal which side was shorter.
 */
export function constantTimeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}
