// Builds the two Lambda bundles (Requirement 1): each entry is bundled by esbuild into one ES
// module file, index.mjs, targeting Node.js 24, and zipped deterministically. The build fails
// when a zip reaches 5 MB. No source map, test file, artwork source or secret is included.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipDeterministic } from './deterministic-zip.js';

export const MAX_BUNDLE_BYTES = 5 * 1024 * 1024;
export const LAMBDA_NAMES = ['api', 'passkit'] as const;

export type LambdaName = (typeof LAMBDA_NAMES)[number];

export interface BundleReport {
  name: LambdaName;
  bytes: number;
  sha256: string;
}

export interface BundleOptions {
  outDir: string;
  esbuild: typeof import('esbuild');
  /** The package folder. Defaults to the folder this source file sits in. */
  packageRoot?: string;
}

/** Some bundled dependencies are CommonJS and call require. */
const REQUIRE_SHIM =
  "import { createRequire as __compassCreateRequire } from 'node:module'; const require = __compassCreateRequire(import.meta.url);";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function bundleLambdas(options: BundleOptions): Promise<BundleReport[]> {
  const root = options.packageRoot ?? DEFAULT_ROOT;
  mkdirSync(options.outDir, { recursive: true });
  const reports: BundleReport[] = [];
  for (const name of LAMBDA_NAMES) {
    const result = await options.esbuild.build({
      entryPoints: [path.join(root, 'src', 'lambda-entry', `${name}.ts`)],
      bundle: true,
      platform: 'node',
      target: 'node24',
      format: 'esm',
      minify: true,
      sourcemap: false,
      legalComments: 'none',
      conditions: ['@compass/source'],
      banner: { js: REQUIRE_SHIM },
      outfile: 'index.mjs',
      write: false,
      logLevel: 'silent',
    });
    const zip = zipDeterministic([{ path: 'index.mjs', data: result.outputFiles[0]!.contents }]);
    if (zip.length >= MAX_BUNDLE_BYTES) {
      throw new Error(`bundle ${name} is ${zip.length} bytes, the limit is ${MAX_BUNDLE_BYTES}`);
    }
    writeFileSync(path.join(options.outDir, `${name}.zip`), zip);
    reports.push({
      name,
      bytes: zip.length,
      sha256: createHash('sha256').update(zip).digest('hex'),
    });
  }
  return reports;
}
