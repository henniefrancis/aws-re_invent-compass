import { describe, expect, test } from 'vitest';
import * as fc from 'fast-check';
import { jsonType, diffShape, formatDiffReport } from '../src/shape-diff.ts';

// Property test for shape-diff redaction (foundation-contracts, S0).
//
// Property 12: Shape-diff redaction never leaks a recorded value.
// Validates: Requirements 10.1, 10.2, 10.3, 10.6.
//
// For any pair of reference and recording objects, the rendered diff contains only
// field names, the words describing presence, and JSON type descriptors. It never
// contains a recorded scalar value. The property injects distinctive string and
// number values into the recording and asserts none appears in the report.

const NUM_RUNS = 300;

// A distinctive scalar value that would be easy to spot if leaked.
const leakString = fc
  .string({ minLength: 6, maxLength: 16 })
  .map((s) => `LEAK_${s.replace(/\s/g, '_')}`);
const leakNumber = fc.integer({ min: 100000, max: 999999 });

// A recording object whose values are all distinctive leak markers, keyed by safe
// field names.
const recordingArb = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 8 }).filter((s) => /^[a-z]+$/.test(s)),
  fc.oneof(
    leakString,
    leakNumber.map((n) => n),
  ),
  { minKeys: 1, maxKeys: 6 },
);

describe('Feature: foundation-contracts, Property 12: Shape-diff redaction never leaks a recorded value', () => {
  test('Feature: foundation-contracts, Property 12: no recorded value appears in the diff report', () => {
    fc.assert(
      fc.property(recordingArb, (recording) => {
        // Reference: an object with the same keys but different (also non-leaking)
        // types, so some fields type-mismatch and some match. We build a reference
        // whose values are plain and generic (never the leak markers).
        const reference: Record<string, unknown> = {};
        for (const key of Object.keys(recording)) {
          reference[key] = 'reference-value';
        }
        // Add a reference-only field and rely on the recording having fields too.
        reference.referenceOnly = 'x';

        const diffs = diffShape(reference, recording);
        const report = formatDiffReport(diffs).join('\n');

        // No recorded value (string or number) appears anywhere in the report.
        for (const value of Object.values(recording)) {
          expect(
            report.includes(String(value)),
            `report leaked a recorded value: ${String(value)}`,
          ).toBe(false);
        }
        // The generic reference value is also never printed (only type names are).
        expect(report.includes('reference-value')).toBe(false);
        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test('Feature: foundation-contracts, Property 12: jsonType reports type names only', () => {
    expect(jsonType('x')).toBe('string');
    expect(jsonType(1)).toBe('number');
    expect(jsonType(true)).toBe('boolean');
    expect(jsonType(null)).toBe('null');
    expect(jsonType([1, 2])).toBe('array');
    expect(jsonType({ a: 1 })).toBe('object');
    expect(jsonType(undefined)).toBe('absent');
  });

  test('Feature: foundation-contracts, Property 12: presence and type differences are reported by name', () => {
    const reference = {
      sessionId: 'ref',
      title: 'ref',
      nested: { a: 1, onlyRef: 2 },
      items: [{ k: 'ref' }],
    };
    const recording = {
      sessionId: 'LEAK_id',
      title: 123, // type mismatch: string vs number
      nested: { a: 9, onlyRec: 3 },
      items: [{ k: 'LEAK_k' }],
      extra: 'LEAK_extra',
    };

    const diffs = diffShape(reference, recording);
    const byPath = new Map(diffs.map((d) => [d.path, d]));

    // title type mismatch is reported.
    expect(byPath.get('title')?.kind).toBe('type-mismatch');
    expect(byPath.get('title')?.expectedType).toBe('string');
    expect(byPath.get('title')?.actualType).toBe('number');

    // nested.onlyRef only in reference; nested.onlyRec only in recording.
    expect(byPath.get('nested.onlyRef')?.kind).toBe('only-in-expected');
    expect(byPath.get('nested.onlyRec')?.kind).toBe('only-in-actual');

    // top-level extra only in recording.
    expect(byPath.get('extra')?.kind).toBe('only-in-actual');

    // The report never leaks the recorded scalar values.
    const report = formatDiffReport(diffs).join('\n');
    for (const leak of ['LEAK_id', 'LEAK_k', 'LEAK_extra']) {
      expect(report.includes(leak)).toBe(false);
    }
  });

  test('Feature: foundation-contracts, Property 12: object vs non-object at a node is a type mismatch, not a descent', () => {
    // expected.a is an object; actual.a is an array. keysOf is exercised for an
    // object (expected side) and for an array and null (actual side, which return
    // an empty key set). The node is reported as a type mismatch.
    const asArray = diffShape({ a: { x: 1 } }, { a: [1, 2] });
    expect(asArray).toEqual([
      { path: 'a', kind: 'type-mismatch', expectedType: 'object', actualType: 'array' },
    ]);

    const asNull = diffShape({ a: { x: 1 } }, { a: null });
    expect(asNull).toEqual([
      { path: 'a', kind: 'type-mismatch', expectedType: 'object', actualType: 'null' },
    ]);

    // Top-level: an object reference against a null recording. The object keys come
    // only from the reference side; every key is only-in-expected.
    const topNull = diffShape({ a: 1, b: 2 }, null);
    expect(topNull.map((d) => d.path).sort()).toEqual(['a', 'b']);
    expect(topNull.every((d) => d.kind === 'only-in-expected')).toBe(true);

    // Reverse: an absent reference against an object recording. The object block is
    // reached through its second operand (actual is the object), and every key is
    // only-in-actual.
    const expectedAbsent = diffShape(undefined, { a: 1, b: 2 });
    expect(expectedAbsent.map((d) => d.path).sort()).toEqual(['a', 'b']);
    expect(expectedAbsent.every((d) => d.kind === 'only-in-actual')).toBe(true);
  });

  test('Feature: foundation-contracts, Property 12: identical shapes produce no differences', () => {
    const shape = { a: 'x', b: { c: 1 }, d: [true] };
    const other = { a: 'y', b: { c: 2 }, d: [false] };
    // Same shape, different values: no differences, because only shape is compared.
    expect(diffShape(shape, other)).toEqual([]);
    expect(formatDiffReport([])).toEqual(['No shape differences found.']);
  });

  test('Feature: foundation-contracts, Property 12: arrays are compared by first element shape only', () => {
    // Different array lengths and contents, same element shape: no diff. An empty
    // array on either side yields no element comparison.
    expect(diffShape({ xs: [{ a: 1 }, { a: 2 }] }, { xs: [{ a: 9 }] })).toEqual([]);
    expect(diffShape({ xs: [] }, { xs: [{ a: 1 }] })).toEqual([]);
    expect(diffShape([{ a: 1 }], [{ a: 2 }])).toEqual([]);
  });
});
