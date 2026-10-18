// Builds the self-contained package into `dist/` (QA H2, security M1).
//
// The server and the scan worker are each bundled into one ES module file with esbuild. Everything
// is bundled (the contracts, the core modules, the MCP SDK, zod and the rest) except
// `@napi-rs/keyring`, a native module that cannot be bundled and is declared as a dependency. The
// files the program reads at run time are copied next to the bundles: the venue list, the sample
// repo and the simulated fixtures. `dist/tsc` holds the type check output and is left alone.
//
//   node scripts/build.mjs
//
// `buildPackage` is exported so the packaging smoke test can build before it packs.

import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));

/** What is built, relative to `dist/`. Anything else under `dist/` (such as `tsc`) is untouched. */
export const BUILT_PATHS = ['bin.js', 'scan-worker.js', 'data', 'sample-repo', 'fixtures'];

/** The ES module banner that gives bundled CommonJS code a working `require`. */
const BANNER =
  "import { createRequire as __compassCreateRequire } from 'node:module';\n" +
  'const require = __compassCreateRequire(import.meta.url);';

/** Builds `dist/` for the package at `packageDir` inside the repository at `repoDir`. */
export async function buildPackage({
  packageDir = join(here, '..'),
  repoDir = join(here, '..', '..', '..'),
} = {}) {
  const dist = join(packageDir, 'dist');
  await mkdir(dist, { recursive: true });
  for (const name of BUILT_PATHS) {
    await rm(join(dist, name), { recursive: true, force: true });
  }

  await build({
    entryPoints: {
      bin: join(packageDir, 'src', 'bin.ts'),
      'scan-worker': join(repoDir, 'packages', 'core', 'src', 'scanner', 'scan-worker.ts'),
    },
    outdir: dist,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    conditions: ['@compass/source'],
    external: ['@napi-rs/keyring'],
    banner: { js: BANNER },
    legalComments: 'none',
    logLevel: 'warning',
  });

  await cp(join(repoDir, 'data', 'venues.json'), join(dist, 'data', 'venues.json'));
  await cp(join(repoDir, 'fixtures', 'sample-repo'), join(dist, 'sample-repo'), {
    recursive: true,
  });
  await cp(join(repoDir, 'fixtures', 'api'), join(dist, 'fixtures', 'api'), { recursive: true });
  await cp(join(repoDir, 'fixtures', 'synthetic'), join(dist, 'fixtures', 'synthetic'), {
    recursive: true,
    filter: (source) => !source.endsWith('.ts'),
  });
  return dist;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildPackage();
}
