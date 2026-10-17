import { describe, expect, test } from 'vitest';
import { PassError, passError, redact } from '../../src/passes/redaction.js';

// Unit tests for the redaction helper and the shared error shape (boarding-passes, S4).
//
// These lock Requirement 8: the ID token, the attendee email, the Board_URL and the
// hand-off id must never survive into a log line or an error message. The tests drive
// every branch of redact (URL, JWT or bearer token, email, and the plain passthrough)
// and prove passError routes its summary through redact.

// Sentinel secrets of each kind. None of these real-looking values may survive redact.
const SENTINEL_JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRlbmRlZSJ9.c2lnbmF0dXJlX3ZhbHVl';
const SENTINEL_EMAIL = 'first.timer@example.com';
// The Board_URL carries the hand-off id in its URL fragment.
const SENTINEL_HANDOFF_ID = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
const SENTINEL_BEARER_HEADER = `Bearer ${SENTINEL_JWT}`;
const SENTINEL_BARE_HANDOFF = 'Zm9vYmFyYmF6cXV4MTIzNDU2';
const SENTINEL_BOARD_URL = `https://d111111abcdef8.cloudfront.net/board#${SENTINEL_HANDOFF_ID}`;

describe('Feature: boarding-passes, redact removes every secret kind', () => {
  test('a Board_URL and its hand-off id fragment are removed', () => {
    const out = redact(`open ${SENTINEL_BOARD_URL} on your phone`);
    expect(out).not.toContain(SENTINEL_BOARD_URL);
    expect(out).not.toContain(SENTINEL_HANDOFF_ID);
    expect(out).not.toContain('cloudfront.net');
    expect(out).toContain('[redacted]');
  });

  test('a JWT or bearer token is removed', () => {
    const out = redact(`token ${SENTINEL_JWT} attached`);
    expect(out).not.toContain(SENTINEL_JWT);
    expect(out).toContain('[redacted]');
    expect(out.startsWith('token ')).toBe(true);
  });

  test('an email address is removed whole', () => {
    const out = redact(`signed in as ${SENTINEL_EMAIL} now`);
    expect(out).not.toContain(SENTINEL_EMAIL);
    expect(out).not.toContain('example.com');
    expect(out).toContain('[redacted]');
  });

  test('a token sitting inside a URL is removed with the URL', () => {
    const out = redact(`https://api.awsevents.com/v1?access_token=${SENTINEL_JWT}`);
    expect(out).not.toContain(SENTINEL_JWT);
    expect(out).not.toContain('api.awsevents.com');
    expect(out).toBe('[redacted]');
  });

  test('a bearer credential is removed', () => {
    const out = redact(`sent Authorization: ${SENTINEL_BEARER_HEADER} to the api`);
    expect(out).not.toContain(SENTINEL_JWT);
    expect(out).not.toContain('Bearer');
    expect(out).toContain('[redacted]');
  });

  test('a bare hand-off id outside a URL is removed', () => {
    const out = redact(`handoff ${SENTINEL_HANDOFF_ID} and ${SENTINEL_BARE_HANDOFF} expired`);
    expect(out).not.toContain(SENTINEL_HANDOFF_ID);
    expect(out).not.toContain(SENTINEL_BARE_HANDOFF);
    expect(out).toBe('handoff [redacted] and [redacted] expired');
  });

  test('text with no secret is returned unchanged', () => {
    const clean = 'issue failed: the route template returned a validation error';
    expect(redact(clean)).toBe(clean);
  });

  test('all three secret kinds in one string are each removed', () => {
    const out = redact(`${SENTINEL_EMAIL} used ${SENTINEL_JWT} to open ${SENTINEL_BOARD_URL}`);
    expect(out).not.toContain(SENTINEL_EMAIL);
    expect(out).not.toContain(SENTINEL_JWT);
    expect(out).not.toContain(SENTINEL_BOARD_URL);
    expect(out).not.toContain(SENTINEL_HANDOFF_ID);
  });
});

describe('Feature: boarding-passes, passError redacts its summary', () => {
  test('the code is kept and the summary is redacted', () => {
    const err = passError('compass.transport_failed', `calling ${SENTINEL_BOARD_URL}`);
    expect(err.code).toBe('compass.transport_failed');
    expect(err.summary).not.toContain(SENTINEL_BOARD_URL);
    expect(err.summary).not.toContain(SENTINEL_HANDOFF_ID);
    expect(err.summary).toContain('[redacted]');
  });

  test('the error is throwable and carries the redacted summary as its message', () => {
    const err = passError('store.write_failed', `wrote for ${SENTINEL_EMAIL}`);
    expect(err).toBeInstanceOf(PassError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('PassError');
    expect(err.message).toBe(err.summary);
    expect(err.message).not.toContain(SENTINEL_EMAIL);
    expect(() => {
      throw err;
    }).toThrow(PassError);
  });

  test('a clean summary passes through unchanged', () => {
    const err = passError('compass.validation_failed', 'response did not match schema');
    expect(err.summary).toBe('response did not match schema');
  });
});
