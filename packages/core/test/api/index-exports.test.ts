import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import * as api from '../../src/api/index.js';

// Structural export test for the api entry point (events-client, S1, task 16.2;
// Requirement 6.1). The index must expose exactly the twelve operation functions, one
// file each, plus the confirmed-write helper and the transport selector, and no other
// function may appear without this list being updated on purpose.

const OPERATIONS: Record<string, string> = {
  listEvents: 'list-events',
  getEvent: 'get-event',
  listSessions: 'list-sessions',
  getSession: 'get-session',
  getSchedule: 'get-schedule',
  reserveSessions: 'reserve-sessions',
  cancelReservation: 'cancel-reservation',
  associateFavorites: 'associate-favorites',
  disassociateFavorite: 'disassociate-favorite',
  createPersonalTime: 'create-personal-time',
  updatePersonalTime: 'update-personal-time',
  deletePersonalTime: 'delete-personal-time',
};

/** Every other runtime export of the api entry point, listed on purpose. */
const SUPPORT_EXPORTS = [
  'NetworkError',
  'TimeoutError',
  'createClientContext',
  'ClientConfigError',
  'SimulatedModeRefusedError',
  'SimulatedFixturesMissingError',
  'LiveClientNotConfiguredError',
  'SIMULATED_MODE_WARNING',
  'isSimulatedResult',
  'sanitiseText',
  'MAX_TITLE_CODE_POINTS',
  'MAX_ABSTRACT_CODE_POINTS',
  'BadRequestError',
  'BodyTooLargeError',
  'BulkWriteResultSchema',
  'ConflictError',
  'EVENTS_API_BASE_URL',
  'EventWindowError',
  'EventsApiError',
  'ForbiddenError',
  'GetEventResultSchema',
  'KNOWN_BULK_FAILURE_CODES',
  'ListEventsResultSchema',
  'MAX_API_BODY_BYTES',
  'MAX_BULK_IDS',
  'MAX_OAUTH_BODY_BYTES',
  'MAX_RETRY_AFTER_SECONDS',
  'MIN_BULK_IDS',
  'MIN_RETRY_AFTER_SECONDS',
  'NotFoundError',
  'QuotaExceededError',
  'RateLimitedError',
  'ResponseTooLargeError',
  'SIMULATED_MODE',
  'ServerError',
  'UnauthorizedError',
  'UnexpectedResponseError',
  'ValidationError',
  'assertBulkInput',
  'assertNoBody',
  'classifyFailure',
  'annotateBulkResult',
  'confirmedWrite',
  'consoleSink',
  'createHttpTransport',
  'createQuotaTracker',
  'createRedactingLogger',
  'createRetryPolicy',
  'errorForStatus',
  'executeOperation',
  'parseRetryAfter',
  'selectTransport',
  'validateBody',
];

describe('events-client, task 16.2: the api entry point', () => {
  test('exposes the twelve operation functions, each defined in its own kebab-case file', () => {
    for (const [name, file] of Object.entries(OPERATIONS)) {
      expect(typeof (api as Record<string, unknown>)[name]).toBe('function');
      expect(existsSync(fileURLToPath(new URL(`../../src/api/${file}.ts`, import.meta.url)))).toBe(
        true,
      );
    }
    expect(Object.keys(OPERATIONS)).toHaveLength(12);
  });

  test('exposes the confirmed-write helper and the transport selector', () => {
    expect(typeof api.confirmedWrite).toBe('function');
    expect(typeof api.selectTransport).toBe('function');
  });

  test('exports exactly the operations plus the listed support exports, nothing else', () => {
    expect(Object.keys(api).sort()).toEqual(
      [...Object.keys(OPERATIONS), ...SUPPORT_EXPORTS].sort(),
    );
  });

  test('the internal path builder is not part of the public surface', () => {
    expect(Object.keys(api)).not.toContain('eventPath');
    expect(Object.keys(api)).not.toContain('segment');
  });
});
