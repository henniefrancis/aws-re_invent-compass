import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

// CTO L4: the Node types come from the tsconfig, not from a stray declaration file.
const root = new URL('../../', import.meta.url);

describe('Feature: pass-service, node types', () => {
  test('both tsconfigs ask for the node types and no node-types.d.ts exists', () => {
    for (const file of ['tsconfig.json', 'test/tsconfig.json']) {
      const config = JSON.parse(readFileSync(new URL(file, root), 'utf8')) as {
        compilerOptions: { types: string[] };
      };
      expect(config.compilerOptions.types).toEqual(['node']);
    }
    expect(existsSync(new URL('src/node-types.d.ts', root))).toBe(false);
  });
});
