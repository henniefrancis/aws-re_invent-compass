// Builds the self-contained package into `dist/` (QA H2, security M1).
//
// The server and the scan worker are each bundled into one ES module file with esbuild. Everything
// is bundled (the contracts, the core modules, the MCP SDK, zod and the rest) except
// `@napi-rs/keyring`, a native module that cannot be bundled and is declared as a dependency. The
// files the program reads at run time are copied next to the bundles: the venue list, the sample
// repo and the simulated fixtures. `dist/tsc` holds the type check output and is left alone.
//
// Licences (CTO final review, task 57): the repository `LICENSE` and `NOTICE` are copied into the
// package root, and `THIRD-PARTY-NOTICES.txt` is written from the esbuild metafile with the name,
// version, licence and full licence text of every bundled third-party package.
//
//   node scripts/build.mjs
//
// `buildPackage` is exported so the packaging smoke test can build before it packs.

import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));

/** What is built, relative to `dist/`. Anything else under `dist/` (such as `tsc`) is untouched. */
export const BUILT_PATHS = [
  'bin.js',
  'scan-worker.js',
  'github-scan-worker.js',
  'data',
  'sample-repo',
  'fixtures',
];

/** Files copied from the repository root into the package root. Git ignores the copies. */
export const LEGAL_FILES = ['LICENSE', 'NOTICE'];

/** The notices file written into the package root. Git ignores it. */
export const NOTICES_FILE = 'THIRD-PARTY-NOTICES.txt';

/** Licence file names a package may ship (LICENSE, LICENCE, COPYING, with or without extension). */
const LICENSE_NAME = /^(?:licen[cs]e|copying)(?:[.-][a-z0-9.-]+)?$/i;

/** The ES module banner that gives bundled CommonJS code a working `require`. */
const BANNER =
  "import { createRequire as __compassCreateRequire } from 'node:module';\n" +
  'const require = __compassCreateRequire(import.meta.url);';

/**
 * The third-party packages in an esbuild metafile: the package directory (relative to the
 * repository) of every input under `node_modules`, except the workspace packages `@compass/*`.
 */
export function bundledPackageDirs(metafile) {
  const dirs = new Set();
  for (const input of Object.keys(metafile.inputs)) {
    const parts = input.split('\\').join('/').split('/');
    const at = parts.lastIndexOf('node_modules');
    if (at === -1) {
      continue;
    }
    const scoped = parts[at + 1]?.startsWith('@') === true;
    const name = parts.slice(at + 1, at + (scoped ? 3 : 2)).join('/');
    if (!name.startsWith('@compass/')) {
      dirs.add(parts.slice(0, at + 1 + (scoped ? 2 : 1)).join('/'));
    }
  }
  return [...dirs];
}

/** Reads one package's name, version, licence field and licence file texts. */
async function describePackage(repoDir, dir) {
  const root = resolve(repoDir, dir);
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const names = (await readdir(root)).filter((name) => LICENSE_NAME.test(name)).sort();
  const texts = [];
  for (const name of names) {
    texts.push((await readFile(join(root, name), 'utf8')).trim());
  }
  const license =
    typeof manifest.license === 'string' ? manifest.license : (manifest.license?.type ?? 'unknown');
  return { name: manifest.name, version: manifest.version, license, texts };
}

/**
 * The text of `THIRD-PARTY-NOTICES.txt`: one section per bundled package, de-duplicated by
 * name and version and sorted. A package that ships no licence file gets a plain line saying so.
 */
export async function buildNotices(metafile, repoDir) {
  const found = new Map();
  for (const dir of bundledPackageDirs(metafile)) {
    const info = await describePackage(repoDir, dir);
    found.set(`${info.name}@${info.version}`, info);
  }
  const sections = [...found.keys()].sort().map((key) => {
    const { name, version, license, texts } = found.get(key);
    const body =
      texts.length > 0 ? texts.join('\n\n') : 'No licence file was shipped with this package.';
    return `${name} ${version}\nLicense: ${license}\n\n${body}\n`;
  });
  const rule = `\n${'-'.repeat(72)}\n\n`;
  return (
    'THIRD-PARTY NOTICES\n\nreinvent-compass bundles the open source packages below. ' +
    `Each keeps its own licence.\n\n${found.size} packages.${rule}${sections.join(rule)}`
  );
}

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

  const { metafile } = await build({
    absWorkingDir: repoDir,
    metafile: true,
    entryPoints: {
      bin: join(packageDir, 'src', 'bin.ts'),
      'scan-worker': join(repoDir, 'packages', 'core', 'src', 'scanner', 'scan-worker.ts'),
      'github-scan-worker': join(
        repoDir,
        'packages',
        'core',
        'src',
        'github',
        'github-scan-worker.ts',
      ),
    },
    outdir: dist,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    conditions: ['@compass/source'],
    external: ['@napi-rs/keyring'],
    banner: { js: BANNER },
    // The notices file carries the full licence text of every bundled package, so the comments
    // inside the bundles are dropped: they would only be a second, partial copy.
    legalComments: 'none',
    logLevel: 'warning',
  });

  for (const name of LEGAL_FILES) {
    await cp(join(repoDir, name), join(packageDir, name));
  }
  await writeFile(join(packageDir, NOTICES_FILE), await buildNotices(metafile, repoDir));

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
