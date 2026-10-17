import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WEEK_SPEC_ENTRY,
  addWeekSpecToGitignore,
  isWeekSpecIgnored,
} from '../../src/spec/gitignore-entry.js';
import { createNodeSpecFs, hasAllowedShape } from '../../src/spec/node-spec-fs.js';
import { SpecWriteRefusedError } from '../../src/spec/spec-errors.js';
import { weekSpecDirectory } from '../../src/spec/write.js';
import { MemorySpecFs } from '../support/memory-spec-fs.js';

const ROOT = join('/', 'workspace');
const GITIGNORE = join(ROOT, '.gitignore');

function fsWith(content: string | undefined): MemorySpecFs {
  const fs = new MemorySpecFs();
  fs.directories.add(ROOT);
  if (content !== undefined) fs.files.set(GITIGNORE, content);
  return fs;
}

describe('gitignore entry', () => {
  test('creates the file when absent and reports the folder as ignored', async () => {
    const fs = fsWith(undefined);
    expect(await isWeekSpecIgnored(ROOT, fs)).toBe(false);
    expect(await addWeekSpecToGitignore(ROOT, fs)).toBe('added');
    expect(fs.files.get(GITIGNORE)).toBe(`${WEEK_SPEC_ENTRY}\n`);
    expect(await isWeekSpecIgnored(ROOT, fs)).toBe(true);
  });

  test('keeps existing content and adds a newline when one is missing', async () => {
    const fs = fsWith('node_modules/\n*.log');
    expect(await addWeekSpecToGitignore(ROOT, fs)).toBe('added');
    expect(fs.files.get(GITIGNORE)).toBe(`node_modules/\n*.log\n${WEEK_SPEC_ENTRY}\n`);
    const empty = fsWith('');
    await addWeekSpecToGitignore(ROOT, empty);
    expect(empty.files.get(GITIGNORE)).toBe(`${WEEK_SPEC_ENTRY}\n`);
  });

  test('recognises the entry in its equivalent forms and does not add it twice', async () => {
    for (const line of [
      WEEK_SPEC_ENTRY,
      WEEK_SPEC_ENTRY.slice(0, -1),
      `/${WEEK_SPEC_ENTRY}`,
      `/${WEEK_SPEC_ENTRY.slice(0, -1)}`,
    ]) {
      const fs = fsWith(`a\r\n${line}  \r\nb\r\n`);
      expect(await addWeekSpecToGitignore(ROOT, fs)).toBe('alreadyPresent');
      expect(fs.calls).toEqual([]);
    }
  });

  test('refuses a symbolic link .gitignore and never appends through it', async () => {
    const fs = fsWith('x\n');
    fs.links.add(GITIGNORE);
    await expect(addWeekSpecToGitignore(ROOT, fs)).rejects.toBeInstanceOf(SpecWriteRefusedError);
    expect(fs.calls).toEqual([]);
  });
});

// Feature: compass-power, Property 24: Adding the gitignore entry is idempotent and preserving
describe('Property 24: adding the gitignore entry is idempotent and preserving', () => {
  const lineArb = fc.constantFrom(
    '',
    '# comment',
    '*.log',
    'node_modules/',
    'dist',
    WEEK_SPEC_ENTRY,
    '  ',
  );
  test('original content, then exactly one entry line, and the folder is ignored', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.option(fc.array(lineArb, { maxLength: 8 }), { nil: undefined }),
        fc.boolean(),
        fc.boolean(),
        fc.integer({ min: 1, max: 4 }),
        async (lines, trailingNewline, crlf, times) => {
          const original =
            lines === undefined
              ? undefined
              : lines.join(crlf ? '\r\n' : '\n') +
                (trailingNewline && lines.length > 0 ? '\n' : '');
          const fs = fsWith(original);
          for (let i = 0; i < times; i += 1) await addWeekSpecToGitignore(ROOT, fs);
          const result = fs.files.get(GITIGNORE) ?? '';
          const entryCount = result
            .split(/\r?\n/)
            .filter((l) => l.trim() === WEEK_SPEC_ENTRY).length;
          const originalCount =
            original === undefined
              ? 0
              : original.split(/\r?\n/).filter((l) => l.trim() === WEEK_SPEC_ENTRY).length;
          expect(entryCount).toBe(Math.max(1, originalCount));
          if (original !== undefined) {
            expect(result.startsWith(original)).toBe(true);
          }
          expect(await isWeekSpecIgnored(ROOT, fs)).toBe(true);
        },
      ),
      { numRuns: 150 },
    );
  });
});

