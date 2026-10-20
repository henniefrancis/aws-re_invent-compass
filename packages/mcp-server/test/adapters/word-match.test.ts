import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { containsAnyWord, containsWord } from '../../src/adapters/word-match.js';

describe('whole-word matching', () => {
  test.each([
    ['Building with .NET on AWS', '.NET', true],
    ['ASP.NET Core on Lambda', '.NET', true],
    ['Modern C# and AWS', 'C#', true],
    ['Network design for VPC', 'net', false],
    ['Using .network files', '.NET', false],
    ['Golang at scale', 'Golang', true],
    ['Google Cloud migration', 'Go', false],
    ['Write Go code', 'go', true],
    ['React, Angular and Vue', 'vue', true],
    ['C++ performance', 'C++', true],
    ['Amazon S3 deep dive', 'S3', true],
    ['S3x is not S3', 's3x', true],
    ['anything', '   ', false],
    ['', 'go', false],
  ])('%j contains %j: %s', (text, word, expected) => {
    expect(containsWord(text, word)).toBe(expected);
  });

  test('any of several words in any of several texts, skipping missing texts', () => {
    expect(containsAnyWord([undefined, 'Serverless .NET'], ['python', 'dotnet', '.net'])).toBe(
      true,
    );
    expect(containsAnyWord([undefined, 'Serverless Java'], ['python'])).toBe(false);
    expect(containsAnyWord(['Python'], [])).toBe(false);
    expect(containsAnyWord([undefined, ['Java', 'Serverless Python']], ['python'])).toBe(true);
  });

  test('a word surrounded by letters never matches when it starts and ends with a letter', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z]{1,8}$/), (word) => {
        expect(containsWord(`x${word}y`, word)).toBe(false);
        expect(containsWord(`x ${word} y`, word)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  test('stays linear on a long hostile text', () => {
    const started = Date.now();
    expect(containsWord('a'.repeat(200_000), 'aaab')).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
