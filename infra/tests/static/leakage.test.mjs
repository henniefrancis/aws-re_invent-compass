// Property 7: no committed owned file embeds an account id, an account-bearing
// ARN or an email address (Requirement 17.6).
//
// Scans every file under infra/**, scripts/** and docs/runbooks/** that is tracked
// or untracked-but-not-ignored. Findings name the file, the line and the kind,
// never the matched text.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listOwnedFiles, readOwned } from './lib.mjs';

const ACCOUNT_ID = /(?<![0-9A-Za-z])[0-9]{12}(?![0-9A-Za-z])/;
const ACCOUNT_ARN = /arn:aws[a-z-]*:[a-z0-9-]*:[a-z0-9-]*:[0-9]{12}:/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;

/**
 * @param {string} text
 * @returns {Array<{ line: number, kind: string }>}
 */
export function scanText(text) {
  const findings = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (ACCOUNT_ARN.test(line)) findings.push({ line: index + 1, kind: 'account-bearing ARN' });
    if (ACCOUNT_ID.test(line)) findings.push({ line: index + 1, kind: '12-digit account id' });
    if (EMAIL.test(line)) findings.push({ line: index + 1, kind: 'email address' });
  });
  return findings;
}

test('the scanner flags an account id, an account-bearing ARN and an email', () => {
  const digits = '1'.repeat(12);
  const mail = ['someone', 'example.com'].join('@');
  assert.deepEqual(scanText(`id ${digits}`), [{ line: 1, kind: '12-digit account id' }]);
  assert.deepEqual(
    scanText(`arn:aws:iam::${digits}:role/x`).map((f) => f.kind),
    ['account-bearing ARN', '12-digit account id'],
  );
  assert.deepEqual(scanText(`contact ${mail}`), [{ line: 1, kind: 'email address' }]);
});

test('the scanner accepts placeholders, shorter numbers and ARNs without an account id', () => {
  assert.deepEqual(scanText('arn:aws:iam::aws:policy/example'), []);
  assert.deepEqual(scanText('arn:aws:s3:::compass-dev-site-example'), []);
  assert.deepEqual(scanText('version 1.15, limit 8192, timeout 3000'), []);
  assert.deepEqual(scanText('REPLACE_WITH_ALARM_EMAIL_ADDRESS'), []);
  assert.deepEqual(scanText('a 13-digit number 1234567890123 is not an account id'), []);
});

test('the scan covers the owned folders', () => {
  const files = listOwnedFiles();
  assert.ok(files.some((f) => f.startsWith('infra/modules/')));
  assert.ok(files.some((f) => f.startsWith('infra/envs/')));
  assert.ok(files.length > 20);
});

test('no owned file embeds an account id, an account-bearing ARN or an email address', () => {
  const problems = [];
  for (const file of listOwnedFiles()) {
    for (const finding of scanText(readOwned(file))) {
      problems.push(`${file}:${finding.line} ${finding.kind}`);
    }
  }
  assert.deepEqual(problems, []);
});
