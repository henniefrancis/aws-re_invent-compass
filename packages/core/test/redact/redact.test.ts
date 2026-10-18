import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import {
  MAX_REDACT_INPUT_LENGTH,
  REDACTED,
  redact,
  secretVariants,
} from '../../src/redact/index.js';
import { createRedactingLogger } from '../../src/api/redacting-logger.js';
import { redact as passRedact } from '../../src/passes/redaction.js';

// The one redactor (release gate, CTO review M1): properties over generated secrets, and a
// timing test on hostile 100 KB inputs for every pattern family.

const b64url = fc.stringMatching(/^[A-Za-z0-9_-]{8,24}$/);
const word = fc.stringMatching(/^[a-z]{3,9}$/);

describe('registered needles', () => {
  test('a needle and its encoded forms never survive, wherever they sit', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 4, maxLength: 30 }).filter((s) => s.trim().length === s.length),
        fc.string({ maxLength: 40 }),
        fc.string({ maxLength: 40 }),
        (needle, before, after) => {
          const forms = secretVariants(needle);
          for (const form of forms) {
            const out = redact(`${before} ${form} ${after}`, [needle, ...forms]);
            expect(out.includes(form)).toBe(false);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  test('an empty needle is ignored and never matches everything', () => {
    expect(redact('plain words stay', [''])).toBe('plain words stay');
  });

  test('the longest needle wins when one contains another', () => {
    expect(redact('see abcdef and abc', ['abc', 'abcdef'])).toBe(`see ${REDACTED} and ${REDACTED}`);
  });

  test('a secret across or beyond the cut is gone, and so is a fragment of it at the cut', () => {
    const needle = 'SECRET-NEEDLE-VALUE';
    const filler = 'x '.repeat((MAX_REDACT_INPUT_LENGTH - 5) / 2);
    const out = redact(`${filler} ${needle} ${'y '.repeat(500)}`, [needle]);
    for (let length = 3; length <= needle.length; length += 1) {
      expect(out.includes(needle.slice(0, length)), needle.slice(0, length)).toBe(false);
    }
    expect(out.endsWith('[TRUNCATED]')).toBe(true);
  });

  test('secretVariants gives the plain, percent-encoded and form-encoded forms', () => {
    expect(secretVariants('a b&c')).toEqual(['a b&c', 'a%20b%26c', 'a+b%26c']);
    expect(secretVariants('plain')).toEqual(['plain']);
  });
});

describe('structural patterns', () => {
  test('a JWT shaped token is removed whole', () => {
    fc.assert(
      fc.property(b64url, b64url, b64url, word, (a, b, c, w) => {
        const jwt = `${a}.${b}.${c}`;
        const out = redact(`${w} ${jwt} ${w}`);
        expect(out).toBe(`${w} ${REDACTED} ${w}`);
      }),
      { numRuns: 200 },
    );
  });

  test('an email address is removed whole', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z0-9._]{1,12}$/),
        fc.stringMatching(/^[a-z]{2,8}$/),
        word,
        (local, domain, w) => {
          const email = `${local}@${domain}.com`;
          const out = redact(`${w} ${email} ${w}`);
          expect(out.includes(email)).toBe(false);
          expect(out.includes('@')).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  test('a URL of any scheme is removed whole, with its path, query and fragment', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('https', 'http', 'file', 'ftp', 'compass+x'),
        word,
        b64url,
        (scheme, host, fragment) => {
          const url = `${scheme}://${host}.example/path?q=1#h=${fragment}`;
          expect(redact(`open ${url} now`)).toBe(`open ${REDACTED} now`);
        },
      ),
      { numRuns: 100 },
    );
  });

  test('a credential after Authorization, Bearer, ApplePass or Basic is removed and the scheme stays', () => {
    expect(redact('Authorization: Bearer abc.def-123 ok')).toBe(
      `Authorization: Bearer ${REDACTED} ok`,
    );
    expect(redact('authorization=ApplePass tokenvalue')).toBe(
      `authorization=ApplePass ${REDACTED}`,
    );
    expect(redact('Authorization: Basic dXNlcjpwYXNz')).toBe(`Authorization: Basic ${REDACTED}`);
    expect(redact('sent bearer sometoken')).toBe(`sent bearer ${REDACTED}`);
    expect(redact('a basic configuration is fine')).toBe('a basic configuration is fine');
  });

  test('form, JSON and key=value secrets lose their value and keep their key', () => {
    expect(redact('refresh_token=abc&client_id=c1')).toBe(`refresh_token=${REDACTED}&client_id=c1`);
    expect(redact('{"id_token": "abc.def"}')).toBe(`{"id_token": "${REDACTED}"}`);
    expect(redact('password: hunter2, user=bob')).toBe(`password: ${REDACTED}, user=bob`);
    expect(redact('api_key = k-1')).toBe(`api_key = ${REDACTED}`);
  });

  test('an opaque run of 22 or more base64 or base64url characters is removed, a shorter one is kept', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Za-z0-9_-]{22,60}$/), (token) => {
        expect(redact(`handoff ${token} expired`)).toBe(`handoff ${REDACTED} expired`);
      }),
      { numRuns: 100 },
    );
    expect(redact('abcdefghijklmnopqrstu')).toBe('abcdefghijklmnopqrstu');
    expect(redact('standard+base64/with+more+padding/stuff==')).toBe(REDACTED);
  });
});

