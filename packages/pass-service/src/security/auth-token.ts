// The Apple authenticationToken. It is derived, never stored: only its SHA-256 is kept.
// token = base64url(HMAC-SHA256(authKey, serial "." tokenSalt)), 43 characters, where the
// authKey comes from the pepper by HKDF and the tokenSalt is random per pass (review M1).
// Deriving it lets every rebuild of the same pass carry the same token (design, Component 5).
import { createHmac } from 'node:crypto';
import type { Random } from '../seams.js';
import { AUTH_TOKEN_INFO, deriveKey } from './hashing.js';

export function deriveAuthToken(pepper: string, serialNumber: string, tokenSalt: string): string {
  return createHmac('sha256', deriveKey(pepper, AUTH_TOKEN_INFO))
    .update(`${serialNumber}.${tokenSalt}`, 'utf8')
    .digest('base64url');
}

/** A per-pass random salt: 16 bytes, base64url, 22 characters. */
export function newTokenSalt(random: Random): string {
  return Buffer.from(random.bytes(16)).toString('base64url');
}
