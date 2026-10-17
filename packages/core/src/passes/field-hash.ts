// Field hash for the pass side (boarding-passes, S4).
//
// The field hash is the single source of truth for the Pass_Sync "changed" diff case:
// two PassFields hash equal exactly when their canonical serialisations are equal. The
// input is pass content only (never the ID token or the attendee email), so the
// issued-pass record stays free of credentials. The hash is a SHA-256 hex digest from
// node:crypto over the canonical JSON (object keys sorted at every level, no
// whitespace), so it is deterministic and portable with no extra dependency.
import { createHash } from 'node:crypto';
import type { PassFields } from '@compass/contracts';

/**
 * The value shapes a PassFields can hold: strings, numbers and nested objects of the
 * same, with optional members that may be undefined. PassFields has no arrays, no
 * booleans and no null, so the canonical serialiser handles exactly these shapes.
 */
type CanonicalValue = string | number | { [key: string]: CanonicalValue | undefined };

/**
 * Serialise a value canonically: object keys are sorted lexicographically at every
 * level and there is no insignificant whitespace. Two values with the same content
 * always serialise to the same string regardless of the key order they were built in.
 * undefined-valued object members are omitted, matching JSON.stringify, so an absent
 * optional field and a field set to undefined hash alike.
 */
function canonicalise(value: CanonicalValue): string {
  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }
  const members: string[] = [];
  for (const key of Object.keys(value).sort()) {
    const member = value[key];
    if (member !== undefined) {
      members.push(`${JSON.stringify(key)}:${canonicalise(member)}`);
    }
  }
  return `{${members.join(',')}}`;
}

/**
 * Compute the deterministic SHA-256 hex digest of a validated PassFields value over
 * its canonical JSON. The digest changes when and only when the canonical content
 * changes, which is exactly what the sync diff needs to classify a pass as changed.
 */
export function fieldsHash(fields: PassFields): string {
  const canonical = canonicalise(fields);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
