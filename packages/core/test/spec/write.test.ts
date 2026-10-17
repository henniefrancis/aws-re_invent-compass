import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { join } from 'node:path';
import { applyDiff, lineDiff } from '../../src/spec/diff.js';
import { SpecWriteRefusedError } from '../../src/spec/spec-errors.js';
import {
  assertWritable,
  isAllowedWritePath,
  weekSpecDirectory,
  writeWeekSpec,
} from '../../src/spec/write.js';
import { FolderNotFoundError } from '../../src/scanner/walker.js';
import { MemorySpecFs } from '../support/memory-spec-fs.js';

const ROOT = join('/', 'workspace');
const DIR = weekSpecDirectory(ROOT);
const FILES = { requirementsMd: 'R1\nR2\n', designMd: 'D1\n', tasksMd: 'T1\nT2\nT3\n' };

function workspace(): MemorySpecFs {
  const fs = new MemorySpecFs();
  fs.directories.add(ROOT);
  return fs;
}

describe('lineDiff and applyDiff', () => {
  test('shows added, removed and unchanged lines with prefixes', () => {
    const diff = lineDiff('a\nb\nc', 'a\nx\nc\nd');
    expect(diff.lines).toEqual(['  a', '- b', '+ x', '  c', '+ d']);
    expect(diff.truncated).toBe(false);
    expect(applyDiff('a\nb\nc', diff)).toBe('a\nx\nc\nd');
  });

  test('identical texts and empty texts', () => {
    expect(lineDiff('a\nb', 'a\nb').lines).toEqual(['  a', '  b']);
    expect(applyDiff('', lineDiff('', 'x\ny'))).toBe('x\ny');
    expect(applyDiff('x', lineDiff('x', ''))).toBe('');
  });

  test('truncates beyond the line cap', () => {
    const before = Array.from({ length: 30 }, (_, i) => `a${i}`).join('\n');
    const diff = lineDiff(before, `${before}\nmore`, 10);
    expect(diff.lines).toHaveLength(10);
    expect(diff.truncated).toBe(true);
  });

  test('very large changes fall back to remove everything and add everything', () => {
    const before = Array.from({ length: 1001 }, (_, i) => `a${i}`).join('\n');
    const after = Array.from({ length: 1001 }, (_, i) => `b${i}`).join('\n');
    const diff = lineDiff(before, after, 5000);
    expect(diff.lines[0]).toBe('- a0');
    expect(diff.lines[1000]).toBe('- a1000');
    expect(diff.lines[1001]).toBe('+ b0');
    expect(applyDiff(before, diff)).toBe(after);
  });

  test('applyDiff refuses a diff that does not describe the original', () => {
    expect(() => applyDiff('other', lineDiff('a', 'b'))).toThrow('does not match');
  });
});

describe('allowed write set', () => {
  test('only the Week_Spec files and the root gitignore are allowed', () => {
    expect(isAllowedWritePath(ROOT, join(DIR, 'design.md'))).toBe(true);
    expect(isAllowedWritePath(ROOT, join(DIR, 'week-2026-12-01-3.md'))).toBe(true);
    expect(isAllowedWritePath(ROOT, join(ROOT, '.gitignore'))).toBe(true);
    for (const path of [
      join(DIR, 'other.md'),
      join(DIR, 'sub', 'design.md'),
      join(ROOT, 'design.md'),
      join(ROOT, 'src', '.gitignore'),
      join(ROOT, '..', 'x', 'design.md'),
      join(DIR, 'week-2026-12-01.txt'),
    ]) {
      expect(isAllowedWritePath(ROOT, path)).toBe(false);
    }
  });

  test('assertWritable refuses paths outside the set and symlinked components', async () => {
    const fs = workspace();
    await expect(assertWritable(ROOT, join(ROOT, 'evil.md'), fs)).rejects.toBeInstanceOf(
      SpecWriteRefusedError,
    );
    await expect(assertWritable(ROOT, join(DIR, 'design.md'), fs)).resolves.toBeUndefined();
    fs.links.add(join(ROOT, '.kiro'));
    await expect(assertWritable(ROOT, join(DIR, 'design.md'), fs)).rejects.toBeInstanceOf(
      SpecWriteRefusedError,
    );
    fs.links.add(join(ROOT, '.gitignore'));
    await expect(assertWritable(ROOT, join(ROOT, '.gitignore'), fs)).rejects.toBeInstanceOf(
      SpecWriteRefusedError,
    );
  });
});