describe('createNodeSpecFs', () => {
  let temp: string;
  let canSymlink = true;
  const fs = createNodeSpecFs();

  beforeAll(async () => {
    temp = await mkdtemp(join(tmpdir(), 'compass-specfs-'));
    await mkdir(weekSpecDirectory(temp), { recursive: true });
    await writeFile(join(temp, 'target.txt'), 'target');
    try {
      await symlink(join(temp, 'target.txt'), join(temp, 'link-file'), 'file');
    } catch {
      canSymlink = false;
    }
  });

  afterAll(async () => {
    await rm(temp, { recursive: true, force: true });
  });

  test('allowed shapes', () => {
    expect(hasAllowedShape(join(weekSpecDirectory(temp), 'design.md'))).toBe(true);
    expect(hasAllowedShape(join(weekSpecDirectory(temp), 'week-2026-12-01-2.md'))).toBe(true);
    expect(hasAllowedShape(join(temp, '.gitignore'))).toBe(true);
    expect(hasAllowedShape(join(temp, 'design.md'))).toBe(false);
    expect(hasAllowedShape(join(temp, 'other.txt'))).toBe(false);
  });

  test('creates exclusively, appends, reads and reports existence', async () => {
    const path = join(weekSpecDirectory(temp), 'tasks.md');
    expect(await fs.exists(path)).toBe(false);
    await fs.createExclusive(path, 'one\n');
    await expect(fs.createExclusive(path, 'two\n')).rejects.toThrow();
    expect(await fs.exists(path)).toBe(true);
    expect(await fs.isDirectory(path)).toBe(false);
    expect(await fs.isDirectory(weekSpecDirectory(temp))).toBe(true);
    expect(await fs.isDirectory(join(temp, 'missing'))).toBe(false);
    expect(await fs.isSymlink(path)).toBe(false);
    expect(await fs.isSymlink(join(temp, 'missing'))).toBe(false);
    const gitignore = join(temp, '.gitignore');
    await fs.createExclusive(gitignore, 'a\n');
    await fs.appendText(gitignore, 'b\n');
    expect(await fs.readText(gitignore)).toBe('a\nb\n');
    expect((await readFile(gitignore, 'utf8')).length).toBe(4);
  });

  test('refuses paths outside the allowed shapes and odd directories', async () => {
    await expect(fs.createExclusive(join(temp, 'evil.md'), 'x')).rejects.toBeInstanceOf(
      SpecWriteRefusedError,
    );
    await expect(fs.appendText(join(temp, 'evil.md'), 'x')).rejects.toBeInstanceOf(
      SpecWriteRefusedError,
    );
    await expect(fs.appendText(join(temp, '.gitignore-missing'), 'x')).rejects.toBeInstanceOf(
      SpecWriteRefusedError,
    );
    await expect(fs.mkdirp(join(temp, 'elsewhere'))).rejects.toBeInstanceOf(SpecWriteRefusedError);
    await fs.mkdirp(weekSpecDirectory(join(temp, 'second')));
    expect(await fs.isDirectory(weekSpecDirectory(join(temp, 'second')))).toBe(true);
  });

  test('refuses to append through a symbolic link', async () => {
    if (!canSymlink) {
      return;
    }
    await mkdir(join(temp, 'other'), { recursive: true });
    await symlink(join(temp, 'target.txt'), join(temp, 'other', '.gitignore'), 'file');
    expect(await fs.isSymlink(join(temp, 'other', '.gitignore'))).toBe(true);
    await expect(fs.appendText(join(temp, 'other', '.gitignore'), 'x')).rejects.toBeInstanceOf(
      SpecWriteRefusedError,
    );
    expect(await readFile(join(temp, 'target.txt'), 'utf8')).toBe('target');
  });

  test('a reported symbolic link is refused for append and reported by isSymlink', async () => {
    const reportsLink = createNodeSpecFs(() => Promise.resolve({ isSymbolicLink: () => true }));
    const path = join(temp, '.gitignore');
    expect(await reportsLink.isSymlink(path)).toBe(true);
    expect(await reportsLink.exists(path)).toBe(true);
    await expect(reportsLink.appendText(path, 'x')).rejects.toBeInstanceOf(SpecWriteRefusedError);
  });

  test('other file system errors are not swallowed', async () => {
    await expect(fs.exists(`${temp}${'\0'}bad`)).rejects.toThrow();
    await expect(fs.isDirectory(`${temp}${'\0'}bad`)).rejects.toThrow();
  });
});
