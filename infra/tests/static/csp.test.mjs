// The CloudFront Content-Security-Policy must equal the site's Required_CSP exactly
// (S7 security review M-1). site/scripts/required-csp.mjs is the single source; this
// test reads the directive list from infra/modules/edge/locals.tf and compares it, so a
// change on either side without the other fails CI.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * @param {string} source the edge module locals.tf text
 * @returns {string[]} the directives inside content_security_policy = join("; ", [...])
 */
export function terraformCspDirectives(source) {
  const match = /content_security_policy\s*=\s*join\("; ",\s*\[([\s\S]*?)\]\)/.exec(source);
  if (match === null) {
    throw new Error('content_security_policy join not found in locals.tf');
  }
  return [...match[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
}

test('terraformCspDirectives reads the quoted directive list', () => {
  const sample = `x = 1\n  content_security_policy = join("; ", [\n    "default-src 'none'",\n    "upgrade-insecure-requests",\n  ])\n`;
  assert.deepEqual(terraformCspDirectives(sample), [
    "default-src 'none'",
    'upgrade-insecure-requests',
  ]);
  assert.throws(() => terraformCspDirectives('nothing here'), /not found/);
});

test('the CloudFront CSP equals the site Required_CSP', async () => {
  const locals = readFileSync(resolve(repoRoot, 'infra/modules/edge/locals.tf'), 'utf8');
  const { CSP_DIRECTIVES } = await import(
    pathToFileURL(resolve(repoRoot, 'site/scripts/required-csp.mjs')).href
  );
  assert.deepEqual(terraformCspDirectives(locals), [...CSP_DIRECTIVES]);
});
