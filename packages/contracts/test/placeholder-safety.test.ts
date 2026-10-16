import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
// The scanner is an ESM .mjs under .github/scripts. Import it by relative path
// from this test file. It is not part of the coverage include set (only
// packages/*/src and spikes/src are), so this test checks behaviour without
// affecting coverage thresholds.
import {
  placeholderSafety,
} from '../../../.github/scripts/placeholder-safety.mjs';

// Unit tests for the placeholder and template-marker safety scanner
// (foundation-contracts, S0). The scanner protects the three byte-identical
// Compass API OpenAPI copies, which are Terraform templatefile() inputs: every
// dollar-brace and percent-brace marker in the file is evaluated, comments
// included, so the only markers allowed anywhere are the two Lambda invoke
// placeholders.

const here = resolve(fileURLToPath(import.meta.url), '..');
const repoRoot = resolve(here, '..', '..', '..');

describe('Feature: foundation-contracts, placeholder and template-marker safety', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ph-safety-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function scanContent(content: string): Promise<string[]> {
    const file = join(dir, 'copy.yaml');
    await writeFile(file, content, 'utf8');
    const { findings } = await placeholderSafety({ files: [file] });
    return findings.map((f) => f.pattern);
  }

  test('accepts the two allowed dollar-brace placeholders and ordinary text', async () => {
    const content = [
      "uri: '${api_lambda_invoke_arn}'",
      "uri: '${passkit_lambda_invoke_arn}'",
      'title: A normal line with no markers',
    ].join('\n');
    const { ok, findings } = await placeholderSafety({
      files: [await writeTemp(dir, content)],
    });
    expect(ok).toBe(true);
    expect(findings).toEqual([]);
  });

  test('flags a disallowed dollar-brace marker', async () => {
    const patterns = await scanContent('uri: ${some_other_variable}');
    expect(patterns).toContain('disallowed dollar-brace template marker');
  });

  test('flags a dollar-brace marker that appears inside a comment', async () => {
    const patterns = await scanContent('# example ${account_id} in a comment');
    expect(patterns).toContain('disallowed dollar-brace template marker');
  });

  test('flags an unterminated bare dollar-brace marker', async () => {
    const patterns = await scanContent('text with a bare ${ marker and no close');
    expect(patterns).toContain('unterminated dollar-brace template marker');
  });

  test('flags a percent-brace template marker anywhere', async () => {
    const patterns = await scanContent('%{ for x in list }item%{ endfor }');
    expect(patterns).toContain('percent-brace template marker');
  });

  test('still flags a twelve-digit run and a hard-coded ARN', async () => {
    const patterns = await scanContent(
      'account 123456789012 and arn:aws:lambda:us-east-1:fn',
    );
    expect(patterns).toContain('twelve-digit run (possible account id)');
    expect(patterns).toContain('hard-coded ARN');
  });

  test('the three committed Compass API copies pass the scan', async () => {
    const files = [
      resolve(repoRoot, 'contracts', 'compass-api.openapi.yaml'),
      resolve(repoRoot, 'packages', 'contracts', 'openapi.yaml'),
      resolve(repoRoot, 'infra', 'modules', 'api', 'openapi.yaml'),
    ];
    const { ok, findings } = await placeholderSafety({ files });
    expect(findings).toEqual([]);
    expect(ok).toBe(true);
  });
});

async function writeTemp(dir: string, content: string): Promise<string> {
  const file = join(dir, 'ok.yaml');
  await writeFile(file, content, 'utf8');
  return file;
}
