import { describe, expect, test } from 'vitest';
import type { SessionWire } from '../src/wire/session.js';
import type { components } from '../src/generated/events-api.js';

// Type-level compatibility test for the wire Session schema (foundation-contracts, S0).
//
// Validates: Requirements 4.4.
//
// This is NOT one of the thirteen numbered property tests, so it carries no Property N tag.
//
// The real value of this file is that it must COMPILE under tsc. The type aliases below
// are constrained so that a mismatch between SessionWire and the generated Session type
// fails type-checking. vitest runs the file with a type-stripping transformer, so the
// trivial runtime assertion only proves the file is wired into the suite; the committed
// gate's tsc step is what enforces the type-level assertions.
//
// Two things are asserted:
//   1. Field-name set equality. The set of property names on SessionWire equals the set of
//      property names on the generated Session type. keyof gives the union of property names
//      regardless of optionality, which is exactly the "set of field names" comparison wanted.
//   2. Non-enum field type assignability. For every field that is not a forward-compatible
//      wider enum, the wire field type is assignable to the generated field type and back.
//      The only excluded field is seatAvailability: the wire type adds the sentinel "unknown",
//      so it is intentionally WIDER than the generated enum union and full assignability must
//      not be asserted on it.

/** The generated Events API Session type, from the committed OpenAPI document. */
type GeneratedSession = components['schemas']['Session'];

/**
 * The single forward-compatible enum field. The wire seatAvailability includes the sentinel
 * "unknown", which the generated SeatAvailability union does not, so this field is excluded
 * from the assignability check. No ordinary field is excluded.
 */
type EnumFields = 'seatAvailability';

/** Compile-time boolean equality for two types. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** Compile-time assertion: fails to compile unless T is exactly true. */
type AssertTrue<T extends true> = T;

// 1. FIELD-NAME SET EQUALITY.
// keyof SessionWire and keyof GeneratedSession must be the same union of property names.
// If the wire schema adds, drops or renames a field, this alias stops compiling.
type _KeysMatch = AssertTrue<Equal<keyof SessionWire, keyof GeneratedSession>>;

// 2. NON-ENUM FIELD TYPE ASSIGNABILITY.
// Omit the forward-compatible enum field from both sides, then assert mutual assignability.
// Wire to generated proves a parsed wire Session is a valid instance of the generated shape
// on every non-enum field; generated to wire proves the wire schema did not model any
// non-enum field more narrowly than the generated type.
type NonEnumWire = Omit<SessionWire, EnumFields>;
type NonEnumGenerated = Omit<GeneratedSession, EnumFields>;

type _NonEnumWireAssignableToGenerated = AssertTrue<
  NonEnumWire extends NonEnumGenerated ? true : false
>;
type _NonEnumGeneratedAssignableToWire = AssertTrue<
  NonEnumGenerated extends NonEnumWire ? true : false
>;

// Reference the type aliases so verbatimModuleSyntax and noUnusedLocals style checks see them
// as used. These are type-only values; they carry no runtime cost.
type _Used = [_KeysMatch, _NonEnumWireAssignableToGenerated, _NonEnumGeneratedAssignableToWire];

describe('Feature: foundation-contracts, wire Session matches the generated Events API Session type', () => {
  test('compiles: field-name set equality and non-enum field assignability', () => {
    // The type-level assertions above are the real test; they are enforced by tsc.
    // This trivial runtime assertion wires the file into the vitest suite.
    const used: _Used = [true, true, true];
    expect(used).toEqual([true, true, true]);
  });
});
