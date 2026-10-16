// placeholder-safety (foundation-contracts, S0). Scan the three committed
// Compass API OpenAPI copies for forbidden account-specific tokens:
//   - a bare 12-digit run (\b\d{12}\b), which could be an AWS account id;
//   - the literal "arn:aws", which would be a hard-coded ARN.
//
// The Terraform placeholders ${api_lambda_invoke_arn} and
// ${passkit_lambda_invoke_arn} are the only ARN-like values allowed, and they
// contain no digits or the "arn:aws" literal, so they never trip the scan.
//
// On a hit the script reports the file and a redacted location (line and column
// only, never the matched text) and exits non-zero. Dependency free.

import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const thisDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(thisDir, '..', '..');

export const FILES = [
  resolve(repoRoot, 'contracts', 'compass-api.openapi.yaml'),
  resolve(repoRoot, 'packages', 'contracts', 'openapi.yaml'),
  resolve(repoRoot, 'infra', 'modules', 'api', 'openapi.yaml'),
];

// Forbidden patterns. Each is scanned per line so a hit can be reported by line
// and column without echoing the match.
const PATTERNS = [
  { name: 'twelve-digit run (possible account id)', re: /\b\d{12}\b/ },
  { name: 'hard-coded ARN', re: /arn:aws/i },
];

/**
 * Scan each file for the forbidden patterns.
 *
 * @param {object} [options]
 * @param {string[]} [options.files]
 * @returns {Promise<{ ok: boolean, findings: Array<{file: string, line: number, column: number, pattern: string}> }>}
 */
export async function placeholderSafety({ files = FILES } = {}) {
  const findings = [];
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const pattern of PATTERNS) {
        const match = pattern.re.exec(line);
        if (match) {
          findings.push({
            file,
            line: index + 1,
            column: match.index + 1,
            pattern: pattern.name,
          });
        }
      }
    });
  }
  return { ok: findings.length === 0, findings };
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  placeholderSafety()
    .then(({ ok, findings }) => {
      if (ok) {
        process.stdout.write(
          `placeholder safety ok: no forbidden tokens in ${FILES.length} files\n`,
        );
        return;
      }
      process.stderr.write('placeholder safety FAILED: forbidden tokens found\n');
      for (const f of findings) {
        process.stderr.write(
          `  ${relative(repoRoot, f.file)}:${f.line}:${f.column} (${f.pattern})\n`,
        );
      }
      process.exitCode = 1;
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
