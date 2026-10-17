import { describe, expect, test } from 'vitest';
import { MAX_REDACT_INPUT_LENGTH, createRedactingLogger } from '../../src/api/redacting-logger.js';

// Security regression tests for the redactor's patterns (events-client, S1, N4): they
// are bounded, anchored on token boundaries, and the input is cut to 8 KB first, so a
// hostile line cannot make redaction slow, and no secret tail is left behind.

function capture(): { logger: ReturnType<typeof createRedactingLogger>; lines: string[] } {
  const lines: string[] = [];
  const push = (line: string): void => {
    lines.push(line);
  };
  return { logger: createRedactingLogger({ info: push, warn: push, error: push }), lines };
}

describe('events-client, N4: redaction is fast on hostile input', () => {
  const big = 100_000;
  const hostile: Record<string, string> = {
    'a run of letters': 'a'.repeat(big),
    'letters then a dot': `${'a'.repeat(big)}.`,
    'dotted letters': 'a.'.repeat(big / 2),
    'an at sign at the end': `${'a'.repeat(big)}@`,
    'repeated at signs': 'a@'.repeat(big / 2),
    'a long authorization value': `authorization: ${'a'.repeat(big)}`,
    'repeated authorization keywords': 'authorization:'.repeat(big / 14),
    'repeated bearer keywords': 'bearer '.repeat(big / 7),
    'a long basic value': `Basic ${'a'.repeat(big)}`,
    'repeated basic keywords': 'basic '.repeat(big / 6),
    'repeated code keys': 'code='.repeat(big / 5),
    'a long json value': `{"refresh_token":"${'x'.repeat(big)}"}`,
    spaces: ' '.repeat(big),
    'dashes and underscores': '-_'.repeat(big / 2),
    'a long domain': `a@${'b'.repeat(big)}`,
  };

  for (const [name, line] of Object.entries(hostile)) {
    test(`${name} (100 KB) is redacted in under 50 ms`, () => {
      const { logger, lines } = capture();
      logger.addSecret('registered-secret-value');
      const started = performance.now();
      logger.info(line);
      const elapsed = performance.now() - started;
      expect(elapsed).toBeLessThan(50);
      expect(lines).toHaveLength(1);
    });
  }
});

describe('events-client, N4: input is cut to 8 KB before matching', () => {
  test('a longer line is truncated and marked, and the part kept is still redacted', () => {
    const { logger, lines } = capture();
    logger.addSecret('needle-in-the-head');
    logger.info(`needle-in-the-head ${'x'.repeat(20_000)} past-the-cut`);
    const line = lines[0] ?? '';
    expect(line.startsWith('[REDACTED] ')).toBe(true);
    expect(line.endsWith('[TRUNCATED]')).toBe(true);
    expect(line.length).toBe(
      MAX_REDACT_INPUT_LENGTH +
        '[TRUNCATED]'.length -
        'needle-in-the-head'.length +
        '[REDACTED]'.length,
    );
    expect(line).not.toContain('past-the-cut');
  });

  test('a line of exactly the limit is not marked', () => {
    const { logger, lines } = capture();
    logger.info('y'.repeat(MAX_REDACT_INPUT_LENGTH));
    expect(lines[0]).toBe('y'.repeat(MAX_REDACT_INPUT_LENGTH));
    expect(MAX_REDACT_INPUT_LENGTH).toBe(8192);
  });

  test('redact() applies the same cut', () => {
    const { logger } = capture();
    expect(logger.redact('z'.repeat(9000)).endsWith('[TRUNCATED]')).toBe(true);
  });
});

describe('events-client, N4: boundaries and no leftover tail', () => {
  const run = (text: string): string => {
    const { logger, lines } = capture();
    logger.info(text);
    return lines[0] ?? '';
  };

  test('a long Authorization value is removed completely, with no tail', () => {
    const value = 'T'.repeat(6000);
    expect(run(`Authorization: Bearer ${value} done`)).toBe(
      'Authorization: Bearer [REDACTED] done',
    );
    expect(run(`bearer ${value}`)).toBe('bearer [REDACTED]');
  });

  test('a JWT is removed as a whole token, but dotted identifiers with short segments are left', () => {
    const jwt = 'aaaaaaaa.bbbbbbbb.cccccccc';
    expect(run(`token ${jwt} end`)).toBe('token [REDACTED] end');
    expect(run(`(${jwt})`)).toBe('([REDACTED])');
    expect(run('a.b.c and com.example.service')).toBe('a.b.c and com.example.service');
    // Four to six long segments (an encrypted token) are removed whole too.
    expect(run(`${jwt}.dddddddd`)).toBe('[REDACTED]');
    expect(run(`${jwt}.dddddddd.eeeeeeee.ffffffff`)).toBe('[REDACTED]');
  });

  test('an email is removed from its first character, including a long local part', () => {
    expect(run('mail first.last+tag@example.co.za now')).toBe('mail [REDACTED] now');
    expect(run(`${'l'.repeat(120)}@example.com`)).toBe('[REDACTED]');
    expect(run('x@y.z')).toBe('x@y.z');
  });

  test('Basic values need to look like base64 data and are removed whole', () => {
    expect(run('Basic dXNlcjpwYXNzd29yZA==')).toBe('Basic [REDACTED]');
    expect(run('basic configuration')).toBe('basic configuration');
  });
});
