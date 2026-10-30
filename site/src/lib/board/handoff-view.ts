// Hand-off view validator (showcase-site, Component 12).
//
// The board page accepts a response only when it matches the HandoffView schema of
// contracts/compass-api.openapi.yaml exactly, and refuses the whole body otherwise. The check
// is hand written, so zod stays out of the browser bundle. Strings are never interpreted as
// HTML: Angular text binding renders titles.
//
// A compile-time assertion (CONTRACT_MATCH) fails the build when the wire shape below and the
// generated contract type stop being assignable in both directions.

import type { CompassApi } from '@compass/contracts';
import { parseIsoWithOffset } from '../time/iso';
import type { HandoffId } from './fragment';

type HandoffViewWire = CompassApi.components['schemas']['HandoffView'];

/** The wire shape this validator accepts, written out. */
interface AcceptedWire {
  expiresAt: string;
  sessions: {
    serialNumber: string;
    sessionCode: string;
    title: string;
    startsAt: string;
    applePath: string | null;
    googleSaveUrl: string | null;
    calendarPath: string | null;
  }[];
  apple: { bundlePaths: string[] };
  google: { saveUrl: string } | null;
  calendarPath: string | null;
}

type ContractCheck = [AcceptedWire] extends [HandoffViewWire]
  ? [HandoffViewWire] extends [AcceptedWire]
    ? true
    : never
  : never;

/** True at compile time only when the accepted shape and the contract type match. */
export const CONTRACT_MATCH: ContractCheck = true;

export interface BoardSession {
  readonly serialNumber: string;
  readonly sessionCode: string;
  readonly title: string;
  readonly startsAt: string;
  /** This session's own .pkpass route, or null when the hand-off has none for it. */
  readonly applePath: string | null;
  /** A Save to Google Wallet link for this session alone, or null. */
  readonly googleSaveUrl: string | null;
  /** This session's own calendar route, or null. */
  readonly calendarPath: string | null;
}

export interface AppleBundle {
  readonly path: string;
  /** 1 for the first bundle. */
  readonly number: number;
  /** How many Apple bundles the hand-off holds. */
  readonly of: number;
}

export interface ValidatedHandoff {
  readonly expiresAt: string;
  readonly expiresAtMs: number;
  readonly sessions: readonly BoardSession[];
  readonly appleBundles: readonly AppleBundle[];
  /** One link for every pass, or null when the service gave none (they did not fit in one). */
  readonly googleSaveUrl: string | null;
  readonly calendarPath: string | null;
}

export const MAX_SESSIONS = 80;
/** Apple's limit of passes in one bundle. */
export const PASSES_PER_BUNDLE = 10;
export const GOOGLE_SAVE_PREFIX = 'https://pay.google.com/gp/v/save/';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A JWT: three base64url segments, the first starting eyJ (a JSON header). */
const GOOGLE_TOKEN = /^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
export const MAX_GOOGLE_TOKEN = 4096;
export const MAX_TITLE_LENGTH = 80;
export const MAX_CODE_LENGTH = 20;

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when the object has exactly these keys: all present, none unknown. */
function hasExactKeys(value: PlainObject, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

/** The route of one session's own file; the path is exactly this hand-off's and this serial's. */
function sessionRoute(
  value: unknown,
  id: HandoffId,
  serialNumber: string,
  kind: 'apple' | 'calendar',
): Optional<string> {
  if (value === null) {
    return { ok: true, value: null };
  }
  const expected =
    kind === 'apple'
      ? `/api/v1/handoffs/${id}/apple/pass/${serialNumber}`
      : `/api/v1/handoffs/${id}/calendar/${serialNumber}.ics`;
  return value === expected ? { ok: true, value: expected } : { ok: false };
}

function readSession(value: unknown, id: HandoffId): BoardSession | null {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      'serialNumber',
      'sessionCode',
      'title',
      'startsAt',
      'applePath',
      'googleSaveUrl',
      'calendarPath',
    ])
  ) {
    return null;
  }
  const { serialNumber, sessionCode, title, startsAt, googleSaveUrl } = value;
  const valid =
    typeof serialNumber === 'string' &&
    UUID.test(serialNumber) &&
    typeof sessionCode === 'string' &&
    sessionCode.length >= 1 &&
    sessionCode.length <= MAX_CODE_LENGTH &&
    typeof title === 'string' &&
    title.length >= 1 &&
    title.length <= MAX_TITLE_LENGTH &&
    typeof startsAt === 'string' &&
    parseIsoWithOffset(startsAt) !== null &&
    (googleSaveUrl === null || isGoogleUrl(googleSaveUrl));
  if (!valid) {
    return null;
  }
  const applePath = sessionRoute(value['applePath'], id, serialNumber, 'apple');
  const calendarPath = sessionRoute(value['calendarPath'], id, serialNumber, 'calendar');
  return applePath.ok && calendarPath.ok
    ? {
        serialNumber,
        sessionCode,
        title,
        startsAt,
        applePath: applePath.value,
        googleSaveUrl,
        calendarPath: calendarPath.value,
      }
    : null;
}