describe('shape of the result', () => {
  test('ordinary lowercase text is left alone', () => {
    fc.assert(
      fc.property(fc.array(word, { minLength: 1, maxLength: 12 }), (words) => {
        const text = words.join(' ');
        fc.pre(
          !/(key|token|sig|secret|password|passwd|credential|basic|bearer|applepass|code)/.test(
            text,
          ),
        );
        expect(redact(text)).toBe(text);
      }),
      { numRuns: 200 },
    );
  });

  test('redacting twice gives the same text as redacting once', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (text) => {
        const once = redact(text);
        expect(redact(once)).toBe(once);
      }),
      { numRuns: 400 },
    );
  });

  test('the output stays bounded however long the input is', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 9000, maxLength: 30_000 }), (text) => {
        expect(redact(text).length).toBeLessThanOrEqual(MAX_REDACT_INPUT_LENGTH * 4 + 11);
      }),
      { numRuns: 20 },
    );
  });

  test('text of exactly the limit is not marked, and one more character is', () => {
    const atLimit = 'y '.repeat(MAX_REDACT_INPUT_LENGTH / 2);
    expect(redact(atLimit)).toBe(atLimit);
    expect(redact(`${atLimit}y `).endsWith('[TRUNCATED]')).toBe(true);
    expect(MAX_REDACT_INPUT_LENGTH).toBe(8192);
  });
});

describe('time on hostile 100 KB input', () => {
  const SIZE = 100 * 1024;
  const hostile: Record<string, string> = {
    'one long local part and a lone at sign': `${'a'.repeat(SIZE)}@`,
    'a dotted run': 'a.'.repeat(SIZE / 2),
    'repeated at signs': 'a@'.repeat(SIZE / 2),
    'repeated tiny emails': 'a@b.cc '.repeat(SIZE / 7),
    'a bearer with no end': `Bearer ${'A'.repeat(SIZE)}`,
    'repeated bearer words': 'bearer '.repeat(SIZE / 7),
    'repeated authorization names': 'authorization:'.repeat(SIZE / 14),
    'repeated key equals': 'key='.repeat(SIZE / 4),
    'repeated token colons': 'token: '.repeat(SIZE / 7),
    'basic followed by a long run': `basic ${'A'.repeat(SIZE)}`,
    'repeated basic words': 'basic '.repeat(SIZE / 6),
    'a long run of scheme characters': 'a'.repeat(SIZE),
    'repeated scheme separators': 'a://'.repeat(SIZE / 4),
    'a long URL': `https://${'a'.repeat(SIZE)}`,
    'a long base64 run': 'Ab+/'.repeat(SIZE / 4),
    'a long dotted token': `${'A'.repeat(SIZE / 2)}.${'B'.repeat(SIZE / 2 - 2)}.`,
    'many short dotted segments': 'abcdefgh.'.repeat(SIZE / 9),
    'a long JSON key': `"id_token":"${'x'.repeat(SIZE)}`,
    'long whitespace runs': `a${' '.repeat(SIZE)}b`,
    'repeated code equals': 'code='.repeat(SIZE / 5),
  };

  test.each(Object.entries(hostile))('%s', (_name, text) => {
    expect(text.length).toBeGreaterThanOrEqual(SIZE - 20);
    const started = performance.now();
    redact(text);
    redact(text, ['needle-one', 'needle-two']);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe('one redactor everywhere', () => {
  test('the API logger and the pass redaction give the same text as the shared function', () => {
    const lines: string[] = [];
    const logger = createRedactingLogger({
      info: (l) => lines.push(l),
      warn: (l) => lines.push(l),
      error: (l) => lines.push(l),
    });
    const text = 'user a@b.com Bearer tok https://x.example/y?z=1 AbCdEfGhIjKlMnOpQrStUvWx';
    logger.info(text);
    expect(lines[0]).toBe(redact(text));
    expect(passRedact(text)).toBe(redact(text));
  });
});
