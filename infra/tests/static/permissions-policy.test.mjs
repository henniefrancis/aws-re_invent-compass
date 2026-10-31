// The CloudFront Permissions-Policy must equal the site's required value exactly, and it must
// let the site itself use the location ("Walk from here", ADR-037) and nothing wider.
// site/scripts/required-permissions-policy.mjs is the single source (the preview server sends it);
// this test reads the value from infra/modules/edge/locals.tf and compares it.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * @param {string} source the edge module locals.tf text
 * @returns {string} the permissions_policy value
 */
export function terraformPermissionsPolicy(source) {
  const match = /permissions_policy\s*=\s*"([^"]*)"/.exec(source);
  if (match === null) {
    throw new Error('permissions_policy not found in locals.tf');
  }
  return match[1];
}

test('terraformPermissionsPolicy reads the quoted value', () => {
  assert.equal(
    terraformPermissionsPolicy('a = 1\n  permissions_policy = "camera=()"\n'),
    'camera=()',
  );
  assert.throws(() => terraformPermissionsPolicy('nothing here'), /not found/);
});

test('the CloudFront Permissions-Policy equals the site value', async () => {
  const locals = readFileSync(resolve(repoRoot, 'infra/modules/edge/locals.tf'), 'utf8');
  const { REQUIRED_PERMISSIONS_POLICY } = await import(
    pathToFileURL(resolve(repoRoot, 'site/scripts/required-permissions-policy.mjs')).href
  );
  assert.equal(terraformPermissionsPolicy(locals), REQUIRED_PERMISSIONS_POLICY);
});

test('geolocation is (self) and no entry is open to every origin', () => {
  const locals = readFileSync(resolve(repoRoot, 'infra/modules/edge/locals.tf'), 'utf8');
  const entries = terraformPermissionsPolicy(locals).split(', ');
  assert.ok(entries.includes('geolocation=(self)'));
  for (const entry of entries) {
    assert.ok(!entry.includes('*'), `${entry} must not allow every origin`);
  }
});
