// audit-check (foundation-contracts, S0). Run `npm audit --omit=dev --json` and
// fail on any high or critical advisory except a reviewed allowlist.
//
// The allowlist is recorded in ADR-026. It is empty since 4 November 2026: its
// three advisories (GHSA-86w9-cpqp-85rv in node-forge, GHSA-6h2x-m376-mqjq and
// GHSA-wr44-6hxh-3jwq in joi, all through passkit-generator) were fixed by
// node-forge 1.4.2 and the joi 17.13.9 override, and matched nothing. A future
// accepted advisory goes back on the list only with a new ADR-026 review.
//
// Any allowlisted IDs are printed as a warning on every run, so an accepted risk
// stays visible. Any high or critical advisory NOT on the allowlist fails the
// check. The audit JSON is parsed from `via` entries, whose url carries the GHSA
// id; string `via` entries (references to other packages) are ignored.
//
// This file contains no em dash or en dash.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { maybeRunCli } from './cli.mjs';

/**
 * The reviewed allowlist of advisory ids that are accepted for now (ADR-026).
 * Empty since 4 November 2026.
 *
 * @type {readonly string[]}
 */
export const ALLOWLIST = [];

/** Severities that fail the check unless allowlisted. */
const BLOCKING = new Set(['high', 'critical']);

/**
 * Run npm audit and return its parsed JSON report. Injectable runner for tests.
 *
 * @param {() => { stdout: string }} [runner]
 * @returns {unknown}
 */
export function runAudit(runner = defaultAuditRunner) {
  const result = runner();
  const { stdout, error, status } = result;

  // Fail closed: a spawn error means npm could not run at all.
  if (error) {
    throw new Error(`npm audit failed to spawn: ${error.message}`);
  }
  // Fail closed: npm audit writes the report to stdout even on a non-zero exit
  // (advisories present). Empty stdout means no report was produced.
  if (typeof stdout !== 'string' || stdout.trim().length === 0) {
    throw new Error(
      `npm audit produced no output${typeof status === 'number' ? ` (exit status ${status})` : ''}`,
    );
  }

  let report;
  try {
    report = JSON.parse(stdout);
  } catch (cause) {
    throw new Error(`npm audit output did not parse as JSON: ${cause.message}`);
  }

  // Fail closed: an "error" key is npm's own failure report (for example a
  // registry or lockfile error), not an audit result.
  if (report && typeof report === 'object' && 'error' in report) {
    const detail =
      report.error && typeof report.error === 'object' && 'summary' in report.error
        ? String(report.error.summary)
        : 'unknown error';
    throw new Error(`npm audit reported an error: ${detail}`);
  }

  // Fail closed: a real audit report always carries auditReportVersion and a
  // vulnerabilities object. Anything else is not a report we can trust.
  const hasShape =
    report &&
    typeof report === 'object' &&
    'auditReportVersion' in report &&
    report.vulnerabilities !== undefined &&
    report.vulnerabilities !== null &&
    typeof report.vulnerabilities === 'object';
  if (!hasShape) {
    throw new Error('npm audit output was not a recognised audit report');
  }

  return report;
}

/** The npm audit arguments, shared by every invocation. */
const AUDIT_ARGS = ['audit', '--omit=dev', '--json'];

/**
 * Resolve the command and arguments that run npm audit WITHOUT a shell, so there
 * is no command-injection surface and no DEP0190 warning. npm is a JavaScript CLI,
 * so it is run through the Node binary:
 *   - if npm_execpath is set (npm sets it for scripts), run node with that path;
 *   - otherwise run node with the npm-cli.js that ships with the node binary: next
 *     to it on Windows (<dir>/node_modules/npm), or in the sibling lib folder on
 *     Linux and macOS (<dir>/../lib/node_modules/npm). The first that exists wins;
 *     when neither exists the Windows path is returned and the spawn fails closed.
 * Pure and parameterised (exists is injectable) so every branch is tested.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string} execPath the path to the node binary (process.execPath)
 * @param {(path: string) => boolean} [exists] file existence check
 * @returns {{ command: string, args: string[] }}
 */
export function resolveNpmCommand(env, execPath, exists = existsSync) {
  const npmExecPath = env.npm_execpath;
  if (npmExecPath !== undefined && npmExecPath.length > 0) {
    return { command: execPath, args: [npmExecPath, ...AUDIT_ARGS] };
  }
  const nodeDir = dirname(execPath);
  const candidates = [
    join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  const cliPath = candidates.find((candidate) => exists(candidate)) ?? candidates[0];
  return { command: execPath, args: [cliPath, ...AUDIT_ARGS] };
}

/**
 * Default audit runner: npm audit over production dependencies as JSON, spawned
 * without a shell.
 */
function defaultAuditRunner() {
  const { command, args } = resolveNpmCommand(process.env, process.execPath);
  const r = spawnSync(command, args, { encoding: 'utf8' });
  // Surface the full result so runAudit can fail closed on a spawn error, a
  // non-zero exit with no output, or an unrecognised report. npm audit exits
  // non-zero when advisories exist, but the JSON is still on stdout in that case.
  return { stdout: r.stdout, error: r.error, status: r.status };
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
 * @param {readonly string[]} [allowlist] the accepted advisory ids (ADR-026)
 * @returns {{ ok: boolean, blocking: Array<{id: string, severity: string, title: string}>, allowlisted: readonly string[] }}
 */
export function evaluate(report, allowlist = ALLOWLIST) {
  const advisories = extractAdvisories(report);
  const allowSet = new Set(allowlist);
  // Any high or critical advisory that is not allowlisted blocks the check.
  const blocking = advisories.filter((a) => BLOCKING.has(a.severity) && !allowSet.has(a.id));
  return { ok: blocking.length === 0, blocking, allowlisted: allowlist };
}

/**
 * Pure CLI driver: run the audit, evaluate the policy, and return the exit code
 * plus the lines to print. Always prints the allowlisted ids as a warning, or
 * says that none are allowlisted.
 *
 * @param {object} [options]
 * @param {() => { stdout: string }} [options.runner]
 * @param {readonly string[]} [options.allowlist]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export async function runCli({ runner, allowlist = ALLOWLIST } = {}) {
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

  const { ok, blocking, allowlisted } = evaluate(report, allowlist);

  let stdout =
    allowlisted.length > 0
      ? `audit-check: allowlisted advisories (accepted, ADR-026): ${allowlisted.join(', ')}\n`
      : 'audit-check: no allowlisted advisories (ADR-026 list is empty)\n';
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
