// The access log format never contains $context.path, a source IP or an identity
// field (Requirements 5.7, 5.8 and 17.3, S5 security review item 6). The module
// native tests assert the same on the planned format; this scan covers every
// Terraform file in the repository so a format added anywhere is caught.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listTerraformSources, readOwned, stripHashComments } from './lib.mjs';

const FORBIDDEN =
  /\$context\.path(?![A-Za-z])|\$context\.identity|sourceIp|\$context\.(requestOverride|responseOverride|authorizer|awsEndpointRequestId|domainName|accountId|xrayTraceId|wafResponseCode|webaclArn)/;

/**
 * @param {string} source Terraform text
 * @returns {string[]} the forbidden fields found, by name
 */
export function forbiddenFields(source) {
  const found = [];
  const code = stripHashComments(source);
  const pattern = new RegExp(FORBIDDEN.source, 'g');
  let match = pattern.exec(code);
  while (match !== null) {
    found.push(match[0]);
    match = pattern.exec(code);
  }
  return found;
}

test('the scan flags the full path, a source IP and identity fields', () => {
  assert.deepEqual(forbiddenFields('x = "$context.path"'), ['$context.path']);
  assert.deepEqual(forbiddenFields('x = "$context.identity.sourceIp"'), [
    '$context.identity',
    'sourceIp',
  ]);
  assert.deepEqual(forbiddenFields('x = "$context.authorizer.principalId"'), [
    '$context.authorizer',
  ]);
});

test('the scan accepts the route template and the safe fields', () => {
  const safe =
    '"$context.requestId" "$context.resourcePath" "$context.httpMethod" "$context.status" "$context.error.responseType"';
  assert.deepEqual(forbiddenFields(safe), []);
  assert.deepEqual(forbiddenFields('# $context.path is forbidden'), []);
});

test('no Terraform file references a forbidden access log field', () => {
  const problems = [];
  for (const file of listTerraformSources()) {
    for (const field of forbiddenFields(readOwned(file))) problems.push(`${file}: ${field}`);
  }
  assert.deepEqual(problems, []);
});

test('the stage access log format records the route template', () => {
  const locals = readOwned('infra/modules/api/locals.tf');
  assert.match(locals, /\$context\.resourcePath/);
  assert.match(locals, /access_log_format\s*=\s*jsonencode/);
});

test('API Gateway execution logging stays off and data trace stays off', () => {
  const main = stripHashComments(readOwned('infra/modules/api/main.tf'));
  assert.equal((main.match(/logging_level\s*=\s*"OFF"/g) ?? []).length, 2);
  assert.equal((main.match(/data_trace_enabled\s*=\s*false/g) ?? []).length, 2);
  assert.match(main, /xray_tracing_enabled\s*=\s*false/);
});
