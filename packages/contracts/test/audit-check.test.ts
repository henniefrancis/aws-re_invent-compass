import { describe, expect, test } from 'vitest';
import { dirname, join } from 'node:path';
import {
  ALLOWLIST,
  resolveNpmCommand,
  runAudit,
  extractAdvisories,
  evaluate,
  runCli,
} from '../../../.github/scripts/audit-check.mjs';

// Tests for the audit allowlist check (foundation-contracts, S0, ADR-026).
//
// The check fails on any high or critical advisory whose GHSA id is not on the
// reviewed allowlist, prints the allowlisted ids as a warning on every run, and
// passes when the only high or critical advisories are allowlisted. The audit
// runner is injected so tests drive every branch with crafted reports and never
// depend on the live dependency tree.

// Build an audit report shaped like `npm audit --json` output.
function report(advisories: Array<{ id: string; severity: string }>): unknown {
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      somePackage: {
        name: 'somePackage',
        severity: 'high',
        via: [
          // A string via entry (reference to another package) is ignored.
          'anotherPackage',
          ...advisories.map((a) => ({
            source: 1,
            name: 'somePackage',
            title: `advisory ${a.id}`,
            url: `https://github.com/advisories/${a.id}`,
            severity: a.severity,
          })),
        ],
      },
    },
  };
}

const runnerFor = (adv: Array<{ id: string; severity: string }>) => () => ({
  stdout: JSON.stringify(report(adv)),
});

describe('Feature: foundation-contracts, audit-check', () => {
  test('the allowlist holds exactly the three reviewed advisories', () => {
    expect([...ALLOWLIST].sort()).toEqual(
      ['GHSA-6h2x-m376-mqjq', 'GHSA-86w9-cpqp-85rv', 'GHSA-wr44-6hxh-3jwq'].sort(),
    );
  });

  test('resolveNpmCommand runs node with npm_execpath when it is set', () => {
    const { command, args } = resolveNpmCommand(
      { npm_execpath: '/path/to/npm-cli.js' },
      '/usr/bin/node',
    );
    expect(command).toBe('/usr/bin/node');
    expect(args).toEqual(['/path/to/npm-cli.js', 'audit', '--omit=dev', '--json']);
  });

  test('resolveNpmCommand falls back to the npm-cli.js next to node when unset or empty', () => {
    const execPath = '/usr/bin/node';
    const expectedCli = join(dirname(execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');

    const unset = resolveNpmCommand({}, execPath);
    expect(unset.command).toBe(execPath);
    expect(unset.args).toEqual([expectedCli, 'audit', '--omit=dev', '--json']);

    // An empty string is treated the same as unset.
    const empty = resolveNpmCommand({ npm_execpath: '' }, execPath);
    expect(empty.args).toEqual([expectedCli, 'audit', '--omit=dev', '--json']);
  });

  test('resolveNpmCommand never requests a shell (no shell metacharacters in command)', () => {
    const { command } = resolveNpmCommand({ npm_execpath: 'x' }, '/usr/bin/node');
    // The command is always the node binary path, never "npm" run through a shell.
    expect(command).toBe('/usr/bin/node');
  });

  test('runAudit parses the injected runner output', () => {
    const parsed = runAudit(runnerFor([{ id: 'GHSA-xxxx', severity: 'low' }])) as {
      vulnerabilities: Record<string, unknown>;
    };
    expect(parsed.vulnerabilities.somePackage).toBeDefined();
  });

  test('runAudit treats empty stdout as an empty report', () => {
    const parsed = runAudit(() => ({ stdout: '' })) as { vulnerabilities?: unknown };
    expect(parsed).toEqual({});
  });

  test('extractAdvisories defaults a missing severity and title', () => {
    const advisories = extractAdvisories({
      vulnerabilities: {
        p: {
          via: [{ url: 'https://github.com/advisories/GHSA-nometa' }],
        },
      },
    });
    expect(advisories).toEqual([{ id: 'GHSA-nometa', severity: 'unknown', title: '' }]);
  });

  test('extractAdvisories reads object via entries and ignores string entries', () => {
    const advisories = extractAdvisories(
      report([
        { id: 'GHSA-aaaa', severity: 'high' },
        { id: 'GHSA-bbbb', severity: 'low' },
      ]),
    );
    expect(advisories.map((a) => a.id).sort()).toEqual(['GHSA-aaaa', 'GHSA-bbbb']);
  });

  test('extractAdvisories tolerates a report with no vulnerabilities', () => {
    expect(extractAdvisories({})).toEqual([]);
    expect(extractAdvisories(null)).toEqual([]);
    // A vulnerability whose via is not an array is skipped.
    expect(extractAdvisories({ vulnerabilities: { p: { via: 'not-an-array' } } })).toEqual([]);
    // A via object without a url is skipped.
    expect(extractAdvisories({ vulnerabilities: { p: { via: [{ severity: 'high' }] } } })).toEqual(
      [],
    );
  });

  test('evaluate passes when every high advisory is allowlisted', () => {
    const r = evaluate(
      report([
        { id: 'GHSA-86w9-cpqp-85rv', severity: 'high' },
        { id: 'GHSA-6h2x-m376-mqjq', severity: 'high' },
        { id: 'GHSA-wr44-6hxh-3jwq', severity: 'moderate' },
        { id: 'GHSA-irrelevant', severity: 'low' },
      ]),
    );
    expect(r.ok).toBe(true);
    expect(r.blocking).toEqual([]);
  });

  test('evaluate fails on a non-allowlisted high advisory', () => {
    const r = evaluate(
      report([
        { id: 'GHSA-86w9-cpqp-85rv', severity: 'high' },
        { id: 'GHSA-new-high', severity: 'high' },
      ]),
    );
    expect(r.ok).toBe(false);
    expect(r.blocking.map((a) => a.id)).toEqual(['GHSA-new-high']);
  });

  test('evaluate fails on a non-allowlisted critical advisory', () => {
    const r = evaluate(report([{ id: 'GHSA-crit', severity: 'critical' }]));
    expect(r.ok).toBe(false);
    expect(r.blocking.map((a) => a.id)).toEqual(['GHSA-crit']);
  });

  test('runCli prints the allowlist and reports ok when only allowlisted advisories exist', async () => {
    const r = await runCli({
      runner: runnerFor([{ id: 'GHSA-86w9-cpqp-85rv', severity: 'high' }]),
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('allowlisted advisories (accepted, ADR-026)');
    expect(r.stdout).toContain('audit-check ok');
    for (const id of ALLOWLIST) {
      expect(r.stdout).toContain(id);
    }
  });

  test('runCli reports a non-zero code and lists blocking advisories', async () => {
    const r = await runCli({
      runner: runnerFor([{ id: 'GHSA-new-high', severity: 'high' }]),
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('audit-check FAILED');
    expect(r.stderr).toContain('GHSA-new-high');
    // Even on failure the allowlist warning is printed.
    expect(r.stdout).toContain('allowlisted advisories (accepted, ADR-026)');
  });

  test('runCli surfaces an error when npm audit cannot run', async () => {
    const r = await runCli({
      runner: () => {
        throw new Error('npm not found');
      },
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('could not run npm audit');
  });

  test('runAudit against the real tree returns a parseable report', () => {
    // No injected runner: exercises the default spawnSync path over the real
    // dependency tree. The result shape is asserted loosely so this does not
    // depend on the exact advisory set. Real npm audit can take a while.
    const parsed = runAudit() as { vulnerabilities?: unknown };
    expect(parsed).toBeTypeOf('object');
  }, 60000);
});
