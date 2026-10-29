import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { repoRoot } from '../support/fake-catalog.js';

const root = join(repoRoot(), 'packages', 'mcp-server');

describe('the package manifest and the entry file', () => {
  test('the bin, files and engines fields point at the built entry and Node 24', async () => {
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(manifest.name).toBe('reinvent-compass');
    expect(manifest.bin).toEqual({ 'reinvent-compass': 'dist/bin.js' });
    expect(manifest.files).toEqual([
      'dist/bin.js',
      'dist/scan-worker.js',
      'dist/github-scan-worker.js',
      'dist/data',
      'dist/sample-repo',
      'dist/fixtures',
      'README.md',
      'LICENSE',
      'NOTICE',
      'THIRD-PARTY-NOTICES.txt',
    ]);
    // CTO final review findings 1 and 2 (task 57): provenance needs the repository, and the
    // licence must be declared.
    expect(manifest.license).toBe('Apache-2.0');
    expect(manifest.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/henniefrancis/aws-re_invent-compass.git',
      directory: 'packages/mcp-server',
    });
    expect(manifest.scripts).toEqual({
      build: 'node scripts/build.mjs',
      prepack: 'node scripts/build.mjs',
    });
    expect(manifest.dependencies).toEqual({ '@napi-rs/keyring': '2.1.1' });
    expect(Object.keys(manifest.devDependencies as object).sort()).toEqual([
      '@compass/contracts',
      '@compass/core',
      '@modelcontextprotocol/sdk',
      'zod',
    ]);
    expect(manifest.engines).toEqual({ node: '>=24' });
    // The safety catch came off in the 0.1.0 release commit (task 53); only a tag publishes.
    expect(manifest.private).toBeUndefined();
    expect(manifest.version).toBe('0.1.0');
  });

  test('bin.ts starts with the shebang line and only passes the process values to main', async () => {
    const text = await readFile(join(root, 'src', 'bin.ts'), 'utf8');
    expect(text.startsWith('#!/usr/bin/env node\n')).toBe(true);
    const code = text
      .split('\n')
      .filter((line) => !line.startsWith('//') && !line.startsWith('#!'));
    expect(code.join('\n')).toContain('await main({');
    expect(code.join('\n')).not.toMatch(/process\.(platform|exit\(|cwd)/);
    expect(code.filter((line) => line.trim() !== '').length).toBeLessThan(12);
  });
});
