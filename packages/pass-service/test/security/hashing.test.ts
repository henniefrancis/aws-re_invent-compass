import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { deriveAuthToken, newTokenSalt } from '../../src/security/auth-token.js';
import {
  constantTimeEqualHex,
  deriveKey,
  deviceHash,
  sha256Hex,
  subHash,
} from '../../src/security/hashing.js';
import {
  HANDOFF_ID_PATTERN,
  UUID_V4_PATTERN,
  newHandoffId,
} from '../../src/security/handoff-id.js';
import { createSeededRandom } from '../helpers/seeded-random.js';

const textArb = fc.string({ maxLength: 60 });
const pepperArb = fc.string({ minLength: 16, maxLength: 64 });

describe('Feature: pass-service, hashing and capability helpers', () => {
  test('subHash and deviceHash are 64 hex characters, deterministic and pepper-sensitive', () => {
    fc.assert(
      fc.property(pepperArb, pepperArb, textArb, (p1, p2, value) => {
        for (const fn of [subHash, deviceHash]) {
          const h = fn(p1, value);
          expect(h).toMatch(/^[0-9a-f]{64}$/);
          expect(fn(p1, value)).toBe(h);
          if (p1 !== p2) {
            expect(fn(p2, value)).not.toBe(h);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  test('the same input under different purposes gives different hashes', () => {
    fc.assert(
      fc.property(pepperArb, textArb, (pepper, value) => {
        expect(subHash(pepper, value)).not.toBe(deviceHash(pepper, value));
        expect(subHash(pepper, value)).not.toBe(sha256Hex(value));
      }),
      { numRuns: 100 },
    );
  });

  test('sha256Hex matches a known vector', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  test('sub-keys are 32 bytes and differ by info string', () => {
    const a = deriveKey('pepper-pepper-pepper', 'compass/sub/v1');
    expect(a).toHaveLength(32);
    expect(a.equals(deriveKey('pepper-pepper-pepper', 'compass/device/v1'))).toBe(false);
  });

  test('constant-time comparison handles equal, unequal and different-length strings', () => {
    expect(constantTimeEqualHex('abcd', 'abcd')).toBe(true);
    expect(constantTimeEqualHex('abcd', 'abce')).toBe(false);
    expect(constantTimeEqualHex('abcd', 'abc')).toBe(false);
    expect(constantTimeEqualHex('', '')).toBe(true);
    fc.assert(
      fc.property(textArb, textArb, (a, b) => {
        expect(constantTimeEqualHex(a, b)).toBe(a === b);
      }),
      { numRuns: 100 },
    );
  });

  test('the Auth_Token is 43 base64url characters, deterministic, and sensitive to every input', () => {
    fc.assert(
      fc.property(pepperArb, pepperArb, textArb, textArb, textArb, (p1, p2, serial, s2, salt) => {
        const token = deriveAuthToken(p1, serial, salt);
        expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(deriveAuthToken(p1, serial, salt)).toBe(token);
        if (p1 !== p2) {
          expect(deriveAuthToken(p2, serial, salt)).not.toBe(token);
        }
        if (serial !== s2) {
          expect(deriveAuthToken(p1, s2, salt)).not.toBe(token);
        }
        expect(deriveAuthToken(p1, serial, `${salt}x`)).not.toBe(token);
      }),
      { numRuns: 100 },
    );
  });

  test('token salts and hand-off ids come from the injected random', () => {
    const random = createSeededRandom('seed-1');
    const salt = newTokenSalt(random);
    const id = newHandoffId(random);
    expect(salt).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(id).toMatch(HANDOFF_ID_PATTERN);
    expect(id).not.toBe(salt);
    expect(newHandoffId(createSeededRandom('seed-1'))).toBe(
      newHandoffId(createSeededRandom('seed-1')),
    );
  });

  test('the id patterns accept exactly the documented forms', () => {
    expect(HANDOFF_ID_PATTERN.test('A'.repeat(22))).toBe(true);
    expect(HANDOFF_ID_PATTERN.test('A'.repeat(21))).toBe(false);
    expect(HANDOFF_ID_PATTERN.test(`${'A'.repeat(21)}=`)).toBe(false);
    const random = createSeededRandom('uuid');
    for (let i = 0; i < 50; i += 1) {
      expect(UUID_V4_PATTERN.test(random.uuid())).toBe(true);
    }
    expect(UUID_V4_PATTERN.test('11111111-1111-1111-1111-111111111111')).toBe(false);
    expect(UUID_V4_PATTERN.test('AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA')).toBe(false);
  });
});
