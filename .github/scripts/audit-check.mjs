// audit-check (foundation-contracts, S0). Run `npm audit --omit=dev --json` and
// fail on any high or critical advisory except a reviewed allowlist.
//
// The allowlist is recorded in ADR-026 (written by the integrator). It covers
// three advisories reaching the project only through passkit-generator (S5's
// Apple Wallet library), which the owner accepts for now:
//   GHSA-86w9-cpqp-85rv  node-forge: signature verification not used by passkit-generator
//   GHSA-6h2x-m376-mqjq  joi (via passkit-generator): input is pre-validated by PassFields
//   GHSA-wr44-6hxh-3jwq  joi (via passkit-generator): input is pre-validated by PassFields
//
// The allowlisted IDs are printed as a warning on every run, so an accepted risk
// stays visible. Any high or critical advisory NOT on the allowlist fails the
// check. The audit JSON is parsed from `via` entries, whose url carries the GHSA
// id; string `via` entries (references to other packages) are ignored.
//
// This file contains no em dash or en dash.

import { spawnSync } from 'node:child_process';
import { maybeRunCli } from './cli.mjs';

/**
 * The reviewed allowlist of advisory ids that are accepted for now (ADR-026).
 */
export const ALLOWLIST = ['GHSA-86w9-cpqp-85rv', 'GHSA-6h2x-m376-mqjq', 'GHSA-wr44-6hxh-3jwq'];

const ALLOW_SET = new Set(ALLOWLIST);

/** Severities that fail the check unless allowlisted. */
const BLOCKING = new Set(['high', 'critical']);

/**
 * Run npm audit and return its parsed JSON report. Injectable runner for tests.
 *
 * @param {() => { stdout: string }} [runner]
 * @returns {unknown}
 */
export function runAudit(runner = defaultAuditRunner) {
  const { stdout } = runner();
  // A missing or empty stdout (no report produced, or the process failed to
  // spawn) parses as an empty report.
  return JSON.parse(stdout ? stdout : '{}');
}

/** Default audit runner: npm audit over production dependencies as JSON. */
function defaultAuditRunner() {
  const r = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  // npm audit exits non-zero when advisories exist; the JSON is still on stdout.
  return { stdout: r.stdout };
}

/**
 * Extract every advisory (id, severity) from an audit report's vulnerabilities.
 * Only object `via` entries carry an advisory url; string entries are skipped.
 *
 * @param {unknown} report
 * @returns {Array<{ id: string, severity: string, title: string }>}
 */
export function extractAdvisories(report) {
  const advisories = new Map();
  const vulns =
    report && typeof report === 'object' && report.vulnerabilities ? report.vulnerabilities : {};
  for (const entry of Object.values(vulns)) {
    const via = entry && typeof entry === 'object' && Array.isArray(entry.via) ? entry.via : [];
    for (const item of via) {
      if (item && typeof item === 'object' && typeof item.url === 'string') {
        const id = item.url.split('/').pop();
        advisories.set(id, {
          id,
          severity: String(item.severity ?? 'unknown'),
          title: String(item.title ?? ''),
        });
      }
    }
  }
  return Array.from(advisories.values());
}

/**
 * Evaluate the audit report against the policy.
 *
 * @param {unknown} report
 * @returns {{ ok: boolean, blocking: Array<{id: string, severity: string, title: string}>, allowlisted: string[] }}
 */
export function evaluate(report) {
  const advisories = extractAdvisories(report);
  // Any high or critical advisory that is not allowlisted blocks the check.
  const blocking = advisories.filter((a) => BLOCKING.has(a.severity) && !ALLOW_SET.has(a.id));
  return { ok: blocking.length === 0, blocking, allowlisted: ALLOWLIST };
}

/**
 * Pure CLI driver: run the audit, evaluate the policy, and return the exit code
 * plus the lines to print. Always prints the allowlisted ids as a warning.
 *
 * @param {object} [options]
 * @param {() => { stdout: string }} [options.runner]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export async function runCli({ runner } = {}) {
  let report;
  try {
    report = runAudit(runner);
  } catch (error) {
    return {
      code: 1,
      stdout: '',
      stderr: `audit-check could not run npm audit: ${error.message}\n`,
    };
  }

  const { ok, blocking, allowlisted } = evaluate(report);

  let stdout = `audit-check: allowlisted advisories (accepted, ADR-026): ${allowlisted.join(', ')}\n`;
  if (ok) {
    stdout += 'audit-check ok: no non-allowlisted high or critical advisories\n';
    return { code: 0, stdout, stderr: '' };
  }

  let stderr = 'audit-check FAILED: non-allowlisted high or critical advisories found\n';
  for (const a of blocking) {
    stderr += `  ${a.id} (${a.severity})\n`;
  }
  return { code: 1, stdout, stderr };
}

await maybeRunCli({ runCli, argv1: process.argv[1], metaUrl: import.meta.url });
