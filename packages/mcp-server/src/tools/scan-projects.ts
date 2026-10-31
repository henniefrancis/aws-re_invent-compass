// Projects in a dev folder (compass-power task 41, Requirement P2.3). A folder that is not itself a
// git repository but holds git repositories one or two levels down is scanned one repository at a
// time, each with its own limits and budget. The search never follows a link and never enters a
// folder the scanner excludes. Results are merged for the reply; nothing here holds file content.

import { EVIDENCE_KINDS, depthToNumber, isExcludedDirectory } from '@compass/core/scanner';
import type { ScanFs, ScanResult, ServiceFinding } from '@compass/core/scanner';
import { join } from 'node:path';

/** The most projects one scan reads. */
export const MAX_PROJECTS = 50;

/** No new project is started after this many milliseconds. */
export const PROJECTS_BUDGET_MS = 120_000;

// A `.git` folder, or a `.git` file as in a git worktree or submodule.
async function isGitRepository(folder: string, fs: ScanFs): Promise<boolean> {
  try {
    const stat = await fs.lstat(join(folder, '.git'));
    return stat.isDirectory || stat.isFile;
  } catch {
    return false;
  }
}

async function childFolders(folder: string, fs: ScanFs): Promise<string[]> {
  const names = (await fs.readdir(folder)).sort();
  const folders: string[] = [];
  for (const name of names) {
    if (!isExcludedDirectory(name) && !name.startsWith('.')) {
      const path = join(folder, name);
      const stat = await fs.lstat(path);
      if (stat.isDirectory && !stat.isSymbolicLink) {
        folders.push(path);
      }
    }
  }
  return folders;
}

/**
 * The projects to scan under `root`, in name order: `[root]` when it is a git repository or holds
 * none; otherwise every git repository at depth 1, and at depth 2 under a folder that is not one.
 */
export async function findProjects(root: string, fs: ScanFs): Promise<string[]> {
  if (await isGitRepository(root, fs)) {
    return [root];
  }
  const projects: string[] = [];
  for (const child of await childFolders(root, fs)) {
    if (await isGitRepository(child, fs)) {
      projects.push(child);
    } else {
      for (const grandchild of await childFolders(child, fs)) {
        if (await isGitRepository(grandchild, fs)) {
          projects.push(grandchild);
        }
      }
    }
  }
  return projects.length === 0 ? [root] : projects;
}

function mergeServices(results: readonly ScanResult[]): ServiceFinding[] {
  const byKey = new Map<string, ServiceFinding>();
  for (const service of results.flatMap((result) => result.services)) {
    const seen = byKey.get(service.key);
    if (seen === undefined) {
      byKey.set(service.key, { ...service, evidence: { ...service.evidence } });
    } else {
      const evidence = { ...seen.evidence };
      for (const kind of EVIDENCE_KINDS) {
        evidence[kind] += service.evidence[kind];
      }
      const deeper = depthToNumber(service.depth) > depthToNumber(seen.depth);
      byKey.set(service.key, { ...(deeper ? service : seen), evidence });
    }
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key, 'en'));
}

/**
 * Merges the results of several projects: evidence and counts add up, a service keeps its deepest
 * depth with that project's level and reasoning, and technology scores add up.
 */
export function mergeScanResults(results: readonly ScanResult[]): ScanResult {
  const technologies = new Map<string, ScanResult['technologies'][number]>();
  for (const tech of results.flatMap((result) => result.technologies)) {
    const seen = technologies.get(tech.key);
    technologies.set(
      tech.key,
      seen === undefined
        ? { ...tech }
        : {
            ...seen,
            files: seen.files + tech.files,
            declarations: seen.declarations + tech.declarations,
            score: seen.score + tech.score,
          },
    );
  }
  const skipped = { ...results[0]?.skipped } as ScanResult['skipped'];
  for (const result of results.slice(1)) {
    for (const reason of Object.keys(skipped) as (keyof ScanResult['skipped'])[]) {
      skipped[reason] += result.skipped[reason];
    }
  }
  return {
    services: mergeServices(results),
    technologies: [...technologies.values()].sort(
      (a, b) => b.score - a.score || (a.key < b.key ? -1 : 1),
    ),
    unmappedCount: results.reduce((sum, result) => sum + result.unmappedCount, 0),
    filesRead: results.reduce((sum, result) => sum + result.filesRead, 0),
    skipped,
    truncated: results.some((result) => result.truncated),
    pythonAnalysed: results.every((result) => result.pythonAnalysed),
  };
}
