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
import { fileURLToPath } from 'node:url';
import { maybeRunCli } from './cli.mjs';

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
  // A bare twelve-digit run, bounded by non-digits rather than word boundaries so
  // a run embedded in an identifier like "acct_123456789012" is still caught (an
  // underscore is a word character, so \b would miss it).
  { name: 'twelve-digit run (possible account id)', re: /(?<!\d)\d{12}(?!\d)/ },
  // A twelve-digit account id split into dash- or space-separated groups, for
  // example "1234-5678-9012" or "1234 5678 9012".
  {
    name: 'grouped twelve-digit run (possible account id)',
    re: /(?<!\d)\d{4}[-\s]\d{4}[-\s]\d{4}(?!\d)/,
  },
  { name: 'hard-coded ARN', re: /arn:aws/i },
  // Terraform percent-brace template markers (for loops and conditionals) must
  // never appear: these three copies are template inputs and must evaluate to
  // themselves everywhere except the two allowed dollar-brace placeholders.
  { name: 'percent-brace template marker', re: /%\{/ },
];

// The only dollar-brace template markers allowed anywhere in a copy (comments
// included), because Terraform templatefile() evaluates every dollar-brace
// marker in the file. Any other dollar-brace occurrence is a deploy-time hazard.
const ALLOWED_DOLLAR_BRACE = new Set(['${api_lambda_invoke_arn}', '${passkit_lambda_invoke_arn}']);

// Match a dollar-brace marker: ${ up to the next } (no nested braces needed here
// because the contract never nests them). Global so every occurrence on a line
// is checked.
const DOLLAR_BRACE = /\$\{[^}]*\}/g;

// Match a bare ${ that is not closed on the same line (an unterminated or
// malformed marker), so it is still caught even without a closing brace.
const BARE_DOLLAR_BRACE = /\$\{/g;

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

      // Flag any dollar-brace marker that is not one of the two allowed Lambda
      // invoke placeholders. Check the well-formed markers first.
      const seen = new Set();
      let m;
      DOLLAR_BRACE.lastIndex = 0;
      while ((m = DOLLAR_BRACE.exec(line)) !== null) {
        seen.add(m.index);
        if (!ALLOWED_DOLLAR_BRACE.has(m[0])) {
          findings.push({
            file,
            line: index + 1,
            column: m.index + 1,
            pattern: 'disallowed dollar-brace template marker',
          });
        }
      }
      // Also flag a bare ${ that did not form a well-formed marker above (for
      // example an unterminated "${" in text), which templatefile() still treats
      // as the start of an interpolation.
      let b;
      BARE_DOLLAR_BRACE.lastIndex = 0;
      while ((b = BARE_DOLLAR_BRACE.exec(line)) !== null) {
        if (!seen.has(b.index)) {
          findings.push({
            file,
            line: index + 1,
            column: b.index + 1,
            pattern: 'unterminated dollar-brace template marker',
          });
        }
      }
    });
  }
  return { ok: findings.length === 0, findings };
}

/**
 * Pure CLI driver: returns the exit code and the lines to print without touching
 * the process. Covers the ok, findings and error branches in-process.
 *
 * @param {object} [options]
 * @param {string[]} [options.files]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export async function runCli({ files = FILES } = {}) {
  try {
    const { ok, findings } = await placeholderSafety({ files });
    if (ok) {
      return {
        code: 0,
        stdout: `placeholder safety ok: no forbidden tokens in ${files.length} files\n`,
        stderr: '',
      };
    }
    let stderr = 'placeholder safety FAILED: forbidden tokens found\n';
    for (const f of findings) {
      stderr += `  ${relative(repoRoot, f.file)}:${f.line}:${f.column} (${f.pattern})\n`;
    }
    return { code: 1, stdout: '', stderr };
  } catch (error) {
    return { code: 1, stdout: '', stderr: `${error.message}\n` };
  }
}

await maybeRunCli({ runCli, argv1: process.argv[1], metaUrl: import.meta.url });
