import { afterEach, describe, expect, test, vi } from 'vitest';
import { createStderrLogger } from '../../src/logging/stderr-logger.js';
import { redactText } from '../../src/logging/redact.js';

const JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXZhbHVlLWhlcmU';

describe('redactText', () => {
  test('masks token, email, header and URL shaped values', () => {
    const samples = [
      JWT,
      'person@example.com',
      'Authorization: Bearer abc123def456',
      'https://compass.invalid/board#h=AAAAAAAAAAAAAAAAAAAAAA',
      'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    ];
    for (const sample of samples) {
      const out = redactText(`before ${sample} after`);
      expect(out).toContain('[redacted]');
      expect(out).not.toContain(sample);
    }
  });

  test('leaves plain text alone', () => {
    expect(redactText('Reserved 3 sessions')).toBe('Reserved 3 sessions');
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
