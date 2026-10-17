import { describe, expect, test } from 'vitest';
import { MAX_REDACT_INPUT, PassError, passError, redact } from '../../src/passes/redaction.js';

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

  test('standard base64 runs, with plus, slash and padding, are removed', () => {
    const standard = 'dGhpcy9pcytzdGFuZGFyZC9iYXNlNjQrdG9rZW4=';
    const padded = 'QUJDREVGR0hJSktMTU5PUFFSU1RV==';
    const out = redact(`blob ${standard} and ${padded} end`);
    expect(out).not.toContain(standard);
    expect(out).not.toContain(padded);
    expect(out).not.toContain('==');
    expect(out).toBe('blob [redacted] and [redacted] end');
  });

  test('key=value and key: value secrets are removed whole', () => {
    for (const text of [
      'access_token=abc123',
      'password: hunter2',
      'api_key = k-1',
      'Authorization: Zm9v',
      'refresh_token=short',
      'secret:x',
      'sig=ab',
    ]) {
      const out = redact(`failed with ${text} then stopped`);
      expect(out).toBe('failed with [redacted] then stopped');
    }
  });

  test('ordinary words that merely mention a key name are kept', () => {
    const clean = 'The token was not available and the key store is empty';
    expect(redact(clean)).toBe(clean);
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

describe('Feature: boarding-passes, redact caps its input at 8 KB (security N6)', () => {
  test('text at the limit is scanned whole, and the limit is 8 KB', () => {
    expect(MAX_REDACT_INPUT).toBe(8192);
    const atLimit = `${'word '.repeat(1637)}tok=${SENTINEL_JWT}`.slice(0, MAX_REDACT_INPUT);
    expect(redact(atLimit)).not.toContain('[truncated]');
  });

  test('longer text is cut at the last whitespace inside the limit and marked, so no half token survives', () => {
    // A token that straddles the limit: its first characters sit before byte 8192.
    const head = `${'word '.repeat(1630)}`;
    const straddling = `${head}${SENTINEL_JWT}${' tail'.repeat(500)}`;
    expect(straddling.length).toBeGreaterThan(MAX_REDACT_INPUT);
    const out = redact(straddling);
    expect(out.endsWith(' [truncated]')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(MAX_REDACT_INPUT + ' [truncated]'.length);
    expect(out).not.toContain(SENTINEL_JWT.slice(0, 10));
    expect(out).not.toContain('eyJ');
  });

  test('a long run with no whitespace at all is cut at the limit and its tokens are still removed', () => {
    const out = redact(`${'A1b2'.repeat(5000)}`);
    expect(out).toBe('[redacted] [truncated]');
  });

  test('a huge hostile input is handled quickly', () => {
    const started = Date.now();
    redact('a@'.repeat(500_000));
    redact('https://'.repeat(100_000));
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
