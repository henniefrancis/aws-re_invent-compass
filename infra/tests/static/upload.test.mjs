// Nothing private can be uploaded to HCP Terraform (owner review N2).
//
// The dev and prod workspaces use the working directory envs/<env>, and the
// Terraform CLI uploads the tree one level up from it, the infra/ directory. The
// .terraformignore file at infra/ is therefore the upload root file; the same file
// is repeated in each environment directory. This test applies the ignore rules
// to every file that exists under infra/ (committed or not, ignored by git or not)
// and fails if a key, an environment file, an auto tfvars file or a real tfvars
// file would still be sent.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { repoRoot } from './lib.mjs';

const INFRA = resolve(repoRoot, 'infra');
const IGNORE_FILES = [
  'infra/.terraformignore',
  'infra/envs/dev/.terraformignore',
  'infra/envs/prod/.terraformignore',
];

/**
 * Convert one ignore pattern to a matcher over an upload-root-relative path. The
 * rules follow the Terraform CLI ignore file: patterns are anchored at the upload
 * root, `**` crosses directories, `*` and `?` stay inside one path segment, and a
 * path is excluded when the pattern matches it or any parent directory.
 *
 * @param {string} pattern
 * @returns {(path: string) => boolean}
 */
export function compilePattern(pattern) {
  const directoryOnly = pattern.endsWith('/');
  const body = directoryOnly ? pattern.slice(0, -1) : pattern;
  let source = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '*' && body[i + 1] === '*' && body[i + 2] === '/') {
      source += '(?:.*/)?';
      i += 2;
    } else if (ch === '*' && body[i + 1] === '*') {
      source += '.*';
      i += 1;
    } else if (ch === '*') {
      source += '[^/]*';
    } else if (ch === '?') {
      source += '[^/]';
    } else {
      source += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  const regex = new RegExp(`^${source}$`);
  return (path) => {
    const parts = path.split('/');
    for (let end = 1; end <= parts.length; end += 1) {
      const candidate = parts.slice(0, end).join('/');
      const isWholePath = end === parts.length;
      if (directoryOnly && isWholePath) continue;
      if (regex.test(candidate)) return true;
    }
    return false;
  };
}

/**
 * @param {string} text contents of an ignore file
 * @returns {Array<(path: string) => boolean>}
 */
export function compileIgnoreFile(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#') && !line.startsWith('!'))
    .map(compilePattern);
}

function isExcluded(matchers, path) {
  return matchers.some((matches) => matches(path));
}

function listFiles(directory, prefix = '') {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) files.push(...listFiles(resolve(directory, entry.name), relative));
    else files.push(relative);
  }
  return files;
}

const SENSITIVE_NAME =
  /(^|\/)(\.env(\..*)?|[^/]*\.pem|[^/]*\.p12|[^/]*\.auto\.tfvars(\.json)?|terraform\.tfvars|cloud\.auto\.tfbackend|[^/]*\.tfstate(\..*)?)$/;

test('the matcher honours anchoring, ** and parent directories', () => {
  const matcher = compilePattern('**/*.pem');
  assert.equal(matcher('key.pem'), true);
  assert.equal(matcher('a/b/key.pem'), true);
  assert.equal(matcher('a/b/key.pem.example'), false);
  assert.equal(compilePattern('*.pem')('a/key.pem'), false);
  assert.equal(compilePattern('.terraform/')('.terraform/providers/x'), true);
  assert.equal(compilePattern('.terraform/')('.terraform'), false);
  assert.equal(compilePattern('**/.terraform/')('envs/dev/.terraform/x'), true);
});

test('the three ignore files are identical and cover the sensitive patterns at every depth', () => {
  const texts = IGNORE_FILES.map((f) =>
    readFileSync(resolve(repoRoot, f), 'utf8').replaceAll('\r\n', '\n'),
  );
  assert.equal(texts[1], texts[0]);
  assert.equal(texts[2], texts[0]);
  const matchers = compileIgnoreFile(texts[0]);
  for (const path of [
    'terraform.tfvars',
    'envs/dev/terraform.tfvars',
    'envs/prod/cloud.auto.tfbackend',
    'envs/dev/prod.auto.tfvars',
    'envs/dev/prod.auto.tfvars.json',
    'bootstrap/x.auto.tfvars',
    '.env',
    'envs/dev/.env',
    'envs/dev/.env.local',
    'modules/api/key.pem',
    'a/b/c/signer.p12',
    'envs/dev/.terraform/providers/x',
    'envs/dev/terraform.tfstate',
    'envs/dev/terraform.tfstate.backup',
    'envs/dev/tfplan',
    'envs/dev/crash.log',
  ]) {
    assert.equal(isExcluded(matchers, path), true, `${path} must be excluded`);
  }
  for (const path of [
    'envs/dev/main.tf',
    'envs/dev/terraform.tfvars.example',
    'envs/dev/cloud.auto.tfbackend.example',
    'build/api-lambda.zip',
    'modules/api/openapi.yaml',
  ]) {
    assert.equal(isExcluded(matchers, path), false, `${path} must be uploaded`);
  }
});

test('no key, env file, auto tfvars file or real tfvars file under infra can be uploaded', () => {
  const matchers = compileIgnoreFile(
    readFileSync(resolve(repoRoot, 'infra/.terraformignore'), 'utf8'),
  );
  const leaked = listFiles(INFRA).filter(
    (path) => SENSITIVE_NAME.test(path) && !isExcluded(matchers, path),
  );
  assert.deepEqual(leaked, []);
});

test('the build folder travels with the upload because the remote run needs the Lambda zips', () => {
  const matchers = compileIgnoreFile(
    readFileSync(resolve(repoRoot, 'infra/.terraformignore'), 'utf8'),
  );
  assert.equal(isExcluded(matchers, 'build/api-lambda.zip'), false);
  assert.equal(isExcluded(matchers, 'build/passkit-lambda.zip'), false);
});
