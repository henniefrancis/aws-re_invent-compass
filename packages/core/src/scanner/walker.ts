// The repository walker (design, Component 1, "Discovery").
//
// It lists directories with `lstat` only, so a symbolic link is counted as skipped and
// never followed. It skips the named excluded directories, then applies the `.gitignore`
// rules collected from the root down to the current directory, and never descends into
// an ignored directory. Files must have a supported name. It reads at most 1 MiB plus
// one byte to detect "too large", probes the first 8 KiB for a NUL byte, and decodes the
// rest as UTF-8. It stops after the file cap and reports `truncated`.
//
// File names and paths stay inside the walker: the only things that leave are the text of
// each readable file (consumed by the detectors) and counts.

import { join } from 'node:path';
import { isExcludedDirectory, isSupportedFile } from './file-filter.js';
import { isIgnored, parseGitignore } from './gitignore.js';
import type { GitignoreRule } from './gitignore.js';
import type { ScanFs } from './scan-fs.js';

/** Why a path was skipped. */
export type SkipReason =
  'excludedDirectory' | 'gitignored' | 'tooLarge' | 'binary' | 'symlink' | 'unsupportedType';

/** The scan limits (Requirements 1.5 and 1.7). */
export interface WalkLimits {
  maxFiles: number;
  maxFileBytes: number;
  binaryProbeBytes: number;
}

/** The default limits: 20,000 files, 1 MiB per file, an 8 KiB binary probe. */
export const DEFAULT_WALK_LIMITS: WalkLimits = {
  maxFiles: 20000,
  maxFileBytes: 1048576,
  binaryProbeBytes: 8192,
};

/** One readable file. Internal to the scanner: never returned by `scanRepo`. */
export interface WalkedFile {
  relativePath: string;
  text: string;
}

/** What the walk saw, without any name or path. */
export interface WalkSummary {
  filesRead: number;
  skipped: Record<SkipReason, number>;
  truncated: boolean;
  productionMarker: boolean;
}

/** Raised when the scan root does not exist or is not a directory. It never carries the path. */
export class FolderNotFoundError extends Error {
  constructor() {
    super('That folder could not be found.');
    this.name = 'FolderNotFoundError';
  }
}

const PRODUCTION_DIRECTORIES: ReadonlySet<string> = new Set(['prod', 'production']);
const ENVIRONMENT_PARENTS: ReadonlySet<string> = new Set(['envs', 'environments', 'stages']);

function isProductionFile(name: string): boolean {
  return name === 'prod.tfvars' || name === 'production.tfvars' || name.endsWith('.prod.tfvars');
}

// Names in one directory are unique, so two names are never equal.
function byName(a: string, b: string): number {
  return a < b ? -1 : 1;
}

/**
 * Walks `root` and yields each readable file. The generator's return value is the
 * summary. Throws FolderNotFoundError when `root` is missing or not a directory.
 */
export async function* walk(
  root: string,
  fs: ScanFs,
  limits: WalkLimits = DEFAULT_WALK_LIMITS,
): AsyncGenerator<WalkedFile, WalkSummary> {
  let resolved: string | undefined;
  try {
    resolved = await fs.realpath(root);
    if (!(await fs.lstat(resolved)).isDirectory) {
      resolved = undefined;
    }
  } catch {
    resolved = undefined;
  }
  if (resolved === undefined) {
    throw new FolderNotFoundError();
  }

  const summary: WalkSummary = {
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
    productionMarker: false,
  };
  const decoder = new TextDecoder('utf-8');

  async function readGitignore(
    absDir: string,
    relDir: string,
    names: readonly string[],
  ): Promise<GitignoreRule[]> {
    if (!names.includes('.gitignore')) {
      return [];
    }
    const path = join(absDir, '.gitignore');
    const stat = await fs.lstat(path);
    if (!stat.isFile || stat.size > limits.maxFileBytes) {
      return [];
    }
    return parseGitignore(decoder.decode(await fs.readFile(path, limits.maxFileBytes)), relDir);
  }

  async function* visit(
    absDir: string,
    relDir: string,
    parentRules: readonly GitignoreRule[],
  ): AsyncGenerator<WalkedFile, void> {
    const names = (await fs.readdir(absDir)).sort(byName);
    const rules = [...parentRules, ...(await readGitignore(absDir, relDir, names))];
    for (const name of names) {
      if (summary.truncated) {
        return;
      }
      const absPath = join(absDir, name);
      const relPath = relDir === '' ? name : `${relDir}/${name}`;
      const stat = await fs.lstat(absPath);
      if (stat.isSymbolicLink) {
        summary.skipped.symlink += 1;
      } else if (stat.isDirectory) {
        if (isExcludedDirectory(name)) {
          summary.skipped.excludedDirectory += 1;
        } else if (isIgnored(relPath, true, rules)) {
          summary.skipped.gitignored += 1;
        } else {
          const parentName = relDir.slice(relDir.lastIndexOf('/') + 1);
          if (PRODUCTION_DIRECTORIES.has(name) && ENVIRONMENT_PARENTS.has(parentName)) {
            summary.productionMarker = true;
          }
          yield* visit(absPath, relPath, rules);
        }
      } else if (name === '.gitignore') {
        continue;
      } else if (isIgnored(relPath, false, rules)) {
        summary.skipped.gitignored += 1;
      } else if (isProductionFile(name)) {
        summary.productionMarker = true;
        summary.skipped.unsupportedType += 1;
      } else if (!isSupportedFile(name)) {
        summary.skipped.unsupportedType += 1;
      } else if (stat.size > limits.maxFileBytes) {
        summary.skipped.tooLarge += 1;
      } else {
        const bytes = await fs.readFile(absPath, limits.maxFileBytes + 1);
        if (bytes.length > limits.maxFileBytes) {
          summary.skipped.tooLarge += 1;
        } else if (bytes.subarray(0, limits.binaryProbeBytes).includes(0)) {
          summary.skipped.binary += 1;
        } else if (summary.filesRead >= limits.maxFiles) {
          summary.truncated = true;
          return;
        } else {
          summary.filesRead += 1;
          yield { relativePath: relPath, text: decoder.decode(bytes) };
        }
      }
    }
  }

  yield* visit(resolved, '', []);
  return summary;
}
