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
      'dist/data',
      'dist/sample-repo',
      'dist/fixtures',
      'README.md',
    ]);
    expect(manifest.scripts).toEqual({ build: 'node scripts/build.mjs' });
    expect(manifest.dependencies).toEqual({ '@napi-rs/keyring': '2.1.1' });
    expect(Object.keys(manifest.devDependencies as object).sort()).toEqual([
      '@compass/contracts',
      '@compass/core',
      '@modelcontextprotocol/sdk',
      'zod',
    ]);
    expect(manifest.engines).toEqual({ node: '>=24' });
    expect(manifest.private).toBe(true);
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