describe('writeWeekSpec', () => {
  test('first run creates exactly the three files', async () => {
    const fs = workspace();
    const outcome = await writeWeekSpec(ROOT, FILES, { fs, today: '2026-12-01' });
    expect(outcome).toEqual({
      kind: 'created',
      files: ['requirements.md', 'design.md', 'tasks.md'],
    });
    expect([...fs.files.keys()].sort()).toEqual(
      ['design.md', 'requirements.md', 'tasks.md'].map((n) => join(DIR, n)),
    );
    expect(fs.files.get(join(DIR, 'design.md'))).toBe('D1\n');
  });

  test('refuses a missing root and writes nothing', async () => {
    const fs = new MemorySpecFs();
    await expect(writeWeekSpec(ROOT, FILES, { fs, today: '2026-12-01' })).rejects.toBeInstanceOf(
      FolderNotFoundError,
    );
    expect(fs.calls).toEqual([]);
  });

  test('refuses a bad date and any symlinked component, writing nothing', async () => {
    const fs = workspace();
    await expect(writeWeekSpec(ROOT, FILES, { fs, today: '../x' })).rejects.toBeInstanceOf(
      SpecWriteRefusedError,
    );
    for (const link of [join(ROOT, '.kiro'), join(ROOT, '.kiro', 'specs'), DIR]) {
      const linked = workspace();
      linked.links.add(link);
      await expect(
        writeWeekSpec(ROOT, FILES, { fs: linked, today: '2026-12-01' }),
      ).rejects.toBeInstanceOf(SpecWriteRefusedError);
      expect(linked.calls.filter((c) => c.method === 'createExclusive')).toEqual([]);
    }
    expect(fs.calls).toEqual([]);
  });

  test('a link appearing during mkdirp is caught by the second check', async () => {
    const fs = workspace();
    const original = fs.mkdirp.bind(fs);
    fs.mkdirp = async (path: string) => {
      await original(path);
      fs.links.add(DIR);
    };
    await expect(writeWeekSpec(ROOT, FILES, { fs, today: '2026-12-01' })).rejects.toBeInstanceOf(
      SpecWriteRefusedError,
    );
  });

  test('a re-run writes a dated file with a diff and leaves existing files alone', async () => {
    const fs = workspace();
    await writeWeekSpec(ROOT, FILES, { fs, today: '2026-12-01' });
    const before = new Map(fs.files);
    const second = await writeWeekSpec(
      ROOT,
      { ...FILES, designMd: 'D1 changed\n' },
      { fs, today: '2026-12-01' },
    );
    expect(second.kind).toBe('dated');
    if (second.kind === 'dated') {
      expect(second.fileName).toBe('week-2026-12-01.md');
      expect(second.diff.lines.some((l) => l === '- D1')).toBe(true);
      expect(second.diff.lines.some((l) => l === '+ D1 changed')).toBe(true);
    }
    for (const [path, text] of before) expect(fs.files.get(path)).toBe(text);
    const third = await writeWeekSpec(
      ROOT,
      { ...FILES, designMd: 'D1 third\n' },
      { fs, today: '2026-12-01' },
    );
    expect(third.kind === 'dated' && third.fileName).toBe('week-2026-12-01-2.md');
    const fourth = await writeWeekSpec(
      ROOT,
      { ...FILES, designMd: 'D1 fourth\n' },
      { fs, today: '2026-12-01' },
    );
    expect(fourth.kind === 'dated' && fourth.fileName).toBe('week-2026-12-01-3.md');
  });

  test('a re-run whose documents equal the existing ones writes nothing (QA M8)', async () => {
    const fs = workspace();
    await writeWeekSpec(ROOT, FILES, { fs, today: '2026-12-01' });
    const before = new Map(fs.files);
    const again = await writeWeekSpec(ROOT, FILES, { fs, today: '2026-12-01' });
    expect(again).toEqual({ kind: 'unchanged' });
    expect(fs.files).toEqual(before);
  });

  test('only the generated-on line differing still counts as unchanged', async () => {
    const fs = workspace();
    const withStamp = (stamp: string) => ({
      ...FILES,
      designMd: `Intro\nGenerated on ${stamp}.\nBody\n`,
    });
    await writeWeekSpec(ROOT, withStamp('Mon 30 Nov 10:00'), { fs, today: '2026-12-01' });
    const again = await writeWeekSpec(ROOT, withStamp('Mon 30 Nov 10:07'), {
      fs,
      today: '2026-12-01',
    });
    expect(again).toEqual({ kind: 'unchanged' });
    const changed = await writeWeekSpec(
      ROOT,
      { ...withStamp('Mon 30 Nov 10:09'), tasksMd: 'T changed\n' },
      { fs, today: '2026-12-01' },
    );
    expect(changed.kind).toBe('dated');
  });

  test('a write that fails after the first file reports what was and was not written', async () => {
    const fs = workspace();
    const original = fs.createExclusive.bind(fs);
    fs.createExclusive = (path, text) =>
      path.endsWith('design.md') ? Promise.reject(new Error('disk full')) : original(path, text);
    const failure = await writeWeekSpec(ROOT, FILES, { fs, today: '2026-12-01' }).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(PartialWriteError);
    expect((failure as PartialWriteError).written).toEqual(['requirements.md']);
    expect((failure as PartialWriteError).missing).toEqual(['design.md', 'tasks.md']);
    const early = workspace();
    early.createExclusive = () => Promise.reject(new Error('read only'));
    await expect(writeWeekSpec(ROOT, FILES, { fs: early, today: '2026-12-01' })).rejects.toThrow(
      'read only',
    );
  });

  test('a partial folder is treated as a re-run and missing files count as empty', async () => {
    const fs = workspace();
    fs.directories.add(DIR);
    fs.files.set(join(DIR, 'tasks.md'), 'old tasks\n');
    const outcome = await writeWeekSpec(ROOT, FILES, { fs, today: '2026-12-02' });
    expect(outcome.kind).toBe('dated');
    expect(fs.files.get(join(DIR, 'tasks.md'))).toBe('old tasks\n');
  });
});