function readSessions(value: unknown, id: HandoffId): BoardSession[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_SESSIONS) {
    return null;
  }
  const sessions = (value as unknown[]).map((session) => readSession(session, id));
  return sessions.every((s) => s !== null) ? sessions : null;
}

function readBundles(value: unknown, id: HandoffId, sessionCount: number): AppleBundle[] | null {
  if (!isPlainObject(value) || !hasExactKeys(value, ['bundlePaths'])) {
    return null;
  }
  const paths = value['bundlePaths'];
  const limit = Math.ceil(sessionCount / PASSES_PER_BUNDLE);
  if (!Array.isArray(paths) || paths.length > limit) {
    return null;
  }
  const expected = (paths as unknown[]).map(
    (_, index) => `/api/v1/handoffs/${id}/apple/${String(index)}`,
  );
  return (paths as unknown[]).every((path, index) => path === expected[index])
    ? expected.map((path, index) => ({ path, number: index + 1, of: expected.length }))
    : null;
}

type Optional<T> = { readonly ok: true; readonly value: T | null } | { readonly ok: false };

function isGoogleUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith(GOOGLE_SAVE_PREFIX) &&
    value.length - GOOGLE_SAVE_PREFIX.length <= MAX_GOOGLE_TOKEN &&
    GOOGLE_TOKEN.test(value.slice(GOOGLE_SAVE_PREFIX.length))
  );
}

function readGoogle(value: unknown): Optional<string> {
  if (value === null) {
    return { ok: true, value: null };
  }
  if (!isPlainObject(value) || !hasExactKeys(value, ['saveUrl'])) {
    return { ok: false };
  }
  const saveUrl = value['saveUrl'];
  return isGoogleUrl(saveUrl) ? { ok: true, value: saveUrl } : { ok: false };
}

function readCalendar(value: unknown, id: HandoffId): Optional<string> {
  if (value === null) {
    return { ok: true, value: null };
  }
  return value === `/api/v1/handoffs/${id}/calendar.ics` ? { ok: true, value } : { ok: false };
}

function hasOwnAction(session: BoardSession): boolean {
  return (
    session.applePath !== null || session.googleSaveUrl !== null || session.calendarPath !== null
  );
}

/**
 * Accept a response body only when every rule of Requirement 17 criteria 3 to 5 holds for this
 * hand-off id. Returns the validated hand-off, or null to refuse the whole body.
 */
export function validateHandoffView(body: unknown, id: HandoffId): ValidatedHandoff | null {
  if (
    !isPlainObject(body) ||
    !hasExactKeys(body, ['expiresAt', 'sessions', 'apple', 'google', 'calendarPath'])
  ) {
    return null;
  }
  const expiresAt = body['expiresAt'];
  const expiresAtMs = typeof expiresAt === 'string' ? parseIsoWithOffset(expiresAt) : null;
  const sessions = readSessions(body['sessions'], id);
  const bundles = sessions === null ? null : readBundles(body['apple'], id, sessions.length);
  const google = readGoogle(body['google']);
  const calendar = readCalendar(body['calendarPath'], id);
  if (
    typeof expiresAt !== 'string' ||
    expiresAtMs === null ||
    sessions === null ||
    bundles === null ||
    !google.ok ||
    !calendar.ok ||
    // A hand-off with nothing to add is of no use: treat it as unavailable.
    (bundles.length === 0 &&
      google.value === null &&
      calendar.value === null &&
      !sessions.some(hasOwnAction))
  ) {
    return null;
  }
  return {
    expiresAt,
    expiresAtMs,
    sessions,
    appleBundles: bundles,
    googleSaveUrl: google.value,
    calendarPath: calendar.value,
  };
}
