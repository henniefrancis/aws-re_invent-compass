// Property 6 (lexical half): no Terraform output exposes a secret or identifier,
// and any unavoidable sensitive value is marked sensitive (Requirements 7.4 and
// 17.1). The plan-level half is infra/tests/outputs.tftest.hcl.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listTerraformSources, parseOutputs, readOwned } from './lib.mjs';

// Anything secret-bearing: such a value must be marked sensitive, and the roots
// must not output it at all.
const SECRET_REFERENCE =
  /random_password|secret_string|alarm_email|origin_verify(?!\.arn|_secret_arn)|api_key|pepper|password|passphrase|\btoken\b/i;
// Anything that embeds the account id: modules may output ARNs (they are wiring,
// not secrets), but a root or the bootstrap may not output one unless sensitive.
const ACCOUNT_REFERENCE = /\.arn\b|account_id|caller_identity/;

const SENSITIVE = /^\s*sensitive\s*=\s*true\s*$/m;

/**
 * @param {string} file path of an outputs.tf
 * @param {string} source its text
 * @returns {string[]} problems
 */
export function checkOutputs(file, source) {
  const isModule = file.startsWith('infra/modules/');
  const problems = [];
  for (const block of parseOutputs(source)) {
    const valueLine = block.body
      .split('\n')
      .filter((l) => /^\s*value\s*=/.test(l))
      .join('\n');
    const sensitive = SENSITIVE.test(block.body);
    if (SECRET_REFERENCE.test(valueLine) || SECRET_REFERENCE.test(block.name)) {
      if (!sensitive)
        problems.push(`${file}: output ${block.name} references a secret but is not sensitive`);
      if (!isModule) problems.push(`${file}: root output ${block.name} must not expose a secret`);
    }
    if (!isModule && ACCOUNT_REFERENCE.test(valueLine) && !sensitive) {
      problems.push(`${file}: output ${block.name} may embed an account id and is not sensitive`);
    }
  }
  return problems;
}

test('the checker flags an unprotected secret output and accepts a sensitive one', () => {
  const bad = 'output "x" {\n  value = random_password.p.result\n}\n';
  const good = 'output "x" {\n  value     = random_password.p.result\n  sensitive = true\n}\n';
  assert.equal(checkOutputs('infra/modules/m/outputs.tf', bad).length, 1);
  assert.deepEqual(checkOutputs('infra/modules/m/outputs.tf', good), []);
  assert.equal(checkOutputs('infra/envs/dev/outputs.tf', good).length, 1);
});

test('the checker flags an unprotected root ARN and accepts a module ARN', () => {
  const arn = 'output "r" {\n  value = aws_iam_role.x.arn\n}\n';
  assert.equal(checkOutputs('infra/envs/dev/outputs.tf', arn).length, 1);
  assert.deepEqual(checkOutputs('infra/modules/m/outputs.tf', arn), []);
});

test('every output in the repository is free of unprotected secrets and identifiers', () => {
  const files = listTerraformSources().filter((f) => f.endsWith('/outputs.tf'));
  assert.ok(files.length >= 8);
  const problems = files.flatMap((f) => checkOutputs(f, readOwned(f)));
  assert.deepEqual(problems, []);
});

test('the bootstrap role ARN outputs are sensitive', () => {
  const blocks = parseOutputs(readOwned('infra/bootstrap/outputs.tf'));
  assert.deepEqual(blocks.map((b) => b.name).sort(), ['apply_role_arns', 'plan_role_arns']);
  for (const block of blocks) assert.match(block.body, SENSITIVE);
});
