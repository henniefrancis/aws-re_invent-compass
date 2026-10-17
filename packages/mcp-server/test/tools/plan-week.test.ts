import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { cp, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mcpTools, CommitmentSchema } from '@compass/contracts';
import { createNodeScanFs } from '@compass/core/scanner';
import { createNodeSpecFs, weekSpecDirectory, WEEK_SPEC_ENTRY } from '@compass/core/spec';
import { CompassError } from '../../src/ports/errors.js';
import { GITIGNORE_REASON, planWeekTool } from '../../src/tools/plan-week.js';
import type { ToolContext } from '../../src/server/types.js';
import { contextFor } from '../support/context.js';
import {
  buildCatalogView,
  repoRoot,
  syntheticCatalogView,
  wireSession,
} from '../support/fake-catalog.js';
import { createFakeRuntime } from '../support/fake-runtime.js';
import { MemorySpecFs } from '../support/memory-spec-fs.js';
import { connect, textOf } from '../support/connect.js';

const ROOT = join('/', 'workspace');
const GITIGNORE = join(ROOT, '.gitignore');

function setup(options: { elicit?: ToolContext['elicit']; gitignore?: string } = {}) {
  const specFs = new MemorySpecFs();
  specFs.directories.add(ROOT);
  if (options.gitignore !== undefined) specFs.files.set(GITIGNORE, options.gitignore);
  const fake = createFakeRuntime({ catalog: syntheticCatalogView(), specFs, cwd: ROOT });
  fake.rules.layoverSuggestions = {
    suggestions: [
      { start: '2026-12-01T20:00:00.000Z', end: '2026-12-01T20:30:00.000Z', reason: 'Lunch' },
    ],
  };
  const ctx = contextFor(fake, options.elicit === undefined ? {} : { elicit: options.elicit });
  return { fake, specFs, ctx };
}

const GOALS = { goals: ['identity access workshop'] };

