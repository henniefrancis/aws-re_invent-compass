// audit-check (foundation-contracts, S0). Run `npm audit --omit=dev --json` and
// fail on any high or critical advisory except a reviewed allowlist.
//
// The allowlist is recorded in ADR-026 (written by the integrator). It covers
// three advisories reaching the project only through passkit-generator (S5's
// Apple Wallet library), which the owner accepts for now:
//   GHSA-86w9-cpqp-85rv  node-forge: signature verification not used by passkit-generator
//   GHSA-6h2x-m376-mqjq  joi (via passkit-generator): dates bounded by PassFields and passed as Date objects (ADR-026 correction)
//   GHSA-wr44-6hxh-3jwq  joi (via passkit-generator): only fixed schemas and messages reach joi (ADR-026)
//
// The allowlisted IDs are printed as a warning on every run, so an accepted risk
// stays visible. Any high or critical advisory NOT on the allowlist fails the
// check. The audit JSON is parsed from `via` entries, whose url carries the GHSA
// id; string `via` entries (references to other packages) are ignored.
//
// This file contains no em dash or en dash.

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
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
 *   - otherwise run node with the npm-cli.js that ships next to the node binary.
 * Pure and parameterised so both branches are covered by tests.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string} execPath the path to the node binary (process.execPath)
 * @returns {{ command: string, args: string[] }}
 */
export function resolveNpmCommand(env, execPath) {
  const npmExecPath = env.npm_execpath;
  const cliPath =
    npmExecPath !== undefined && npmExecPath.length > 0
      ? npmExecPath
      : join(dirname(execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
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
