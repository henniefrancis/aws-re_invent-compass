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
  test('check.yml triggers only on pull_request into main, with no push or schedule', () => {
    expect(checkYml).toMatch(/on:\s*\n\s*pull_request:/);
    expect(checkYml).toMatch(/branches:\s*\[main\]/);
    // No push or schedule trigger. (Match a trigger key at indented top level.)
    expect(/\n\s{2}push:/.test(checkYml)).toBe(false);
    expect(/\n\s{2}schedule:/.test(checkYml)).toBe(false);
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

  test('publish.yml scopes id-token: write to the job, not the workflow', () => {
    const body = nonCommentLines(publishYml);
    // The top-level permissions block grants only contents: read (no id-token).
    const topLevel = body.slice(0, body.indexOf('jobs:'));
    expect(/id-token:\s*write/.test(topLevel)).toBe(false);
    expect(topLevel).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    // The job carries id-token: write and the npm-publish environment.
    const jobSection = body.slice(body.indexOf('jobs:'));
    expect(jobSection).toMatch(/id-token:\s*write/);
    expect(jobSection).toMatch(/environment:\s*npm-publish/);
  });

  test('publish.yml runs npm ci and the full test suite before publishing', () => {
    // Search only actual run: step commands, not the comment header.
    const runCommands = publishYml.split(/\r?\n/).filter((l) => l.trimStart().startsWith('run:'));
    const joined = runCommands.join('\n');
    const ciAt = joined.indexOf('npm ci');
    const testAt = joined.indexOf('npm test');
    const publishAt = joined.indexOf('npm publish');
    expect(ciAt).toBeGreaterThan(-1);
    expect(testAt).toBeGreaterThan(ciAt);
    expect(publishAt).toBeGreaterThan(testAt);
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
      'npm run lint',
      'npx tsc -b',
      'npm test',
      'gitleaks/gitleaks-action',
      'node .github/scripts/audit-check.mjs',
      'terraform fmt -check',
      'tflint',
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

  test('check.yml guards Terraform and shellcheck behind a presence check', () => {
    expect(checkYml).toMatch(/steps\.tf\.outputs\.present == 'true'/);
    expect(checkYml).toMatch(/steps\.sh\.outputs\.present == 'true'/);
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