describe('plan_week', () => {
  test('plans, writes the three files, states the folder and offers the gitignore line as text', async () => {
    const { fake, specFs, ctx } = setup();
    const outcome = await planWeekTool(GOALS, ctx);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const parsed = mcpTools.plan_week.output.parse(outcome.structured);
    expect(parsed.commitments.length).toBeGreaterThan(0);
    for (const commitment of parsed.commitments)
      expect(CommitmentSchema.safeParse(commitment).success).toBe(true);
    const dir = weekSpecDirectory(ROOT);
    expect(outcome.text).toContain(`The plan will be written to ${dir}.`);
    expect(outcome.text).toContain('Created requirements.md, design.md and tasks.md');
    expect(outcome.text).toContain(GITIGNORE_REASON);
    expect(outcome.text).toContain(`add this exact line:\n${WEEK_SPEC_ENTRY}`);
    expect([...specFs.files.keys()].sort()).toEqual(
      ['design.md', 'requirements.md', 'tasks.md'].map((n) => join(dir, n)),
    );
    expect(specFs.files.has(GITIGNORE)).toBe(false);
    expect(fake.events.writeCalls).toEqual([]);
    expect(fake.passes.writeCalls).toEqual([]);
    expect(fake.snapshot.writes).toHaveLength(1);
  });

  test('a re-run writes a dated file and shows the diff as labelled data', async () => {
    const { specFs, ctx } = setup();
    await planWeekTool(GOALS, ctx);
    const before = new Map(specFs.files);
    const second = await planWeekTool({ goals: ['data lakes'] }, ctx);
    expect(second.ok && second.text).toContain('left it unchanged and wrote week-2026-11-30.md');
    expect(second.ok && second.text).toContain(
      'Catalog data from the AWS Events API follows as JSON',
    );
    for (const [path, text] of before) expect(specFs.files.get(path)).toBe(text);
    expect(specFs.files.size).toBe(before.size + 1);
  });

  test('refuses maxPerDay outside 1 to 8 or not a whole number (L2) and defaults to 4', async () => {
    for (const maxPerDay of [0, 9, -1, 2.5, Number.NaN]) {
      const { ctx } = setup();
      await expect(planWeekTool({ maxPerDay }, ctx)).rejects.toMatchObject({
        code: 'MaxPerDayRange',
      });
    }
    const { ctx } = setup();
    const outcome = await planWeekTool({ ...GOALS, maxPerDay: 8, level: '300' }, ctx);
    expect(outcome.ok).toBe(true);
  });

  test('asks for sign-in and a cached catalog, and says what is missing when nothing was scanned', async () => {
    const { fake, ctx } = setup();
    fake.events.signedIn = false;
    await expect(planWeekTool({}, ctx)).rejects.toMatchObject({ code: 'NotSignedIn' });
    fake.events.signedIn = true;
    fake.events.catalogView = undefined;
    await expect(planWeekTool({}, ctx)).rejects.toMatchObject({ code: 'CatalogMissing' });
    const fresh = setup();
    const outcome = await planWeekTool({}, fresh.ctx);
    expect(outcome.ok && outcome.text).toContain('Run scan_repo first');
    expect(outcome.ok && outcome.text).toContain(
      '2 sessions were left out because their times are missing.',
    );
  });

  test('uses the scan result and its catalog labels', async () => {
    const { ctx, specFs } = setup();
    ctx.state.lastScan = {
      result: {
        services: [
          {
            key: 's3',
            displayName: 'Amazon S3',
            evidence: {
              terraformResources: 1,
              cdkConstructs: 0,
              cdkImports: 0,
              sdkImports: 0,
              sdkClients: 0,
              sdkCommands: 0,
              boto3Clients: 0,
              dependencyDeclarations: 0,
            },
            depth: 'building',
            suggestedLevel: 300,
            reasoning: 'x',
          },
          {
            key: 'iam',
            displayName: 'AWS IAM',
            evidence: {
              terraformResources: 0,
              cdkConstructs: 0,
              cdkImports: 0,
              sdkImports: 1,
              sdkClients: 0,
              sdkCommands: 0,
              boto3Clients: 0,
              dependencyDeclarations: 0,
            },
            depth: 'exploring',
            reasoning: 'y',
          },
          {
            key: 'sqs',
            displayName: 'Amazon SQS',
            evidence: {
              terraformResources: 0,
              cdkConstructs: 0,
              cdkImports: 0,
              sdkImports: 1,
              sdkClients: 0,
              sdkCommands: 0,
              boto3Clients: 0,
              dependencyDeclarations: 0,
            },
            depth: 'exploring',
            suggestedLevel: 100,
            reasoning: 'z',
          },
        ],
        unmappedCount: 0,
        filesRead: 1,
        truncated: false,
        pythonAnalysed: false,
        skipped: {
          excludedDirectory: 0,
          gitignored: 0,
          tooLarge: 0,
          binary: 0,
          symlink: 0,
          unsupportedType: 0,
        },
      },
      taxonomy: [
        { key: 's3', labels: ['storage'], inCatalog: true },
        { key: 'iam', labels: ['security'], inCatalog: true },
      ],
      root: ROOT,
    };
    const outcome = await planWeekTool({}, ctx);
    expect(outcome.ok).toBe(true);
    expect(specFs.files.get(join(weekSpecDirectory(ROOT), 'requirements.md'))).toContain(
      '"Amazon S3"',
    );
    expect(outcome.ok && outcome.text).not.toContain('Run scan_repo first');
  });

  test('a missing workspace folder is refused and nothing is written', async () => {
    const { fake, ctx } = setup();
    const specFs = new MemorySpecFs();
    const missing = createFakeRuntime({ catalog: syntheticCatalogView(), specFs, cwd: ROOT });
    await expect(planWeekTool(GOALS, contextFor(missing))).rejects.toThrow();
    expect(specFs.calls).toEqual([]);
    expect(fake.events.writeCalls).toEqual([]);
    expect(ctx.runtime.cwd).toBe(ROOT);
  });

  test('a symbolic link in the spec path is refused', async () => {
    const { specFs, ctx } = setup();
    specFs.links.add(join(ROOT, '.kiro'));
    await expect(planWeekTool(GOALS, ctx)).rejects.toMatchObject({ name: 'SpecWriteRefusedError' });
    expect(specFs.calls.filter((c) => c.method === 'createExclusive')).toEqual([]);
  });

  test('says when the folder is already ignored', async () => {
    const { ctx } = setup({ gitignore: `${WEEK_SPEC_ENTRY}\n` });
    const outcome = await planWeekTool(GOALS, ctx);
    expect(outcome.ok && outcome.text).toContain('already keeps the plan out of version control');
  });
});

