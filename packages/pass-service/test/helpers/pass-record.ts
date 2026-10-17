import { EXPIRY_GRACE_MS, ttlOf } from '../../src/data/keys.js';
import type { PassRecord } from '../../src/data/records.js';
import { samplePassFields } from './pass-fields.js';

export function serialOf(i: number): string {
  return `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
}

/** A stored pass record built directly, for tests that need control over state and expiry. */
export function makePassRecord(
  subHash: string,
  serialNumber: string,
  overrides: Partial<PassRecord> = {},
): PassRecord {
  const fields = overrides.fields ?? samplePassFields();
  const expiresAtMs = Date.parse(fields.endsAt) + EXPIRY_GRACE_MS;
  return {
    serialNumber,
    subHash,
    pepperId: 'test-1',
    sessionCode: fields.sessionCode,
    fields,
    platforms: ['apple'],
    authTokenHash: 'x',
    tokenSalt: 'salt',
    status: 'active',
    version: 1,
    lastUpdatedMs: 0,
    googleState: 'none',
    createdAtMs: 0,
    expiresAtMs,
    ttl: ttlOf(expiresAtMs),
    ...overrides,
  };
}
