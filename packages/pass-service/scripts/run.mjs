// Runs a TypeScript script of this package under Node without a build step. The sources
// import each other with .js specifiers (nodenext), which Node's type stripping cannot
// resolve, so the entry file is bundled with esbuild first (the same tool the Lambda build
// uses) and the bundle is imported from a temporary folder under node_modules/.cache, which
// is removed on exit. esbuild itself stays external (it is a native tool and cannot be bundled).
//
// Usage: node packages/pass-service/scripts/run.mjs <script.ts> [arguments]
import { build } from 'esbuild';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [entry, ...rest] = process.argv.slice(2);
if (entry === undefined) {
  console.error('usage: node scripts/run.mjs <script.ts> [arguments]');
  process.exit(2);
}
const entryPath = path.resolve(entry);
const result = await build({
  entryPoints: [entryPath],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  write: false,
  logLevel: 'warning',
  external: ['esbuild'],
  define: { 'import.meta.url': JSON.stringify(pathToFileURL(entryPath).href) },
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
const cache = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'node_modules',
  '.cache',
);
mkdirSync(cache, { recursive: true });
const folder = mkdtempSync(path.join(cache, 'compass-run-'));
process.on('exit', () => rmSync(folder, { recursive: true, force: true }));
const file = path.join(folder, 'main.mjs');
writeFileSync(file, result.outputFiles[0].text);
process.argv = [process.argv[0], entryPath, ...rest];
await import(pathToFileURL(file).href);