describe('plan_week with elicitation', () => {
  function elicitWith(answers: {
    folder: 'accept' | 'decline' | 'cancel';
    gitignore: 'accept' | 'decline' | 'cancel';
  }) {
    const asked: string[] = [];
    const elicit: NonNullable<ToolContext['elicit']> = (question) => {
      asked.push(question.message);
      return Promise.resolve(
        question.message.includes('.gitignore') ? answers.gitignore : answers.folder,
      );
    };
    return { asked, elicit };
  }

  test('asks to confirm the absolute folder, then the gitignore question, and adds the line on accept', async () => {
    const { asked, elicit } = elicitWith({ folder: 'accept', gitignore: 'accept' });
    const { specFs, ctx } = setup({ elicit, gitignore: 'node_modules/\n' });
    const outcome = await planWeekTool(GOALS, ctx);
    expect(asked[0]).toContain(weekSpecDirectory(ROOT));
    expect(asked[1]).toContain(GITIGNORE_REASON);
    expect(specFs.files.get(GITIGNORE)).toBe(`node_modules/\n${WEEK_SPEC_ENTRY}\n`);
    expect(outcome.ok && outcome.text).toContain(`Added ${WEEK_SPEC_ENTRY} to .gitignore.`);
  });

  test('declining the folder writes nothing and asks nothing more', async () => {
    for (const folder of ['decline', 'cancel'] as const) {
      const { asked, elicit } = elicitWith({ folder, gitignore: 'accept' });
      const { specFs, ctx } = setup({ elicit });
      const outcome = await planWeekTool(GOALS, ctx);
      expect(asked).toHaveLength(1);
      expect(specFs.calls).toEqual([]);
      expect(outcome.ok && outcome.text).toContain('Nothing was written');
    }
  });

  test('creates a missing .gitignore on accept and reports an already listed entry', async () => {
    const { elicit } = elicitWith({ folder: 'accept', gitignore: 'accept' });
    const { specFs, ctx } = setup({ elicit });
    await planWeekTool(GOALS, ctx);
    expect(specFs.files.get(GITIGNORE)).toBe(`${WEEK_SPEC_ENTRY}\n`);
    const listed = setup({ elicit, gitignore: `${WEEK_SPEC_ENTRY}\n!${WEEK_SPEC_ENTRY}\n` });
    const outcome = await planWeekTool(GOALS, listed.ctx);
    expect(outcome.ok && outcome.text).toContain('already lists the plan folder');
  });

  test('a long existing plan gives a shortened diff', async () => {
    const { elicit } = elicitWith({ folder: 'accept', gitignore: 'decline' });
    const { specFs, ctx } = setup({ elicit });
    const dir = weekSpecDirectory(ROOT);
    specFs.directories.add(dir);
    for (const name of ['requirements.md', 'design.md', 'tasks.md']) {
      specFs.files.set(
        join(dir, name),
        Array.from({ length: 500 }, (_, i) => `old line ${i}`).join('\n'),
      );
    }
    const outcome = await planWeekTool(GOALS, ctx);
    expect(outcome.ok && outcome.text).toContain('(shortened)');
  });

  test('says nothing about missing times when every session has them', async () => {
    const specFs = new MemorySpecFs();
    specFs.directories.add(ROOT);
    const catalog = buildCatalogView([wireSession('only', { services: ['storage'] })]);
    const fake = createFakeRuntime({ catalog, specFs, cwd: ROOT });
    const outcome = await planWeekTool(GOALS, contextFor(fake));
    expect(outcome.ok && outcome.text).not.toContain('left out because their times are missing');
  });

  test('a symbolic link .gitignore is reported and not changed', async () => {
    const { elicit } = elicitWith({ folder: 'accept', gitignore: 'accept' });
    const { specFs, ctx } = setup({ elicit, gitignore: 'x\n' });
    specFs.links.add(GITIGNORE);
    const outcome = await planWeekTool(GOALS, ctx);
    expect(outcome.ok && outcome.text).toContain('cannot be written safely');
    expect(specFs.files.get(GITIGNORE)).toBe('x\n');
  });

  test('another gitignore write failure is not swallowed', async () => {
    const { elicit } = elicitWith({ folder: 'accept', gitignore: 'accept' });
    const { specFs, ctx } = setup({ elicit, gitignore: 'x\n' });
    specFs.appendText = () => Promise.reject(new CompassError('Server'));
    await expect(planWeekTool(GOALS, ctx)).rejects.toMatchObject({ code: 'Server' });
  });
});

