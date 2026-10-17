import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { LOCAL_CSP, REQUIRED_CSP } from '../../scripts/required-csp.mjs';
import { NOTICE } from '../../src/lib/content/notice';
import { SITE_ROOT } from '../support/source-files';

const readme = readFileSync(join(SITE_ROOT, 'README.md'), 'utf8');

describe('site/README.md', () => {
  test('quotes the Required_CSP exactly, for S6', () => {
    expect(readme).toContain(REQUIRED_CSP);
  });

  test('names the output folder of the release script', () => {
    expect(readme).toContain('site/dist/site/browser/');
  });

  test('explains the local policy without upgrade-insecure-requests', () => {
    expect(readme).toContain('LOCAL_CSP');
    expect(LOCAL_CSP).not.toContain('upgrade-insecure-requests');
  });

  test('carries the Notice and points to the artwork manifest', () => {
    expect(readme).toContain(NOTICE.text);
    expect(readme).toContain('[ARTWORK.md](ARTWORK.md)');
  });

  test('covers the build, the tests and the content sources', () => {
    for (const phrase of [
      'npx ng build',
      'check-build-output',
      'check-budgets',
      'npx vitest run',
      'playwright test',
      'verbatim',
    ]) {
      expect(readme).toContain(phrase);
    }
  });
});
