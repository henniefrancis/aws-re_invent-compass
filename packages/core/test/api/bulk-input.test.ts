import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { assertBulkInput, MIN_BULK_IDS, MAX_BULK_IDS } from '../../src/api/bulk-input.js';
import { ValidationError } from '../../src/api/errors.js';
import type { OperationName } from '../../src/api/transport.js';

// Property and unit tests for the bulk input guard (events-client, S1, Component 5).
// Covers Property 18: a bulk id list is accepted only when it holds 1 to 10 distinct
// ids, otherwise it is rejected with a ValidationError BEFORE any request is sent
// (Requirements 10.1, 10.2, 10.3).

const BULK_OPS: readonly OperationName[] = ['ReserveSessions', 'AssociateFavorites'];

// A small alphabet of distinct id atoms so fast-check can build both distinct and
// duplicate lists deterministically.
const idArb = fc.stringMatching(/^[A-Za-z0-9_-]{1,8}$/);

describe('Feature: events-client, Property 18: Bulk input is accepted only when 1 to 10 distinct ids, else rejected before send', () => {
  test('a list of 1 to 10 distinct ids is accepted', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...BULK_OPS),
        fc
          .uniqueArray(idArb, { minLength: MIN_BULK_IDS, maxLength: MAX_BULK_IDS })
          .filter((ids) => ids.length >= MIN_BULK_IDS),
        (op, ids) => {
          expect(() => {
            assertBulkInput(op, ids);
          }).not.toThrow();
        },
      ),
      { numRuns: 200 },
    );
  });

  test('an empty list or a list longer than 10 is rejected with ValidationError', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...BULK_OPS),
        fc.oneof(
          fc.constant<string[]>([]),
          fc.uniqueArray(idArb, { minLength: MAX_BULK_IDS + 1, maxLength: MAX_BULK_IDS + 6 }),
        ),
        (op, ids) => {
          expect(() => {
            assertBulkInput(op, ids);
          }).toThrow(ValidationError);
        },
      ),
      { numRuns: 200 },
    );
  });

  test('a list with a duplicate id is rejected with ValidationError', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...BULK_OPS),
        fc
          .uniqueArray(idArb, { minLength: 1, maxLength: MAX_BULK_IDS - 1 })
          .map((ids) => [...ids, ids[0]]),
        (op, ids) => {
          expect(() => {
            assertBulkInput(op, ids);
          }).toThrow(ValidationError);
        },
      ),
      { numRuns: 200 },
    );
  });

  test('the rejection names the operation and never echoes an id', () => {
    const secretId = 'session-secret-value';
    let caught: unknown;
    try {
      assertBulkInput('ReserveSessions', [secretId, secretId]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    const message = (caught as ValidationError).message;
    expect(message).toContain('ReserveSessions');
    expect(message).not.toContain(secretId);
  });

  test('the boundary sizes 1 and 10 are accepted and 0 and 11 are rejected', () => {
    const ten = Array.from({ length: MAX_BULK_IDS }, (_v, i) => `id-${String(i)}`);
    const eleven = Array.from({ length: MAX_BULK_IDS + 1 }, (_v, i) => `id-${String(i)}`);
    expect(() => {
      assertBulkInput('AssociateFavorites', ['only-one']);
    }).not.toThrow();
    expect(() => {
      assertBulkInput('AssociateFavorites', ten);
    }).not.toThrow();
    expect(() => {
      assertBulkInput('AssociateFavorites', []);
    }).toThrow(ValidationError);
    expect(() => {
      assertBulkInput('AssociateFavorites', eleven);
    }).toThrow(ValidationError);
  });
});
