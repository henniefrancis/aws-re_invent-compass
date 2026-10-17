import { describe, expect, test } from 'vitest';
import { createPassFieldsSchema, type PassFields } from '@compass/contracts';
import { fieldsHash } from '../../src/passes/field-hash.js';

// Unit tests for the field hash (boarding-passes, S4).
//
// The field hash is the single source of truth for the sync "changed" case: equal
// canonical content hashes equal, and differing content hashes differently. These
// tests drive the canonical serialiser over nested objects, an array-free and an
// array-bearing field, and an absent optional field, and prove determinism and key
// order independence.

// A fixed event window so the PassFields schema accepts the sample instants.
const WINDOW = {
  start: '2026-11-30T00:00:00-08:00',
  end: '2026-12-04T23:59:59-08:00',
  timezone: 'America/Los_Angeles',
};
const schema = createPassFieldsSchema(WINDOW);

// Parse a candidate so every hashed value is a genuinely valid PassFields.
function validFields(candidate: unknown): PassFields {
  return schema.parse(candidate);
}

// A base pass with a previous walk and a next connection, so the nested objects and the
// optional attendeeName are all exercised by the serialiser.
const baseCandidate = {
  sessionCode: 'DVT301',
  title: 'Build on AWS with the boarding pass pattern',
  venue: 'Venetian',
  room: 'Level 2, Lido 3001',
  startsAt: '2026-12-01T10:30:00-08:00',
  endsAt: '2026-12-01T11:30:00-08:00',
  walkFromPrevious: { minutes: 12, fromVenue: 'Wynn' },
  nextConnection: {
    sessionCode: 'NET204-R',
    startsAt: '2026-12-01T12:00:00-08:00',
    venue: 'Caesars Forum',
    walkMinutes: 9,
  },
  attendeeName: 'First Timer',
};

describe('Feature: boarding-passes, fieldsHash is deterministic', () => {
  test('equal content hashes equal, including nested objects', () => {
    const a = validFields(baseCandidate);
    const b = validFields(baseCandidate);
    expect(fieldsHash(a)).toBe(fieldsHash(b));
  });

  test('a SHA-256 hex digest is returned', () => {
    const hash = fieldsHash(validFields(baseCandidate));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('hashing is independent of object key insertion order', () => {
    const forward = validFields(baseCandidate);
    // Build the same content with the object keys inserted in a different order; the
    // canonical serialiser sorts keys, so the hash must be identical.
    const reordered = validFields({
      attendeeName: 'First Timer',
      nextConnection: {
        walkMinutes: 9,
        venue: 'Caesars Forum',
        startsAt: '2026-12-01T12:00:00-08:00',
        sessionCode: 'NET204-R',
      },
      room: 'Level 2, Lido 3001',
      endsAt: '2026-12-01T11:30:00-08:00',
      startsAt: '2026-12-01T10:30:00-08:00',
      venue: 'Venetian',
      title: 'Build on AWS with the boarding pass pattern',
      sessionCode: 'DVT301',
      walkFromPrevious: { fromVenue: 'Wynn', minutes: 12 },
    });
    expect(fieldsHash(reordered)).toBe(fieldsHash(forward));
  });
});

describe('Feature: boarding-passes, fieldsHash separates differing content', () => {
  test('a different title hashes differently', () => {
    const a = validFields(baseCandidate);
    const b = validFields({ ...baseCandidate, title: 'A different session title' });
    expect(fieldsHash(a)).not.toBe(fieldsHash(b));
  });

  test('an absent optional field hashes differently from a present one', () => {
    const withName = validFields(baseCandidate);
    const minimal = validFields({
      sessionCode: baseCandidate.sessionCode,
      title: baseCandidate.title,
      venue: baseCandidate.venue,
      room: baseCandidate.room,
      startsAt: baseCandidate.startsAt,
      endsAt: baseCandidate.endsAt,
    });
    expect(fieldsHash(minimal)).not.toBe(fieldsHash(withName));
  });

  test('a minimal pass with no optional fields still hashes to a stable digest', () => {
    const minimalCandidate = {
      sessionCode: 'OPS101',
      title: 'Keynote overflow room',
      venue: '',
      room: '',
      startsAt: '2026-12-02T09:00:00-08:00',
      endsAt: '2026-12-02T10:00:00-08:00',
    };
    const a = validFields(minimalCandidate);
    const b = validFields(minimalCandidate);
    expect(fieldsHash(a)).toBe(fieldsHash(b));
    expect(fieldsHash(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('Feature: boarding-passes, fieldsHash treats undefined members as absent', () => {
  test('a member set to undefined hashes like an absent member', () => {
    const minimal = validFields({
      sessionCode: 'OPS101',
      title: 'Keynote overflow room',
      venue: '',
      room: '',
      startsAt: '2026-12-02T09:00:00-08:00',
      endsAt: '2026-12-02T10:00:00-08:00',
    });
    const withUndefined: PassFields = { ...minimal, attendeeName: undefined };
    expect(fieldsHash(withUndefined)).toBe(fieldsHash(minimal));
  });
});
