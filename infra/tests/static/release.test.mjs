// release.sh checks added in the release-gate round: the saved plan file is removed
// again, and the allow list matches the resources that exist now.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listTerraformSources, readOwned } from './lib.mjs';

test('release.sh removes the saved plan file whatever the outcome', () => {
  const source = readOwned('scripts/release.sh');
  assert.match(source, /trap 'rm -f "\$\{env_dir\}\/tfplan"' EXIT/);
  const trapAt = source.indexOf("trap 'rm -f");
  const planAt = source.indexOf('terraform plan -input=false -out=tfplan');
  assert.ok(trapAt > 0 && planAt > trapAt, 'the trap must be set before the plan is written');
});

test('the allow list names every resource type the roots can create, and no budget', () => {
  const source = readOwned('scripts/release.sh');
  const block = /ALLOWED_TYPES=\(([^)]*)\)/.exec(source)?.[1] ?? '';
  const allowed = new Set(block.split(/\s+/).filter((t) => t.length > 0));
  assert.equal(allowed.has('aws_budgets_budget'), false);

  // Every managed resource type declared in a module must be allowed.
  const declared = new Set();
  for (const file of listTerraformSources().filter((f) => f.startsWith('infra/modules/'))) {
    for (const match of readOwned(file).matchAll(/^resource\s+"([^"]+)"/gm)) declared.add(match[1]);
  }
  const missing = [...declared].filter((type) => !allowed.has(type)).sort();
  assert.deepEqual(missing, []);
});
