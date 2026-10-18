import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The monorepo root: the nearest parent whose package.json declares workspaces. */
export function repoRoot(): string {
  let current = resolve(dirname(fileURLToPath(import.meta.url)));
  for (;;) {
    const candidate = join(current, 'package.json');
    if (existsSync(candidate)) {
      const manifest = JSON.parse(readFileSync(candidate, 'utf8')) as { workspaces?: unknown };
      if (manifest.workspaces !== undefined) {
        return current;
      }
    }
    current = dirname(current);
  }
}
