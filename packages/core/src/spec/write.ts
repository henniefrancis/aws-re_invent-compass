// The spec writer (design, Component 4; Requirements 7.1 to 7.3; CTO review M3).
//
// First run: creates `requirements.md`, `design.md` and `tasks.md` under
// `<root>/.kiro/specs/my-reinvent-week/`. A re-run never touches an existing file: it
// writes `week-<YYYY-MM-DD>[-n].md` with the regenerated documents and returns a line diff
// against the current ones. The allowed write set is exactly those files plus
// `<root>/.gitignore`. Every existing path component under the root is checked with `lstat`
// and a symbolic link is refused. Files are created with the exclusive flag.

import { basename, dirname, join } from 'node:path';
import { FolderNotFoundError } from '../scanner/walker.js';
import { lineDiff } from './diff.js';
import type { DiffResult } from './diff.js';
import type { WeekSpecFiles } from './render.js';
import { SpecWriteRefusedError } from './spec-errors.js';
import type { SpecFs } from './spec-fs.js';

/** The three document names. */
export const WEEK_SPEC_FILE_NAMES = ['requirements.md', 'design.md', 'tasks.md'] as const;

/** What a write did. */
export type WriteOutcome =
  | { kind: 'created'; files: ['requirements.md', 'design.md', 'tasks.md'] }
  | { kind: 'dated'; fileName: string; diff: DiffResult }
  /** A re-run whose documents equal the existing ones: nothing is written. */
  | { kind: 'unchanged' };

/**
 * A write that stopped part way (QA M5): `written` lists the files that were created before the
 * failure and `missing` the ones that were not. It never carries a path or the cause's text.
 */
export class PartialWriteError extends Error {
  readonly written: readonly string[];
  readonly missing: readonly string[];

  constructor(written: readonly string[], missing: readonly string[]) {
    super('The plan was only partly written.');
    this.name = 'PartialWriteError';
    this.written = written;
    this.missing = missing;
  }
}

const DATED_NAME = /^week-\d{4}-\d{2}-\d{2}(?:-\d+)?\.md$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The Week_Spec folder under a root. */
export function weekSpecDirectory(root: string): string {
  return join(root, '.kiro', 'specs', 'my-reinvent-week');
}

/** True only for the Week_Spec files and `<root>/.gitignore`. */
export function isAllowedWritePath(root: string, path: string): boolean {
  if (path === join(root, '.gitignore')) {
    return true;
  }
  const name = basename(path);
  return (
    dirname(path) === weekSpecDirectory(root) &&
    ((WEEK_SPEC_FILE_NAMES as readonly string[]).includes(name) || DATED_NAME.test(name))
  );
}

async function assertNoSymlinks(paths: readonly string[], fs: SpecFs): Promise<void> {
  for (const path of paths) {
    if (await fs.isSymlink(path)) {
      throw new SpecWriteRefusedError();
    }
  }
}

/** Throws unless `path` is in the allowed write set and no existing component below the root is a link. */
export async function assertWritable(root: string, path: string, fs: SpecFs): Promise<void> {
  if (!isAllowedWritePath(root, path)) {
    throw new SpecWriteRefusedError();
  }
  const directory = weekSpecDirectory(root);
  const chain =
    dirname(path) === directory
      ? [join(root, '.kiro'), join(root, '.kiro', 'specs'), directory, path]
      : [path];
  await assertNoSymlinks(chain, fs);
}

/** The documents without the line that says when they were generated, which differs on every run. */
function withoutTimestamp(text: string): string {
  return text.replace(/^Generated on .*$/gm, '');
}

function joinDocuments(texts: readonly string[]): string {
  return WEEK_SPEC_FILE_NAMES.map((name, index) => `# ${name}\n\n${String(texts[index])}`).join(
    '\n',
  );
}

/** Writes the Week_Spec, or a dated re-run file with a diff. */
export async function writeWeekSpec(
  root: string,
  files: WeekSpecFiles,
  deps: { fs: SpecFs; today: string },
): Promise<WriteOutcome> {
  const { fs, today } = deps;
  if (!(await fs.isDirectory(root))) {
    throw new FolderNotFoundError();
  }
  if (!DAY.test(today)) {
    throw new SpecWriteRefusedError();
  }
  const directory = weekSpecDirectory(root);
  const chain = [join(root, '.kiro'), join(root, '.kiro', 'specs'), directory];
  await assertNoSymlinks(chain, fs);
  await fs.mkdirp(directory);
  await assertNoSymlinks(chain, fs);

  const documents: [string, string][] = [
    ['requirements.md', files.requirementsMd],
    ['design.md', files.designMd],
    ['tasks.md', files.tasksMd],
  ];
  const create = async (name: string, text: string): Promise<void> => {
    const path = join(directory, name);
    await assertWritable(root, path, fs);
    await fs.createExclusive(path, text);
  };

  const current: string[] = [];
  let anyExists = false;
  for (const [name] of documents) {
    const path = join(directory, name);
    if (await fs.exists(path)) {
      anyExists = true;
      current.push(await fs.readText(path));
    } else {
      current.push('');
    }
  }
  if (!anyExists) {
    const written: string[] = [];
    for (const [name, text] of documents) {
      try {
        await create(name, text);
      } catch (error) {
        if (written.length === 0) {
          throw error;
        }
        throw new PartialWriteError(
          written,
          documents.map(([missing]) => missing).filter((missing) => !written.includes(missing)),
        );
      }
      written.push(name);
    }
    return { kind: 'created', files: ['requirements.md', 'design.md', 'tasks.md'] };
  }
  const after = joinDocuments(documents.map(([, text]) => text));
  const before = joinDocuments(current);
  if (withoutTimestamp(after) === withoutTimestamp(before)) {
    return { kind: 'unchanged' };
  }

  let fileName = `week-${today}.md`;
  for (let n = 2; await fs.exists(join(directory, fileName)); n += 1) {
    fileName = `week-${today}-${n}.md`;
  }
  await create(fileName, after);
  return { kind: 'dated', fileName, diff: lineDiff(before, after) };
}
