import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// Smoke test for the repository save hook (foundation-contracts, S0).
//
// Validates: Requirements 8.1, 8.2, 8.3.
//
// Asserts the save hook triggers on TypeScript file save and drives the three
// actions: lint on the saved file, the owning-package tests (resolved by matching
// the path to a workspace folder), and the dash check. The hook is parsed as JSON
// and checked against the required schema fields.

const here = resolve(fileURLToPath(import.meta.url), '..');
const repoRoot = resolve(here, '..', '..', '..');
const hookPath = resolve(repoRoot, '.kiro', 'hooks', 'save-typescript-check.kiro.hook');

interface Hook {
  name: string;
  version: string;
  description?: string;
  when: { type: string; patterns?: string[] };
  then: { type: string; prompt?: string; command?: string };
}

const hook = JSON.parse(readFileSync(hookPath, 'utf8')) as Hook;

describe('Feature: foundation-contracts, save hook', () => {
  test('is a valid hook with the required schema fields', () => {
    expect(typeof hook.name).toBe('string');
    expect(typeof hook.version).toBe('string');
    expect(hook.when).toBeDefined();
    expect(hook.then).toBeDefined();
  });

  test('triggers on TypeScript file save', () => {
    expect(hook.when.type).toBe('fileEdited');
    expect(hook.when.patterns).toBeDefined();
    const patterns = hook.when.patterns ?? [];
    // Covers both .ts and .tsx saves.
    expect(patterns.some((p) => p.endsWith('*.ts'))).toBe(true);
    expect(patterns.some((p) => p.endsWith('*.tsx'))).toBe(true);
  });

  test('drives lint, the owning-package tests and the dash check', () => {
    expect(hook.then.type).toBe('askAgent');
    const prompt = (hook.then.prompt ?? '').toLowerCase();
    // 1) lint the saved file.
    expect(prompt).toContain('eslint');
    // 2) owning-package tests, resolved by matching the path to a workspace folder.
    expect(prompt).toContain('owning');
    expect(prompt).toContain('workspace');
    expect(prompt).toContain('test');
    // 3) the dash check.
    expect(prompt).toContain('dash-check.mjs');
  });

  test('does not edit files (it is a convenience check, not a mutator)', () => {
    const prompt = (hook.then.prompt ?? '').toLowerCase();
    expect(prompt).toContain('do not edit');
  });
});
