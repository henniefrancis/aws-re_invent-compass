// The `.gitignore` entry for the Week_Spec (Requirements 7.4 to 7.7; CTO review M3). A
// public repository would publish where the attendee will be and when, so the server
// offers to ignore the folder. Adding the entry creates `.gitignore` if absent, keeps all
// existing content, never adds the entry twice, and never writes through a symbolic link.

import { join } from 'node:path';
import { isIgnored, parseGitignore } from '../scanner/gitignore.js';
import type { SpecFs } from './spec-fs.js';
import { assertWritable } from './write.js';

/** The line added to `.gitignore`. */
export const WEEK_SPEC_ENTRY = '.kiro/specs/my-reinvent-week/';

const ENTRY_FORMS: readonly string[] = [
  WEEK_SPEC_ENTRY,
  WEEK_SPEC_ENTRY.slice(0, -1),
  `/${WEEK_SPEC_ENTRY}`,
  `/${WEEK_SPEC_ENTRY.slice(0, -1)}`,
];

/** True when the root `.gitignore` already ignores the Week_Spec folder. */
export async function isWeekSpecIgnored(root: string, fs: SpecFs): Promise<boolean> {
  const path = join(root, '.gitignore');
  if (!(await fs.exists(path))) {
    return false;
  }
  return isIgnored(WEEK_SPEC_ENTRY.slice(0, -1), true, parseGitignore(await fs.readText(path), ''));
}

/** Adds the entry. Throws SpecWriteRefusedError when `.gitignore` is a symbolic link. */
export async function addWeekSpecToGitignore(
  root: string,
  fs: SpecFs,
): Promise<'added' | 'alreadyPresent'> {
  const path = join(root, '.gitignore');
  await assertWritable(root, path, fs);
  if (!(await fs.exists(path))) {
    await fs.createExclusive(path, `${WEEK_SPEC_ENTRY}\n`);
    return 'added';
  }
  const text = await fs.readText(path);
  if (text.split(/\r?\n/).some((line) => ENTRY_FORMS.includes(line.trim()))) {
    return 'alreadyPresent';
  }
  const separator = text === '' || text.endsWith('\n') ? '' : '\n';
  await fs.appendText(path, `${separator}${WEEK_SPEC_ENTRY}\n`);
  return 'added';
}
