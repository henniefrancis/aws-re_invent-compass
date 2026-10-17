// Budget_Check (showcase-site, Component 18).
//
// Measures the compressed JavaScript of the static build and fails when a budget is exceeded:
//   - the initial JavaScript, at most 250,000 bytes gzip;
//   - the Demo_Page route chunk together with the chunks only it loads, at most 150,000 bytes
//     gzip.
//
// It reads index.html (to see what the first page loads) and the esbuild metafile that the
// Angular builder writes as browser-stats.json. Only static imports count as "loaded with":
// a dynamic import is a separate, lazy chunk. No dependency: Node builtins only.
//
// Run from site/ after the build:  node scripts/check-budgets.mjs

import { readFile as readFileFs } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { maybeRunCli } from './cli.mjs';

export const LIMITS = Object.freeze({ initial: 250_000, demo: 150_000 });

/** The route chunk of the Demo_Page, as the builder names it in the metafile. */
export const DEMO_ENTRY_POINT = 'src/app/pages/demo/demo-page.component.ts';

/**
 * @typedef {{ path: string, kind: string }} OutputImport
 * @typedef {{ bytes?: number, entryPoint?: string, imports?: OutputImport[] }} OutputInfo
 * @typedef {Record<string, OutputInfo>} Outputs
 */

/** Size of a buffer after gzip at level 9. @param {Uint8Array} buffer */
export function gzipSize(buffer) {
  return gzipSync(buffer, { level: 9 }).length;
}

/**
 * The JavaScript files a page loads first: its module scripts and modulepreload links.
 * @param {string} indexHtml
 * @returns {string[]}
 */
export function initialFiles(indexHtml) {
  const files = new Set();
  for (const tag of indexHtml.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const text = tag[0];
    const isScript = tag[1].toLowerCase() === 'script' && /\btype\s*=\s*["']?module/i.test(text);
    const isPreload =
      tag[1].toLowerCase() === 'link' && /\brel\s*=\s*["']?modulepreload/i.test(text);
    const target = /\b(?:src|href)\s*=\s*["']?([^"'\s>]+)/i.exec(text)?.[1];
    if ((isScript || isPreload) && target !== undefined) {
      files.add(target);
    }
  }
  return [...files];
}

/**
 * Every file reachable from the start files through static imports (the start files included).
 * @param {Outputs} outputs
 * @param {readonly string[]} startFiles
 * @returns {string[]}
 */
export function closure(outputs, startFiles) {
  const seen = new Set();
  const queue = [...startFiles];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (!seen.has(file)) {
      seen.add(file);
      for (const imported of outputs[file]?.imports ?? []) {
        if (imported.kind === 'import-statement') {
          queue.push(imported.path);
        }
      }
    }
  }
  return [...seen];
}

/**
 * The files only the Demo_Page loads: its static closure minus the initial files.
 * @param {Outputs} outputs
 * @param {readonly string[]} initial the initial closure
 * @returns {string[]}
 */
export function demoFiles(outputs, initial) {
  const demoChunk = Object.keys(outputs).find(
    (file) => outputs[file]?.entryPoint === DEMO_ENTRY_POINT,
  );
  const known = new Set(initial);
  return demoChunk === undefined
    ? []
    : closure(outputs, [demoChunk]).filter((file) => !known.has(file));
}

/**
 * @param {{ initial: number, demo: number }} sizes compressed byte totals
 * @param {{ initial: number, demo: number }} limits
 * @returns {{ pass: boolean, lines: string[] }}
 */
export function evaluateBudgets(sizes, limits) {
  const rows = [
    { label: 'initial JavaScript', measured: sizes.initial, allowed: limits.initial },
    { label: 'Demo_Page route chunk', measured: sizes.demo, allowed: limits.demo },
  ];
  const lines = rows.map(
    ({ label, measured, allowed }) =>
      `${label}: measured ${String(measured)} bytes gzip, allowed ${String(allowed)} bytes gzip: ${
        measured <= allowed ? 'ok' : 'OVER BUDGET'
      }`,
  );
  return { pass: sizes.initial <= limits.initial && sizes.demo <= limits.demo, lines };
}

/**
 * @param {{ distDir: string, statsPath: string, readFile: (path: string) => Promise<Uint8Array> }} deps
 * distDir is the browser output folder; statsPath is the esbuild metafile (browser-stats.json).
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export async function runCli({ distDir, statsPath, readFile }) {
  const decoder = new TextDecoder();
  const indexHtml = decoder.decode(await readFile(join(distDir, 'index.html')));
  /** @type {{ outputs: Outputs }} */
  const stats = JSON.parse(decoder.decode(await readFile(statsPath)));
  const initial = closure(stats.outputs, initialFiles(indexHtml));
  const demo = demoFiles(stats.outputs, initial);
  const total = async (files) => {
    let sum = 0;
    for (const file of files) {
      sum += gzipSize(await readFile(join(distDir, file)));
    }
    return sum;
  };
  const result = evaluateBudgets(
    { initial: await total(initial), demo: await total(demo) },
    LIMITS,
  );
  const text = `${result.lines.join('\n')}\n`;
  return result.pass
    ? { code: 0, stdout: `budget check ok\n${text}`, stderr: '' }
    : { code: 1, stdout: '', stderr: `budget check failed\n${text}` };
}

const DEFAULT_DIST = join(import.meta.dirname, '..', 'dist', 'site', 'browser');

/** The default run: the Angular browser output folder next to this scripts folder. */
export async function runDefault(distDir = DEFAULT_DIST) {
  return runCli({
    distDir,
    statsPath: join(distDir, '..', 'browser-stats.json'),
    readFile: (path) => readFileFs(path),
  });
}

await maybeRunCli({ runCli: runDefault, argv1: process.argv[1], metaUrl: import.meta.url });
