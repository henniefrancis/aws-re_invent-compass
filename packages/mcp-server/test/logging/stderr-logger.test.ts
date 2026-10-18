import { afterEach, describe, expect, test, vi } from 'vitest';
import { createStderrLogger } from '../../src/logging/stderr-logger.js';
import { redact as redactText } from '@compass/core/redact';

const JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXZhbHVlLWhlcmU';

describe('redactText', () => {
  test('masks token, email, header and URL shaped values', () => {
    const samples = [
      JWT,
      'person@example.com',
      'Authorization: Bearer abc123def456',
      'https://compass.invalid/board#h=AAAAAAAAAAAAAAAAAAAAAA',
      'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      'Zk3kqN7m1xVf0aB9cD2eFg',
    ];
    for (const sample of samples) {
      const out = redactText(`before ${sample} after`);
      expect(out).toContain('[REDACTED]');
      expect(out).not.toContain(sample);
    }
  });

  test('leaves plain text alone', () => {
    expect(redactText('Reserved 3 sessions')).toBe('Reserved 3 sessions');
  });
});

describe('the logger on a hostile 100 KB line (CTO review M1)', () => {
  test('a quadratic email shape is handled in linear time and leaves no address', () => {
    const lines: string[] = [];
    const logger = createStderrLogger({
      write: (chunk) => {
        lines.push(chunk);
      },
    });
    const started = performance.now();
    logger.warn('a'.repeat(100 * 1024) + '@', { detail: 'a@'.repeat(50 * 1024) });
    expect(performance.now() - started).toBeLessThan(1000);
    expect(lines).toHaveLength(1);
  });
});

describe('createStderrLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('writes only to the injected stderr stream and never to stdout', () => {
    const stdout = vi.spyOn(process.stdout, 'write');
    const lines: string[] = [];
    const logger = createStderrLogger({
      write: (chunk) => {
        lines.push(chunk);
      },
    });
    logger.info('hello');
    logger.warn('careful', { count: 2, ok: true, name: 'x' });
    logger.error('failed');
    expect(stdout).not.toHaveBeenCalled();
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('info hello');
    expect(lines[1]).toContain('warn careful count=2 ok=true name=x');
    expect(lines[2]).toContain('error failed');
  });

  test('redacts tokens, emails and URLs in messages, keys and values', () => {
    const lines: string[] = [];
    const logger = createStderrLogger({
      write: (chunk) => {
        lines.push(chunk);
      },
    });
    logger.info(`token ${JWT} mail person@example.com`, {
      'x@example.org': 'https://compass.invalid/board#h=secret',
      other: JWT,
    });
    const text = lines.join('');
    expect(text).not.toContain(JWT);
    expect(text).not.toContain('person@example.com');
    expect(text).not.toContain('x@example.org');
    expect(text).not.toContain('compass.invalid');
  });
});
