import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { classifyFailure, KNOWN_BULK_FAILURE_CODES } from '../../src/api/bulk-failure-codes.js';
import type { BulkFailure } from '@compass/contracts';

// Property and unit tests for failure classification (events-client, S1, Component 5).
// Covers Property 20: a per-session failure whose code is not one of the known codes
// is classified as an unrecognised refusal, never as a success or a safe retry
// (Requirement 10.6).

const knownArb = fc.constantFrom(...KNOWN_BULK_FAILURE_CODES);

// Any string that is not one of the known codes, used to build an unrecognised code.
const unknownArb = fc
  .string({ minLength: 1, maxLength: 24 })
  .filter((s) => !(KNOWN_BULK_FAILURE_CODES as readonly string[]).includes(s));

describe('Feature: events-client, Property 20: Unrecognised failure codes are refusals, never successes', () => {
  test('every known code classifies as known', () => {
    fc.assert(
      fc.property(knownArb, fc.string({ minLength: 1, maxLength: 12 }), (code, sessionId) => {
        const failure: BulkFailure = { sessionId, code };
        expect(classifyFailure(failure)).toBe('known');
      }),
      { numRuns: 200 },
    );
  });

  test('any code outside the known list classifies as an unrecognised refusal', () => {
    fc.assert(
      fc.property(unknownArb, fc.string({ minLength: 1, maxLength: 12 }), (code, sessionId) => {
        const failure: BulkFailure = { sessionId, code };
        expect(classifyFailure(failure)).toBe('unrecognised-refusal');
      }),
      { numRuns: 200 },
    );
  });

  test('an unrecognised code is never classified as a success or safe retry', () => {
    const failure: BulkFailure = { sessionId: 'abc', code: 'brandNewServerCode' };
    const classification = classifyFailure(failure);
    expect(classification).toBe('unrecognised-refusal');
    // The only two classifications are known and unrecognised-refusal; neither is a
    // success or a retry signal, so an unknown code can never be treated as success.
    expect(['known', 'unrecognised-refusal']).toContain(classification);
  });

  test('the known list holds the nine documented codes', () => {
    expect([...KNOWN_BULK_FAILURE_CODES].sort()).toEqual(
      [
        'alreadyFavorited',
        'alreadyScheduled',
        'insufficientAccess',
        'notFavorited',
        'other',
        'scheduleConflict',
        'sessionFull',
        'sessionNotReservable',
        'timePassed',
      ].sort(),
    );
  });
});
