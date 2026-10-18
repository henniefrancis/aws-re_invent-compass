// The Identifier_Check (Requirement 11, design Component 9). Every session id, event id and
// personal-time id passes it before any S1 call. A message never echoes a value.

/** Why an identifier was rejected. */
export type IdentifierProblem = 'empty' | 'dot' | 'separator' | 'control' | 'tooLong';

/** The longest identifier accepted. */
export const MAX_IDENTIFIER_LENGTH = 256;

const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f]');

/** Checks one identifier. */
export function checkIdentifier(
  value: string,
): { ok: true } | { ok: false; reason: IdentifierProblem } {
  if (value === '') {
    return { ok: false, reason: 'empty' };
  }
  if (value === '.' || value === '..') {
    return { ok: false, reason: 'dot' };
  }
  if (value.includes('/') || value.includes('\\')) {
    return { ok: false, reason: 'separator' };
  }
  if (CONTROL.test(value)) {
    return { ok: false, reason: 'control' };
  }
  if (value.length > MAX_IDENTIFIER_LENGTH) {
    return { ok: false, reason: 'tooLong' };
  }
  return { ok: true };
}

/** The message shown when any identifier is rejected. It never contains a supplied value. */
export const IDENTIFIER_REJECTED_MESSAGE = 'One of the ids is not a valid session id.';

/** Checks every identifier. */
export function checkIdentifiers(
  values: readonly string[],
): { ok: true } | { ok: false; message: string } {
  return values.every((value) => checkIdentifier(value).ok)
    ? { ok: true }
    : { ok: false, message: IDENTIFIER_REJECTED_MESSAGE };
}
