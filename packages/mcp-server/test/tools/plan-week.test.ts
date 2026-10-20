import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mcpTools, CommitmentSchema } from '@compass/contracts';
import { createNodeScanFs } from '@compass/core/scanner';
import { createNodeSpecFs, weekSpecDirectory, WEEK_SPEC_ENTRY } from '@compass/core/spec';
import type { Commitment } from '@compass/contracts';
import { CompassError } from '../../src/ports/errors.js';
import type { ConnectionLine } from '../../src/ports/rules-port.js';
import { GITIGNORE_REASON, planWeekTool } from '../../src/tools/plan-week.js';
import type { ToolContext } from '../../src/server/types.js';
import { contextFor } from '../support/context.js';
import {
  buildCatalogView,
  loadSyntheticWires,
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
    expect(outcome.ok && outcome.text).toContain('Run scan_repo or scan_github first');
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
        technologies: [],
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
    expect(outcome.ok && outcome.text).not.toContain('Run scan_repo or scan_github first');
  });

  test('ranks by the tech profile when there is one, and names its AWS services in the plan (task 42)', async () => {
    const { fake, ctx, specFs } = setup();
    fake.techProfile.sources = [
      {
        id: 'a'.repeat(64),
        kind: 'github',
        scannedAt: '2026-10-20T10:00:00.000Z',
        services: [{ key: 's3', depth: 2, level: 300, score: 3 }],
        technologies: [{ key: 'python', files: 4, declarations: 1, score: 9 }],
      },
    ];
    fake.events.catalogView = buildCatalogView([
      ...loadSyntheticWires(),
      wireSession('py-tech', { title: 'Python on AWS Lambda', services: ['other'] }),
    ]);
    const outcome = await planWeekTool({}, ctx);
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.text).not.toContain('Run scan_repo or scan_github first');
    expect(specFs.files.get(join(weekSpecDirectory(ROOT), 'requirements.md'))).toContain(
      '"Amazon S3"',
    );
    fake.techProfile.sources = [
      { ...fake.techProfile.sources[0], services: [{ key: 's3', depth: 1, score: 1 }] },
    ];
    expect((await planWeekTool({}, contextFor(fake))).ok).toBe(true);
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

  test('another gitignore failure never hides that the plan was written (QA M5)', async () => {
    const { elicit } = elicitWith({ folder: 'accept', gitignore: 'accept' });
    const { specFs, ctx } = setup({ elicit, gitignore: 'x\n' });
    specFs.appendText = () => Promise.reject(new CompassError('Server'));
    const outcome = await planWeekTool(GOALS, ctx);
    expect(outcome.ok && outcome.text).toContain('Created requirements.md, design.md and tasks.md');
    expect(outcome.ok && outcome.text).toContain('could not read or change .gitignore safely');
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
        cwd: temp,
      });
      const connection = await connect(fake.runtime);
      await connection.call('scan_repo', { path: temp });
      const result = await connection.call('plan_week', { goals: ['workshop'] });
      expect(result.isError).toBeUndefined();
      const dir = weekSpecDirectory(temp);
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

describe('plan_week verdict preference (QA M3)', () => {
  const idsOf = (outcome: Awaited<ReturnType<typeof planWeekTool>>): string[] =>
    outcome.ok
      ? mcpTools.plan_week.output
          .parse(outcome.structured)
          .commitments.flatMap((c) => (c.kind === 'reservedSession' ? [c.sessionId] : []))
      : [];
  const badFor =
    (ids: ReadonlySet<string>, classification: 'impossible' | 'unknown') =>
    (commitments: readonly Commitment[]): Map<string, ConnectionLine> =>
      new Map(
        commitments.flatMap((c): [string, ConnectionLine][] =>
          c.kind === 'reservedSession' && ids.has(c.sessionId)
            ? [[c.sessionId, { classification, reason: 'Cannot make it.' }]]
            : [],
        ),
      );
  const warnAll = (fake: ReturnType<typeof setup>['fake']): void => {
    fake.rules.verdictFor = () => ({ decision: 'warn', reasons: ['Tight walk.'] });
  };

  test('warned sessions are taken when their walks are fine', async () => {
    const { fake, ctx } = setup();
    warnAll(fake);
    expect(idsOf(await planWeekTool(GOALS, ctx)).length).toBeGreaterThan(0);
  });

  test('a warned session whose walk would be impossible or unknown is left out', async () => {
    for (const classification of ['impossible', 'unknown'] as const) {
      const base = setup();
      warnAll(base.fake);
      const first = idsOf(await planWeekTool(GOALS, base.ctx))[0] ?? '';
      expect(first).not.toBe('');
      const { fake, ctx } = setup();
      warnAll(fake);
      fake.rules.connectionLines = badFor(new Set([first]), classification);
      const ids = idsOf(await planWeekTool(GOALS, ctx));
      expect(ids).not.toContain(first);
      expect(ids.length).toBeGreaterThan(0);
    }
  });

  test('a bad walk that was already on the schedule does not count against a candidate', async () => {
    const { fake, ctx } = setup();
    warnAll(fake);
    const view = await fake.events.catalog();
    const existing = [...view.byId.values()].find((e) => e.session.code === 'ANT398');
    fake.events.schedule.reserved.push(existing?.session.sessionId ?? '');
    fake.rules.connectionLines = badFor(new Set([existing?.session.sessionId ?? '']), 'impossible');
    expect(idsOf(await planWeekTool(GOALS, ctx)).length).toBeGreaterThan(0);
  });
});

describe('plan_week writing (security M2, QA M5 and M8)', () => {
  test('a client that cannot ask gets a plan written only to the working directory, and the text says so', async () => {
    const { specFs, ctx } = setup();
    const outcome = await planWeekTool(GOALS, ctx);
    const text = outcome.ok ? outcome.text : '';
    expect(text).toContain('This client cannot ask for confirmation');
    expect(text).toContain('writes only to the folder it was started in');
    expect([...specFs.files.keys()].every((path) => path.startsWith(weekSpecDirectory(ROOT)))).toBe(
      true,
    );
  });

  test('a scan of another folder never moves where the plan is written', async () => {
    const { specFs, fake, ctx } = setup();
    ctx.state.lastScan = {
      result: {
        services: [],
        unmappedCount: 0,
        filesRead: 0,
        skipped: {
          excludedDirectory: 0,
          gitignored: 0,
          tooLarge: 0,
          binary: 0,
          symlink: 0,
          unsupportedType: 0,
        },
        truncated: false,
        pythonAnalysed: true,
        technologies: [],
      },
      taxonomy: [],
      root: join('/', 'somewhere', 'else'),
    };
    await planWeekTool(GOALS, ctx);
    expect(fake.runtime.cwd).toBe(ROOT);
    expect([...specFs.files.keys()].every((path) => path.startsWith(ROOT))).toBe(true);
    expect(specFs.files.size).toBe(3);
  });

  test('a write that stops part way says what was and was not written and leaves .gitignore alone', async () => {
    const { specFs, ctx } = setup({ gitignore: 'node_modules/\n' });
    const original = specFs.createExclusive.bind(specFs);
    specFs.createExclusive = (path, text) =>
      path.endsWith('tasks.md') ? Promise.reject(new Error('disk full')) : original(path, text);
    const outcome = await planWeekTool(GOALS, ctx);
    const text = outcome.ok ? outcome.text : '';
    expect(text).toContain('could not finish writing the plan');
    expect(text).toContain('It wrote: requirements.md, design.md.');
    expect(text).toContain('It did not write: tasks.md.');
    expect(text).toContain('It did not touch .gitignore');
    expect(text).not.toContain('disk full');
    expect(specFs.files.get(GITIGNORE)).toBe('node_modules/\n');
    expect(specFs.calls.some((call) => call.method === 'appendText')).toBe(false);
  });

  test('a failure before any file is written is raised, not reported as partial', async () => {
    const { specFs, ctx } = setup();
    specFs.createExclusive = () => Promise.reject(new Error('read only'));
    await expect(planWeekTool(GOALS, ctx)).rejects.toThrow('read only');
  });

  test('a re-run that changes nothing says there are no differences and writes nothing', async () => {
    const { specFs, ctx } = setup();
    await planWeekTool(GOALS, ctx);
    const before = new Map(specFs.files);
    const second = await planWeekTool(GOALS, ctx);
    expect(second.ok && second.text).toContain(
      'has no differences from it, so Compass wrote nothing',
    );
    expect(specFs.files).toEqual(before);
  });

  test('a re-run that changes things shows only the changes with a few lines of context', async () => {
    const { specFs, ctx } = setup();
    await planWeekTool(GOALS, ctx);
    // One line of the existing design differs, so the re-run has exactly one change to show.
    const designPath = join(weekSpecDirectory(ROOT), 'design.md');
    const design = specFs.files.get(designPath) ?? '';
    specFs.files.set(designPath, design.replace('# Design: my re:Invent week', '# Design: edited'));
    const second = await planWeekTool(GOALS, ctx);
    const text = second.ok ? second.text : '';
    expect(text).toContain('with a few lines of context');
    expect(text).toContain('"- # Design: edited"');
    expect(text).toContain('"+ # Design: my re:Invent week"');
    expect(text).toContain('"  ..."');
    const added = [...specFs.files.entries()].find(([path]) => path.includes('week-'));
    const full = added === undefined ? 0 : added[1].split('\n').length;
    const shown = text.split('\n').filter((line) => /^\s+"(\+|-| {2})/.test(line)).length;
    expect(full).toBeGreaterThan(20);
    expect(shown).toBeLessThan(20);
  });

  test('an unreadable .gitignore never hides that the plan was written', async () => {
    const { elicit } = (() => ({ elicit: (): Promise<'accept'> => Promise.resolve('accept') }))();
    const { specFs, ctx } = setup({ elicit, gitignore: 'x\n' });
    specFs.readText = () => Promise.reject(new CompassError('SpecWriteRefused'));
    const outcome = await planWeekTool(GOALS, ctx);
    expect(outcome.ok && outcome.text).toContain('Created requirements.md, design.md and tasks.md');
    expect(outcome.ok && outcome.text).toContain('could not read or change .gitignore safely');
  });
});

describe('plan_week input limits (security L6, QA low)', () => {
  const goals = (n: number): string[] => Array.from({ length: n }, (_, i) => `goal-${i}`);

  test('20 goals are fine and 21 are refused with the fixed message, without echoing them', async () => {
    const ok = setup();
    await expect(planWeekTool({ goals: goals(20) }, ok.ctx)).resolves.toMatchObject({ ok: true });
    const refused = setup();
    await expect(planWeekTool({ goals: goals(21) }, refused.ctx)).rejects.toMatchObject({
      code: 'InputTooLarge',
    });
    expect(refused.specFs.files.size).toBe(0);
  });

  test('a level other than 100, 200, 300 or 400 is refused before anything is read or written', async () => {
    for (const level of ['500', 'senior', '', '300 or 400']) {
      const { fake, specFs, ctx } = setup();
      await expect(planWeekTool({ level }, ctx), level).rejects.toMatchObject({
        code: 'LevelInvalid',
      });
      expect(fake.events.calls).toEqual([]);
      expect(specFs.files.size).toBe(0);
    }
    const { ctx } = setup();
    await expect(planWeekTool({ level: ' 300 ' }, ctx)).resolves.toMatchObject({ ok: true });
  });
});
