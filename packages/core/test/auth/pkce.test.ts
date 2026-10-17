import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { computeChallenge, createPkcePair, createState } from '../../src/auth/pkce.js';

// Tests for PKCE and state generation (events-client, S1, tasks 9.1 and 9.2).

/** An independent S256 computation: standard base64 rewritten to base64url by hand. */
function referenceChallenge(verifier: string): string {
  return createHash('sha256')
    .update(verifier, 'ascii')
    .digest('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

describe('events-client, task 9.1: PKCE and state', () => {
  test('the RFC 7636 appendix B vector produces the published challenge', () => {
    expect(computeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  test('createPkcePair builds the verifier from the injected random bytes', () => {
    const pair = createPkcePair((size) => new Uint8Array(size).fill(7));
    expect(pair.verifier).toBe(Buffer.alloc(32, 7).toString('base64url'));
    expect(pair.verifier).toHaveLength(43);
    expect(pair.challenge).toBe(referenceChallenge(pair.verifier));
  });

  test('createState builds the value from the injected random bytes', () => {
    expect(createState((size) => new Uint8Array(size).fill(1))).toBe(
      Buffer.alloc(16, 1).toString('base64url'),
    );
  });

  test('the default randomness gives a fresh verifier and state every attempt', () => {
    const a = createPkcePair();
    const b = createPkcePair();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const s1 = createState();
    const s2 = createState();
    expect(s1).not.toBe(s2);
    expect(s1).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

describe('Feature: events-client, Property 1: PKCE S256 challenge is correct base64url without padding', () => {
  // Validates: Requirements 1.8
  test('for any verifier the challenge is base64url(SHA-256) with no padding or unsafe characters', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Za-z0-9._~-]{43,128}$/), (verifier) => {
        const challenge = computeChallenge(verifier);
        expect(challenge).toBe(referenceChallenge(verifier));
        expect(challenge).toHaveLength(43);
        expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(challenge).not.toContain('=');
      }),
      { numRuns: 100 },
    );
  });

  test('for any random bytes the pair is self-consistent', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 32, maxLength: 32 }), (bytes) => {
        const pair = createPkcePair(() => bytes);
        expect(pair.challenge).toBe(referenceChallenge(pair.verifier));
      }),
      { numRuns: 100 },
    );
  });
});
