import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// Workflow lint and parsed-structure tests (foundation-contracts, S0).
//
// Validates: Requirements 7.1, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11.
//
// Asserts, for the three workflow files, the correct triggers, the check.yml step
// order, that every `uses:` is pinned by a 40-hex commit SHA, and that check.yml
// and e2e.yml carry no push or schedule trigger (publish.yml is the one allowed
// push, and only on a v* tag). actionlint is run when present; when it is not
// installed the lint assertion is skipped (the parsed-structure assertions always
// run), so the test is hermetic on a machine without actionlint.

const here = resolve(fileURLToPath(import.meta.url), '..');
const repoRoot = resolve(here, '..', '..', '..');
const workflowsDir = resolve(repoRoot, '.github', 'workflows');

function readWorkflow(name: string): string {
  return readFileSync(resolve(workflowsDir, name), 'utf8');
}

const checkYml = readWorkflow('check.yml');
const e2eYml = readWorkflow('e2e.yml');
const publishYml = readWorkflow('publish.yml');
const dependabotYml = readFileSync(resolve(repoRoot, '.github', 'dependabot.yml'), 'utf8');

// Every `uses:` reference and the SHA it is pinned to.
function usesLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('uses:'));
}

describe('Feature: foundation-contracts, CI workflows', () => {
  test('check.yml triggers on pull_request into main and on push to develop only, with no schedule', () => {
    // ADR-018 amendment (20 October 2026): develop pushes run the check too.
    const text = checkYml.replaceAll('\r\n', '\n');
    const triggers = /\non:\n([\s\S]*?)\n(?=\S)/.exec(text)?.[1]?.trimEnd();
    expect(triggers).toBe(
      ['  pull_request:', '    branches: [main]', '  push:', '    branches: [develop]'].join('\n'),
    );
    // No schedule trigger. (Match a trigger key at indented top level.)
    expect(/\n\s{2}schedule:/.test(text)).toBe(false);
  });

  test('e2e.yml triggers only on workflow_dispatch', () => {
    expect(e2eYml).toMatch(/on:\s*\n\s*workflow_dispatch:/);
    expect(/\n\s{2}push:/.test(e2eYml)).toBe(false);
    expect(/\n\s{2}schedule:/.test(e2eYml)).toBe(false);
    expect(/\n\s{2}pull_request:/.test(e2eYml)).toBe(false);
  });

  test('publish.yml triggers only on a v* tag push', () => {
    expect(publishYml).toMatch(/on:\s*\n\s*push:\s*\n\s*tags:\s*\n\s*-\s*'v\*'/);
    // No branch push, pull_request or schedule.
    expect(/branches:/.test(publishYml)).toBe(false);
    expect(/\n\s{2}pull_request:/.test(publishYml)).toBe(false);
    expect(/\n\s{2}schedule:/.test(publishYml)).toBe(false);
    // Trusted publishing needs id-token: write.
    expect(publishYml).toMatch(/id-token:\s*write/);
    expect(publishYml).toMatch(/--provenance/);
  });

  // Only the non-comment lines of a workflow, so assertions never match prose in a
  // leading comment block.
  function nonCommentLines(text: string): string {
    return text
      .split(/\r?\n/)
      .filter((l) => !l.trimStart().startsWith('#'))
      .join('\n');
  }

  // The text of one job in publish.yml, from its `  <name>:` key to the next job or the end.
  function publishJob(name: string): string {
    const body = nonCommentLines(publishYml).replaceAll('\r\n', '\n');
    const start = body.indexOf(`\n  ${name}:\n`);
    expect(start, `job ${name} not found`).toBeGreaterThan(-1);
    const rest = body.slice(start + 1);
    const next = /\n {2}[\w-]+:\n/.exec(rest.slice(rest.indexOf('\n') + 1));
    return next === null ? rest : rest.slice(0, rest.indexOf('\n') + 1 + next.index);
  }

  test('publish.yml has a verify job without id-token or environment and a publish job that holds them', () => {
    const body = nonCommentLines(publishYml);
    // The top-level permissions block grants only contents: read (no id-token).
    const topLevel = body.slice(0, body.indexOf('jobs:'));
    expect(/id-token:\s*write/.test(topLevel)).toBe(false);
    expect(topLevel).toMatch(/permissions:\s*\n\s*contents:\s*read/);

    const verify = publishJob('verify');
    expect(/id-token/.test(verify)).toBe(false);
    expect(/environment:/.test(verify)).toBe(false);
    expect(verify).toMatch(/permissions:\s*\n\s*contents:\s*read\s*\n\s*steps:/);

    const publish = publishJob('publish');
    expect(publish).toMatch(/needs:\s*verify/);
    expect(publish).toMatch(/if:\s*startsWith\(github\.ref,\s*'refs\/tags\/v'\)/);
    expect(publish).toMatch(/id-token:\s*write/);
    expect(publish).toMatch(/environment:\s*npm-publish/);
  });

  test('publish.yml verify job runs npm ci, the type check, lint and tests before packing and uploading', () => {
    const verify = publishJob('verify');
    const order = [
      'npm ci',
      'npx tsc -b',
      'npm run lint',
      'npm test',
      'does not match version',
      'npm run build',
      'check-pack.mjs',
      'npm pack --workspace packages/mcp-server',
      'actions/upload-artifact@',
    ];
    let previous = -1;
    for (const marker of order) {
      const at = verify.indexOf(marker);
      expect(at, `missing in verify: ${marker}`).toBeGreaterThan(previous);
      previous = at;
    }
    expect(/npm publish/.test(verify)).toBe(false);
  });

  test('publish.yml publish job runs no repository code and publishes the downloaded tarball with provenance', () => {
    const publish = publishJob('publish');
    expect(/actions\/checkout/.test(publish)).toBe(false);
    expect(/npm (ci|install|run|test)\b/.test(publish)).toBe(false);
    expect(/npx /.test(publish)).toBe(false);
    expect(publish).toMatch(/registry-url:\s*https:\/\/registry\.npmjs\.org/);
    const downloadAt = publish.indexOf('actions/download-artifact@');
    const publishAt = publish.indexOf('npm publish "${tarball}" --provenance --access public');
    expect(downloadAt).toBeGreaterThan(-1);
    expect(publishAt).toBeGreaterThan(downloadAt);
    expect(/--workspace/.test(publish)).toBe(false);
    // npm must support trusted publishing (11.5.1 or later), checked before the publish.
    expect(publish.indexOf('11.5.1')).toBeGreaterThan(-1);
    expect(publish.indexOf('11.5.1')).toBeLessThan(downloadAt);
  });

  test('check.yml and e2e.yml checkouts do not persist credentials', () => {
    expect(checkYml).toMatch(/persist-credentials:\s*false/);
    expect(e2eYml).toMatch(/persist-credentials:\s*false/);
  });

  test('check.yml checks out full history for gitleaks', () => {
    expect(checkYml).toMatch(/fetch-depth:\s*0/);
  });

  test('every action is pinned by a 40-hex commit SHA', () => {
    for (const text of [checkYml, e2eYml, publishYml]) {
      const uses = usesLines(text);
      expect(uses.length).toBeGreaterThan(0);
      for (const line of uses) {
        // uses: owner/repo@<40-hex-sha> optionally followed by a version comment.
        expect(line, `action not pinned by SHA: ${line}`).toMatch(
          /^uses:\s+[\w.-]+\/[\w.-]+@[0-9a-f]{40}(\s+#.*)?$/,
        );
      }
    }
  });

  test('check.yml runs the build plan 11.1 steps in order', () => {
    // The ordered run/uses markers that must appear in this relative order.
    const order = [
      'npm ci',
      'npm run check:hash',
      'npm run check:placeholders',
      'npm run check:dash',
      'npm run format:check',
      'npx tsc -b',
      'npm run lint',
      'npm test',
      'npm run test:site',
      'npm run build:site',
      'gitleaks/gitleaks-action',
      'node .github/scripts/audit-check.mjs',
      'terraform fmt -check',
      'tflint --recursive',
      'node --test "infra/tests/static/',
      'scan-type: fs',
      'scan-type: config',
      'action-shellcheck',
    ];
    let lastIndex = -1;
    for (const marker of order) {
      const at = checkYml.indexOf(marker);
      expect(at, `missing or out-of-order step: ${marker}`).toBeGreaterThan(lastIndex);
      lastIndex = at;
    }
  });

  test('check.yml runs Terraform, the infra static tests and shellcheck unconditionally', () => {
    // infra/ and scripts/ always exist now (S6 merged), so the early presence guards are gone.
    expect(checkYml).not.toMatch(/outputs\.present/);
    expect(checkYml).toMatch(/terraform -chdir=/);
    expect(checkYml).toContain('node --test "infra/tests/static/*.test.mjs"');
  });

  test('dependabot.yml is monthly with an open-pull-requests-limit of 0', () => {
    expect(dependabotYml).toMatch(/version:\s*2/);
    expect(dependabotYml).toMatch(/interval:\s*monthly/);
    expect(dependabotYml).toMatch(/open-pull-requests-limit:\s*0/);
    // No pull request is opened before 1 November: the limit is 0 for every ecosystem.
    const limits = dependabotYml.match(/open-pull-requests-limit:\s*(\d+)/g) ?? [];
    expect(limits.length).toBeGreaterThanOrEqual(1);
    for (const l of limits) {
      expect(l).toMatch(/:\s*0$/);
    }
  });

  test('actionlint passes when available (skipped when not installed)', () => {
    let actionlintPath: string | undefined;
    try {
      actionlintPath = execFileSync(process.platform === 'win32' ? 'where' : 'which', [
        'actionlint',
      ])
        .toString()
        .trim()
        .split(/\r?\n/)[0];
    } catch {
      actionlintPath = undefined;
    }
    if (actionlintPath === undefined || actionlintPath.length === 0) {
      // actionlint is not installed on this machine; the parsed-structure tests
      // above are the hermetic guarantee. CI runs actionlint in the pipeline.
      return;
    }
    // When present, actionlint must report no problems for the three workflows.
    const output = execFileSync(actionlintPath, ['-color=never'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(output.trim()).toBe('');
  });
});
