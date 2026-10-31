import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { repoRoot } from '../support/fake-catalog.js';

interface Metafile {
  inputs: Record<string, object>;
}
interface Build {
  bundledPackageDirs: (metafile: Metafile) => string[];
  buildNotices: (metafile: Metafile, repoDir: string) => Promise<string>;
}
const load = async (): Promise<Build> =>
  (await import(
    pathToFileURL(join(repoRoot(), 'packages', 'mcp-server', 'scripts', 'build.mjs')).href
  )) as Build;
const metafileOf = (...inputs: string[]): Metafile => ({
  inputs: Object.fromEntries(inputs.map((input) => [input, {}])),
});

describe('the third-party notices written by the build (CTO H2)', () => {
  test('picks the package folder of each node_modules input and skips workspace packages', async () => {
    const { bundledPackageDirs } = await load();
    const dirs = bundledPackageDirs(
      metafileOf(
        'packages/mcp-server/src/bin.ts',
        'node_modules/zod/v4/index.js',
        'node_modules/zod/v4/core.js',
        'node_modules/@scope/pkg/lib/a.js',
        'node_modules/@compass/core/src/index.ts',
        'node_modules/a/node_modules/b/index.js',
        'node_modules\\win\\index.js',
      ),
    );
    expect(dirs.sort()).toEqual([
      'node_modules/@scope/pkg',
      'node_modules/a/node_modules/b',
      'node_modules/win',
      'node_modules/zod',
    ]);
  });

  describe('with small fake packages', () => {
    let repo: string;
    beforeAll(async () => {
      repo = await mkdtemp(join(tmpdir(), 'compass-notices-'));
      const make = async (
        dir: string,
        manifest: object,
        files: Record<string, string> = {},
      ): Promise<void> => {
        await mkdir(join(repo, 'node_modules', dir), { recursive: true });
        await writeFile(join(repo, 'node_modules', dir, 'package.json'), JSON.stringify(manifest));
        for (const [name, text] of Object.entries(files)) {
          await writeFile(join(repo, 'node_modules', dir, name), text);
        }
      };
      await make(
        'beta',
        { name: 'beta', version: '2.0.0', license: 'MIT' },
        { LICENSE: 'B text\n' },
      );
      await make(
        'alpha',
        { name: 'alpha', version: '1.0.0', license: { type: 'ISC' } },
        { LICENCE: 'A one', 'COPYING.txt': 'A two', 'README.md': 'not a licence' },
      );
      await make('bare', { name: 'bare', version: '3.0.0' });
      await make(
        'nested/node_modules/beta',
        { name: 'beta', version: '2.0.0', license: 'MIT' },
        { LICENSE: 'B' },
      );
    });
    afterAll(async () => {
      await rm(repo, { recursive: true, force: true });
    });

    test('lists each name and version once, sorted, with licence texts or a clear line', async () => {
      const { buildNotices } = await load();
      const text = await buildNotices(
        metafileOf(
          'node_modules/beta/x.js',
          'node_modules/nested/node_modules/beta/y.js',
          'node_modules/bare/z.js',
          'node_modules/alpha/w.js',
        ),
        repo,
      );
      expect(text).toContain('3 packages.');
      const order = ['alpha 1.0.0', 'bare 3.0.0', 'beta 2.0.0'].map((name) => text.indexOf(name));
      expect(order).toEqual([...order].sort((a, b) => a - b));
      expect(order.every((at) => at > 0)).toBe(true);
      expect(text.match(/^beta 2\.0\.0$/gm)).toHaveLength(1);
      expect(text).toContain('alpha 1.0.0\nLicense: ISC\n\nA two\n\nA one\n');
      expect(text).toContain('bare 3.0.0\nLicense: unknown\n\nNo licence file was shipped');
      expect(text).not.toContain('not a licence');
    });
  });
});
