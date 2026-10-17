import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// Code review C1: a root .gitignore rule such as `secrets/` or `build/` silently hid whole
// source folders, so a clean checkout could not build. This guard reads the root .gitignore and
// refuses any source, test or script path that one of its simple rules would ignore.
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const repoRoot = path.resolve(packageRoot, '..', '..');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

/** The simple rules: a directory name (`secrets/`) or a file glob without a slash (`*.pem`). */
function rules(): { dirs: Set<string>; globs: RegExp[] } {
  const dirs = new Set<string>();
  const globs: RegExp[] = [];
  for (const raw of readFileSync(path.join(repoRoot, '.gitignore'), 'utf8').split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('!')) {
      continue;
    }
    if (line.endsWith('/') && !line.slice(0, -1).includes('/') && !line.includes('*')) {
      dirs.add(line.slice(0, -1));
    } else if (!line.includes('/')) {
      const source = line.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
      globs.push(new RegExp(`^${source}$`));
    }
  }
  return { dirs, globs };
}

describe('Feature: pass-service, tracked source paths', () => {
  test('no source, test or script path is hidden by a root .gitignore rule', () => {
    const { dirs, globs } = rules();
    expect(dirs.has('secrets')).toBe(true);
    expect(dirs.has('build')).toBe(true);
    const files = ['src', 'test', 'scripts'].flatMap((folder) =>
      walk(path.join(packageRoot, folder)),
    );
    expect(files.length).toBeGreaterThan(100);
    const hidden = files.filter((file) => {
      const segments = path.relative(packageRoot, file).split(path.sep);
      const directories = segments.slice(0, -1);
      const name = segments[segments.length - 1] ?? '';
      return directories.some((d) => dirs.has(d)) || globs.some((glob) => glob.test(name));
    });
    expect(hidden.map((file) => path.relative(packageRoot, file))).toEqual([]);
  });

  test('the folders that held credentials and bundling code have names no rule matches', () => {
    const { dirs } = rules();
    for (const folder of ['src/credentials', 'test/credentials', 'src/bundling', 'test/bundling']) {
      expect(dirs.has(path.basename(folder))).toBe(false);
      expect(readdirSync(path.join(packageRoot, folder)).length).toBeGreaterThan(0);
    }
  });
});
