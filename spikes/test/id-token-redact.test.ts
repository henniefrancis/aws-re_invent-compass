import { describe, expect, test } from 'vitest';
import * as fc from 'fast-check';
import {
  SAFE_VALUE_FIELDS,
  isSafeValueField,
  redactDecodedToken,
  decodeJwtParts,
  formatRedactedReport,
} from '../src/id-token-redact.ts';

// Property test for ID token redaction (foundation-contracts, S0).
//
// Property 11: ID token redaction never leaks a claim value.
// Validates: Requirements 9.1, 9.2, 9.5, 9.7.
//
// For any decoded token, the redacted report shows a value only for the six
// allowlisted metadata fields (alg, kid, iss, aud, token_use, exp). Every other
// claim (sub, email, name, custom claims) appears by NAME only; its value never
// appears anywhere in the report. The property injects random sensitive claim
// values and asserts none of them is present in the rendered output.

const NUM_RUNS = 300;

const SAFE_SET = new Set<string>(SAFE_VALUE_FIELDS);

// A sensitive claim name that is NOT on the safe allowlist.
const sensitiveName = fc
  .string({ minLength: 1, maxLength: 12 })
  .filter((s) => /^[a-zA-Z][a-zA-Z0-9_:]*$/.test(s) && !SAFE_SET.has(s));

// A sensitive claim value that is distinctive enough to search for in the output.
const sensitiveValue = fc
  .string({ minLength: 6, maxLength: 20 })
  .map((s) => `SECRET_${s.replace(/\s/g, '_')}`);

describe('Feature: foundation-contracts, Property 11: ID token redaction never leaks a claim value', () => {
  test('Feature: foundation-contracts, Property 11: non-allowlisted claim values never appear in the report', () => {
    fc.assert(
      fc.property(
        fc.dictionary(sensitiveName, sensitiveValue, { minKeys: 1, maxKeys: 8 }),
        fc.record({
          iss: fc.webUrl(),
          aud: fc.string({ minLength: 1, maxLength: 10 }),
          token_use: fc.constant('id'),
          exp: fc.integer({ min: 1, max: 2_000_000_000 }),
        }),
        (sensitiveClaims, safeClaims) => {
          // The payload mixes safe fields with sensitive claims.
          const payload: Record<string, unknown> = { ...safeClaims, ...sensitiveClaims };
          const header = { alg: 'RS256', kid: 'key-1', typ: 'JWT' };

          const redacted = redactDecodedToken(header, payload);
          const report = formatRedactedReport(redacted).join('\n');

          // Every sensitive claim appears by NAME, and its VALUE never appears.
          for (const [name, value] of Object.entries(sensitiveClaims)) {
            expect(redacted.claimNames).toContain(name);
            expect(redacted.safeValues[name]).toBeUndefined();
            expect(
              report.includes(value),
              `report leaked the value of claim "${name}"`,
            ).toBe(false);
          }

          // Only allowlisted fields have a shown value.
          for (const shownName of Object.keys(redacted.safeValues)) {
            expect(isSafeValueField(shownName)).toBe(true);
          }

          // The header's non-safe field (typ) is reported by name, never as a value.
          expect(redacted.claimNames).toContain('typ');
          return true;
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  test('Feature: foundation-contracts, Property 11: allowlisted values are shown', () => {
    const redacted = redactDecodedToken(
      { alg: 'RS256', kid: 'abc' },
      { iss: 'https://issuer.example', aud: 'client', token_use: 'id', exp: 123 },
    );
    expect(redacted.safeValues).toEqual({
      alg: 'RS256',
      kid: 'abc',
      iss: 'https://issuer.example',
      aud: 'client',
      token_use: 'id',
      exp: '123',
    });
    expect(redacted.claimNames).toEqual([]);
  });

  test('Feature: foundation-contracts, Property 11: a non-string, non-number safe field shows only its type', () => {
    // An unexpected structured value on a safe field is shown as its type, not its
    // content, so even an allowlisted field never leaks structured data.
    const redacted = redactDecodedToken(
      {},
      { aud: ['a', 'b'], token_use: null, exp: 100, iss: 'x' },
    );
    expect(redacted.safeValues.aud).toBe('<object>');
    expect(redacted.safeValues.token_use).toBe('<null>');
  });

  test('Feature: foundation-contracts, Property 11: decodeJwtParts tolerates malformed input', () => {
    // A malformed token yields empty objects rather than throwing, and the redactor
    // then reports no claims.
    expect(decodeJwtParts('not-a-jwt')).toEqual({ header: {}, payload: {} });
    expect(decodeJwtParts('a.b')).toEqual({ header: {}, payload: {} });
    // Too many parts (three dots) is rejected.
    expect(decodeJwtParts('a.b.c.d')).toEqual({ header: {}, payload: {} });
    const { header, payload } = decodeJwtParts('%%%.%%%.%%%');
    expect(header).toEqual({});
    expect(payload).toEqual({});

    // A well-formed token decodes to its parts.
    const encode = (o: unknown): string =>
      Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');
    const jwt = `${encode({ alg: 'RS256', kid: 'k' })}.${encode({ sub: 'u1', iss: 'x' })}.sig`;
    const decoded = decodeJwtParts(jwt);
    expect(decoded.header).toEqual({ alg: 'RS256', kid: 'k' });
    expect(decoded.payload).toEqual({ sub: 'u1', iss: 'x' });

    // An array payload part is treated as empty (not an object).
    const arrayPayload = `${encode({ alg: 'RS256' })}.${encode([1, 2, 3])}.sig`;
    expect(decodeJwtParts(arrayPayload).payload).toEqual({});
  });

  test('Feature: foundation-contracts, Property 11: the report lists no other claims as (none)', () => {
    const redacted = redactDecodedToken({ alg: 'RS256' }, { iss: 'x' });
    const report = formatRedactedReport(redacted);
    expect(report).toContain('  (none)');
  });
});
