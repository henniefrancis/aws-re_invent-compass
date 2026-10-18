// CI and scanner configuration checks (release-gate round, CTO H1 and TAM B2).
//
// The check workflow cannot be run offline, so its shape is asserted: pinned tool
// versions, SHA-pinned actions, the cached plugin folder, the native tests run
// from the parent of their tests folder, and the static tests step. The Trivy and
// gitleaks allowlists must be exactly as narrow as the reviews decided.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { repoRoot } from './lib.mjs';

const workflow = readFileSync(resolve(repoRoot, '.github/workflows/check.yml'), 'utf8').replaceAll(
  '\r\n',
  '\n',
);

test('every action is pinned by a full commit SHA', () => {
  const uses = [...workflow.matchAll(/^\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
  assert.ok(uses.length >= 8);
  for (const reference of uses) {
    assert.match(reference, /@[0-9a-f]{40}$/, reference);
  }
});

test('Terraform, tflint and Trivy are pinned by version', () => {
  assert.match(workflow, /terraform_version:\s*1\.15\.\d+/);
  assert.match(workflow, /tflint_version:\s*v\d+\.\d+\.\d+/);
  assert.equal((workflow.match(/version:\s*v\d+\.\d+\.\d+/g) ?? []).length >= 3, true);
  const trivyBlocks = workflow.split('aquasecurity/trivy-action@').slice(1);
  assert.equal(trivyBlocks.length, 2);
  for (const block of trivyBlocks)
    assert.match(block.split('- name:')[0], /version:\s*v\d+\.\d+\.\d+/);
});

test('the job has a realistic timeout and caches the Terraform plugins', () => {
  const minutes = Number(/timeout-minutes:\s*(\d+)/.exec(workflow)?.[1]);
  assert.ok(minutes >= 20 && minutes <= 45, `timeout-minutes is ${minutes}`);
  assert.match(workflow, /actions\/cache@[0-9a-f]{40}/);
  assert.match(workflow, /path:\s*~\/\.terraform\.d\/plugin-cache/);
  assert.match(workflow, /TF_PLUGIN_CACHE_DIR="\$HOME\/\.terraform\.d\/plugin-cache"/);
});

test('Terraform runs offline: init without a backend, tflint with the repo config, tests mocked', () => {
  assert.match(workflow, /terraform fmt -check -recursive infra/);
  assert.match(workflow, /init -backend=false -input=false/);
  assert.match(
    workflow,
    /tflint --recursive --config="\$GITHUB_WORKSPACE\/infra\/\.tflint\.hcl" --chdir=infra/,
  );
  assert.doesNotMatch(workflow, /terraform[^\n]* (plan|apply|destroy|import|login)\b/);
  assert.doesNotMatch(workflow, /aws-actions\/configure-aws-credentials/);
});

test('each native test runs from the parent of its tests folder, and infra/tests from infra', () => {
  assert.match(
    workflow,
    /git ls-files 'infra\/\*\.tftest\.hcl' \| xargs -n1 dirname \| xargs -n1 dirname \| sort -u/,
  );
  assert.match(workflow, /terraform -chdir="\$dir" test/);
});

test('the static tests step runs', () => {
  assert.match(workflow, /node --test "infra\/tests\/static\/\*\.test\.mjs"/);
});

test('the workflow header no longer claims there are no Terraform or shell files', () => {
  assert.doesNotMatch(workflow, /no-ops/);
  assert.doesNotMatch(workflow, /S6 adds them later/);
  assert.doesNotMatch(workflow, /Detect Terraform files|Detect shell files/);
});

test('.trivyignore lists exactly the three ADR-026 advisories, each with a comment naming its GHSA id', () => {
  const text = readFileSync(resolve(repoRoot, '.trivyignore'), 'utf8').replaceAll('\r\n', '\n');
  const ids = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  // Trivy matches ignores on the CVE id it reports; the GHSA id is a vendor id.
  assert.deepEqual(ids.sort(), ['CVE-2026-85393', 'CVE-2026-90771', 'CVE-2026-92599']);
  const expected = {
    'CVE-2026-85393': 'GHSA-86w9-cpqp-85rv',
    'CVE-2026-92599': 'GHSA-6h2x-m376-mqjq',
    'CVE-2026-90771': 'GHSA-wr44-6hxh-3jwq',
  };
  for (const [cve, ghsa] of Object.entries(expected)) {
    const before = text
      .slice(0, text.indexOf(`\n${cve}\n`))
      .trimEnd()
      .split('\n');
    const comment = before.slice(-3).join(' ');
    assert.ok(comment.includes(`ADR-026, ${ghsa}`), `${cve} needs its ADR-026 comment`);
  }
});

test('the gitleaks allowlist keeps the default rules and covers test paths only', () => {
  const text = readFileSync(resolve(repoRoot, '.gitleaks.toml'), 'utf8').replaceAll('\r\n', '\n');
  assert.match(text, /useDefault\s*=\s*true/);
  // The pinned gitleaks (8.24.3) honours only the [allowlist] table, so the allowlist
  // is a path allowlist limited to test folders (see the comment in .gitleaks.toml).
  assert.match(text, /^\[allowlist\]/m);
  const paths = [...text.matchAll(/'''([^']+)'''/g)].map((m) => m[1]);
  assert.ok(paths.length >= 1);
  for (const path of paths) {
    assert.match(path, /\/test\/|\/e2e\/fixtures\/|tests\/.*tftest/, `${path} must be a test path`);
  }
  // No blanket allowlist: no regexes, stopwords or commit allowlists.
  assert.doesNotMatch(text, /regexes\s*=/);
  assert.doesNotMatch(text, /stopwords\s*=/);
  assert.doesNotMatch(text, /commits\s*=/);
});