// Feature: compass-power, Property 25: .gitignore changes only on an explicit accept
describe('Property 25: .gitignore changes only on an explicit accept', () => {
  test('exactly when the outcome is accept, with the reason and line otherwise', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<'accept' | 'decline' | 'cancel' | 'none'>(
          'accept',
          'decline',
          'cancel',
          'none',
        ),
        fc.option(fc.constantFrom('', 'node_modules/\n', 'dist\n*.log'), { nil: undefined }),
        async (outcome, original) => {
          const elicit: ToolContext['elicit'] =
            outcome === 'none'
              ? undefined
              : (question) =>
                  Promise.resolve(question.message.includes('.gitignore') ? outcome : 'accept');
          const { specFs, ctx } = setup({
            ...(elicit === undefined ? {} : { elicit }),
            ...(original === undefined ? {} : { gitignore: original }),
          });
          const result = await planWeekTool(GOALS, ctx);
          const after = specFs.files.get(GITIGNORE);
          const changed = after !== original;
          expect(changed).toBe(outcome === 'accept');
          if (!changed && result.ok) {
            expect(result.text).toContain(GITIGNORE_REASON);
            expect(result.text).toContain(WEEK_SPEC_ENTRY);
          }
        },
      ),
      { numRuns: 40 },
    );
  }, 120000);
});

describe('plan_week on the real file system', () => {
  test('scans a temporary copy of the sample repo, plans and writes with real files', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'compass-plan-'));
    try {
      await cp(join(repoRoot(), 'fixtures', 'sample-repo'), temp, { recursive: true });
      const fake = createFakeRuntime({
        catalog: syntheticCatalogView(),
        scanFs: createNodeScanFs(),
        specFs: createNodeSpecFs(),
        cwd: tmpdir(),
      });
      const connection = await connect(fake.runtime);
      await connection.call('scan_repo', { path: temp });
      const result = await connection.call('plan_week', { goals: ['workshop'] });
      expect(result.isError).toBeUndefined();
      const dir = weekSpecDirectory(await realpath(temp));
      expect((await readdir(dir)).sort()).toEqual(['design.md', 'requirements.md', 'tasks.md']);
      expect(textOf(result)).toContain(dir);
      expect(await readFile(join(dir, 'design.md'), 'utf8')).toContain(
        'All times are in America/Los_Angeles.',
      );
      await connection.close();
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }, 60000);
});
