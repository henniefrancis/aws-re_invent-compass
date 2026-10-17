// Builds dist/lambda/api.zip and dist/lambda/passkit.zip. Run it with:
//   node packages/pass-service/scripts/run.mjs packages/pass-service/scripts/build.ts
// It prints only the bundle names, sizes and SHA-256 values.
import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleLambdas } from '../src/build/bundle-lambdas.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(packageRoot, 'dist', 'lambda');
for (const report of await bundleLambdas({ outDir, esbuild, packageRoot })) {
  console.log(`${report.name}.zip ${report.bytes} bytes sha256 ${report.sha256}`);
}
