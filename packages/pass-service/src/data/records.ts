// The stored record types (design, Data Models, with the security review fields).
import type { PassFields } from '@compass/contracts';

export type GoogleState = 'none' | 'active' | 'inactive' | 'pending_inactive';
export type Platform = 'apple' | 'google';

/** Personal data record P10. */
export interface PassRecord {
  serialNumber: string;
  subHash: string;
  pepperId: string;
  sessionCode: string;
  fields: PassFields; // minimal printable fields; attendeeName only if sent
  platforms: Platform[];
  authTokenHash: string; // SHA-256 hex of the derived Auth_Token; the token itself is never stored
  tokenSalt: string; // random per pass, base64url
  status: 'active' | 'voided';
  version: number; // starts at 1
  lastUpdatedMs: number; // whole seconds, strictly increasing: Last-Modified and If-Modified-Since
  updateTagMs: number; // milliseconds, strictly increasing per pass: the passesUpdatedSince tag
  voidedAt?: string; // ISO 8601
  googleState: GoogleState;
  createdAtMs: number;
  expiresAtMs: number; // Date.parse(fields.endsAt) + 24 hours
  ttl: number; // ceil(expiresAtMs / 1000)
}

/** Personal data record P11. */
export interface DeviceRegistration {
  deviceHash: string;
  serialNumber: string;
  passTypeIdentifier: string;
  pushToken: string; // raw: needed to push
  subHash: string; // copied from the pass so forget_me finds it through GSI2
  pepperId: string;
  expiresAtMs: number; // same as the pass
  ttl: number;
}

/** Personal data record P12. */
export interface HandoffRecord {
  handoffHash: string;
  subHash: string;
  pepperId: string;
  serialNumbers: string[];
  include: { apple: boolean; google: boolean; calendar: boolean };
  expiresAtMs: number; // created + 15 minutes
  ttl: number;
}
