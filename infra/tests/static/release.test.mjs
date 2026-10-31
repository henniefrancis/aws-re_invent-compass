// release.sh checks added in the release-gate round: the saved plan file is removed
// again, and the allow list matches the resources that exist now.

import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { listTerraformSources, readOwned, repoRoot } from './lib.mjs';

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

test('the Google Wallet images have one set of names everywhere (pass-service task 47, infra task 25)', async () => {
  const { GOOGLE_IMAGES } = await import(
    pathToFileURL(`${repoRoot}/packages/pass-service/src/google/google-layout.ts`).href
  );
  const expected = Object.values(GOOGLE_IMAGES).sort();
  const release = readOwned('scripts/release.sh');
  const copied = /for name in ([^;]+); do\n\s+source_image=/.exec(release)?.[1] ?? '';
  assert.deepEqual(copied.split(/\s+/).sort(), expected);
  const files = readdirSync(`${repoRoot}/packages/pass-service/artwork/google`).sort();
  assert.deepEqual(files, expected);
});

test('release.sh adds the Google Wallet images to the built site before the sync (infra task 25)', () => {
  const source = readOwned('scripts/release.sh');
  const buildAt = source.indexOf('bash -c "${site_build_cmd}"');
  const copyAt = source.indexOf('cp "${source_image}" "${site_dir}/wallet/${name}"');
  const syncAt = source.indexOf('aws s3 sync');
  assert.ok(buildAt > 0 && copyAt > buildAt, 'the images go in after the site build');
  assert.ok(syncAt > copyAt, 'the sync uploads them');
  assert.match(source, /\[ -f "\$\{source_image\}" \] \|\| fail/);
  assert.doesNotMatch(source, /--exclude "wallet/, 'nothing keeps wallet/ out of the sync');
  assert.doesNotMatch(source, /build_dir\}\/wallet/);
});
