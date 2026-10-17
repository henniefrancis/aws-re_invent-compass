// PKCE and state generation (events-client, S1, task 9.1).
//
// A new code verifier and a new state value are generated for every sign-in attempt
// (Requirement 1.7). The S256 challenge is the base64url encoding of the SHA-256 of
// the verifier, without padding (Requirement 1.8). Randomness is injected so tests
// are deterministic; the default is node:crypto randomBytes.

import { createHash, randomBytes } from 'node:crypto';

/** A PKCE verifier and its S256 challenge. */
export interface PkcePair {
  verifier: string;
  challenge: string;
}

/** Produces `size` random bytes. Injected for tests. */
export type RandomBytes = (size: number) => Uint8Array;

const VERIFIER_BYTES = 32; // 43 base64url characters, within RFC 7636's 43 to 128
const STATE_BYTES = 16;

const defaultRandom: RandomBytes = (size) => randomBytes(size);

/** Base64url without padding. */
function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

/** The S256 challenge for a verifier: base64url(SHA-256(verifier)), no padding. */
export function computeChallenge(verifier: string): string {
  return base64url(createHash('sha256').update(verifier, 'ascii').digest());
}

/** Create a fresh verifier and its S256 challenge. */
export function createPkcePair(random: RandomBytes = defaultRandom): PkcePair {
  const verifier = base64url(random(VERIFIER_BYTES));
  return { verifier, challenge: computeChallenge(verifier) };
}

/** Create a fresh, unguessable state value for one sign-in attempt. */
export function createState(random: RandomBytes = defaultRandom): string {
  return base64url(random(STATE_BYTES));
}