// Feature: compass-power, Property 23: Re-planning never overwrites and the diff is faithful
describe('Property 23: re-planning never overwrites and the diff is faithful', () => {
  const lineArb = fc.constantFrom('', 'alpha', 'beta', '# heading', '- [ ] 1. task', 'gamma delta');
  const textArb = fc.array(lineArb, { maxLength: 12 }).map((lines) => lines.join('\n'));
  const filesArb = fc.record({ requirementsMd: textArb, designMd: textArb, tasksMd: textArb });

  test('existing files stay byte-identical, one new unique dated file, faithful diff', async () => {
    await fc.assert(
      fc.asyncProperty(
        filesArb,
        filesArb,
        fc.subarray(['requirements.md', 'design.md', 'tasks.md'], { minLength: 0 }),
        fc.integer({ min: 0, max: 3 }),
        async (existingDocs, regenerated, present, datedCount) => {
          const fs = workspace();
          fs.directories.add(DIR);
          const contents: Record<string, string> = {
            'requirements.md': existingDocs.requirementsMd,
            'design.md': existingDocs.designMd,
            'tasks.md': existingDocs.tasksMd,
          };
          for (const name of present) fs.files.set(join(DIR, name), contents[name] ?? '');
          for (let n = 0; n < datedCount; n += 1) {
            fs.files.set(
              join(DIR, n === 0 ? 'week-2026-12-01.md' : `week-2026-12-01-${n + 1}.md`),
              `old${n}`,
            );
          }
          const snapshot = new Map(fs.files);
          const outcome = await writeWeekSpec(ROOT, regenerated, { fs, today: '2026-12-01' });

          if (present.length === 0 && datedCount === 0) {
            expect(outcome.kind).toBe('created');
            expect(fs.files.size).toBe(3);
            return;
          }
          if (present.length === 0) {
            // only dated files exist: the three documents are still created
            expect(outcome.kind).toBe('created');
            return;
          }
          if (outcome.kind === 'unchanged') {
            // The regenerated documents equal the existing ones: nothing at all is written.
            expect(fs.files).toEqual(snapshot);
            return;
          }
          expect(outcome.kind).toBe('dated');
          for (const [path, text] of snapshot) expect(fs.files.get(path)).toBe(text);
          expect(fs.files.size).toBe(snapshot.size + 1);
          if (outcome.kind === 'dated') {
            expect(outcome.fileName).toMatch(/^week-2026-12-01(?:-\d+)?\.md$/);
            expect(snapshot.has(join(DIR, outcome.fileName))).toBe(false);
            const newText = fs.files.get(join(DIR, outcome.fileName)) ?? '';
            const before = ['requirements.md', 'design.md', 'tasks.md']
              .map((name) => `# ${name}\n\n${present.includes(name) ? contents[name] : ''}`)
              .join('\n');
            if (!outcome.diff.truncated) {
              expect(applyDiff(before, outcome.diff)).toBe(newText);
            }
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});

import { DIFF_CONTEXT_LINES, trimDiff } from '../../src/spec/diff.js';
import { PartialWriteError } from '../../src/spec/write.js';

describe('trimDiff (QA M8)', () => {
  const diffOf = (before: string[], after: string[]) =>
    lineDiff(before.join('\n'), after.join('\n'));
  const numbered = (n: number): string[] => Array.from({ length: n }, (_, i) => `line ${i}`);

  test('keeps the changes with context lines around them and marks each dropped run', () => {
    const before = numbered(40);
    const after = [...before];
    after[20] = 'changed';
    const trimmed = trimDiff(diffOf(before, after));
    expect(trimmed.lines).toEqual([
      '  ...',
      ...numbered(40)
        .slice(20 - DIFF_CONTEXT_LINES, 20)
        .map((l) => `  ${l}`),
      '- line 20',
      '+ changed',
      ...numbered(40)
        .slice(21, 21 + DIFF_CONTEXT_LINES)
        .map((l) => `  ${l}`),
      '  ...',
    ]);
    expect(trimmed.truncated).toBe(false);
  });

  test('two nearby changes share their context and a change at the start has no leading marker', () => {
    const before = numbered(30);
    const after = [...before];
    after[0] = 'first';
    after[3] = 'fourth';
    const trimmed = trimDiff(diffOf(before, after), 1);
    expect(trimmed.lines[0]).toBe('- line 0');
    expect(trimmed.lines.filter((l) => l === '  ...')).toHaveLength(1);
  });

  test('a diff with no change has no lines, and truncation is kept', () => {
    expect(trimDiff(diffOf(['a', 'b'], ['a', 'b']))).toEqual({ lines: [], truncated: false });
    expect(trimDiff({ lines: ['  a', '+ b'], truncated: true }).truncated).toBe(true);
  });
});

describe('PartialWriteError', () => {
  test('lists what was written and what was not, with fixed text', () => {
    const error = new PartialWriteError(['a'], ['b', 'c']);
    expect(error.written).toEqual(['a']);
    expect(error.missing).toEqual(['b', 'c']);
    expect(error.message).toBe('The plan was only partly written.');
  });
});
