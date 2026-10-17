// Secret shape checks (S5 review N1 and N3).
//
// The owner-run script is never run against AWS. Its JSON-building functions are
// extracted from the source and run offline in bash against sample files, and the
// output is validated with the pass-service rules.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readOwned } from './lib.mjs';

// Rules copied from packages/pass-service/src/secrets/secret-shapes.ts (S5).
const PEPPER_MIN_LENGTH = 16;
const PEPPER_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const ORIGIN_VERIFY_MIN_LENGTH = 1;

const source = readOwned('scripts/load-secrets.sh');

/**
 * Source of one top-level shell function (it ends at the first closing brace in
 * column 0).
 *
 * @param {string} name function name
 * @returns {string}
 */
function shellFunction(name) {
  const match = new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?\\n\\}\\n`, 'm').exec(source);
  assert.ok(match, `function ${name} must exist`);
  return match[0];
}

/**
 * @param {string} body bash text run after the function definitions
 * @returns {{status: number|null, stdout: string, stderr: string}}
 */
function runBash(body) {
  const program = [
    "PEPPER_ID_PATTERN='^[A-Za-z0-9._-]{1,64}$'",
    shellFunction('build_app_json'),
    body,
  ].join('\n');
  const result = spawnSync('bash', ['-c', program], { encoding: 'utf8' });
  assert.equal(result.error, undefined, 'bash must be installed');
  return result;
}

/**
 * @param {string} text sample file text
 * @param {(file: string) => void} fn runs with the sample file path
 */
function withFile(text, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'compass-shape-'));
  try {
    const file = join(dir, 'sample');
    writeFileSync(file, text);
    fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SAMPLE_PEPPER = 'q3Zr0Xk9c1VbN7mT2LsJ8aYdE4wGhUoP5fKiRtMxSnA';

test('the app secret JSON carries pepper and pepperId and passes the service rules', () => {
  withFile(`${SAMPLE_PEPPER}\n`, (file) => {
    const result = runBash(`build_app_json '${file}' p1`);
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(parsed).sort(), ['pepper', 'pepperId']);
    assert.ok(parsed.pepper.length >= PEPPER_MIN_LENGTH);
    assert.match(parsed.pepperId, PEPPER_ID_PATTERN);
    assert.equal(parsed.pepper, SAMPLE_PEPPER);
    assert.equal(parsed.pepperId, 'p1');
  });
});

test('a rotated pepper id (p2, p3) is accepted', () => {
  withFile(SAMPLE_PEPPER, (file) => {
    for (const id of ['p2', 'p3', 'p10']) {
      const result = runBash(`build_app_json '${file}' ${id}`);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).pepperId, id);
    }
  });
});

test('the builder refuses a short pepper, a non base64url pepper and a bad id', () => {
  withFile('short', (file) => {
    assert.notEqual(runBash(`build_app_json '${file}' p1`).status, 0);
  });
  withFile('abcdefghijklmnopqrstuvwxyz"}{', (file) => {
    assert.notEqual(runBash(`build_app_json '${file}' p1`).status, 0);
  });
  withFile(SAMPLE_PEPPER, (file) => {
    for (const id of ['', 'p 1', 'p"1', 'a'.repeat(65)]) {
      const result = runBash(`build_app_json '${file}' '${id}'`);
      assert.notEqual(result.status, 0, `id ${JSON.stringify(id)} must be refused`);
    }
  });
});

test('the generated pepper is base64url of 32 random bytes and the first id is p1', () => {
  assert.match(source, /openssl rand -base64 32 \| tr '\+\/' '-_' \| tr -d '=\\r\\n'/);
  assert.match(source, /else\s+pepper_id="p1"\s+fi/);
  assert.match(source, /--rotate-pepper needs --pepper-id pN/);
  assert.match(source, /secret-shapes\.ts/);
  // 32 bytes encode to 43 base64url characters, above the 16 character minimum.
  const encoded = Buffer.alloc(32, 7).toString('base64url');
  assert.ok(encoded.length >= PEPPER_MIN_LENGTH);
});

test('origin-verify --keep-previous writes originVerifyPrevious from a local file only', () => {
  const fn = shellFunction('build_origin_verify_json');
  assert.match(fn, /originVerifyPrevious/);
  assert.match(source, /--keep-previous\) keep_previous="yes"/);
  assert.match(source, /--keep-previous needs --rotate and --previous-file FILE/);
  assert.match(source, /clean_origin_value "\$\{previous_file\}"/);
  // The old value is never read from the secret.
  assert.doesNotMatch(source, /get-secret-value/);
});

test('the origin-verify JSON passes the service rules when jq is available', (t) => {
  const probe = spawnSync('jq', ['--version'], { encoding: 'utf8' });
  if (probe.error) {
    t.skip('jq is not installed; the jq program is asserted statically above');
    return;
  }
  const current = 'c'.repeat(40);
  const previous = 'd'.repeat(40);
  withFile(current, (currentFile) => {
    withFile(previous, (previousFile) => {
      const program = [
        shellFunction('build_origin_verify_json'),
        `build_origin_verify_json '${currentFile}' '${previousFile}'`,
      ].join('\n');
      const result = spawnSync('bash', ['-c', program], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.deepEqual(Object.keys(parsed).sort(), ['originVerify', 'originVerifyPrevious']);
      assert.ok(parsed.originVerify.length >= ORIGIN_VERIFY_MIN_LENGTH);
      assert.equal(parsed.originVerifyPrevious, previous);
    });
  });
});
