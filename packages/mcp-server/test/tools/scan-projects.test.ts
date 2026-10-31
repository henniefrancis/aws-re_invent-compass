import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { ScanResult } from '@compass/core/scanner';
import {
  findProjects,
  MAX_PROJECTS,
  mergeScanResults,
  PROJECTS_BUDGET_MS,
} from '../../src/tools/scan-projects.js';
import { scanRepoTool } from '../../src/tools/scan-repo.js';
import { sourceId } from '../../src/state/tech-profile.js';
import { contextFor } from '../support/context.js';
import { createFakeRuntime } from '../support/fake-runtime.js';
import { repoScan } from '../support/fake-github.js';
import { MemoryScanFs } from '../support/memory-scan-fs.js';

describe('finding projects in a dev folder', () => {
  test('a git repository is one project, even when it holds others', async () => {
    const fs = new MemoryScanFs({ '.git/HEAD': 'x', 'sub/.git/HEAD': 'x', 'a.ts': '' });
    expect(await findProjects(fs.root, fs)).toEqual([fs.root]);
  });

  test('a folder with no repository is one project', async () => {
    const fs = new MemoryScanFs({ 'src/a.ts': '', 'docs/': '' });
    expect(await findProjects(fs.root, fs)).toEqual([fs.root]);
  });

  test('repositories at depth 1 and 2, in name order, skipping links, hidden and excluded folders', async () => {
    const fs = new MemoryScanFs({
      'zeta/.git/HEAD': 'x',
      'alpha/.git': 'gitdir: ../.git/worktrees/alpha',
      'alpha/nested/.git/HEAD': 'x',
      'work/api/.git/HEAD': 'x',
      'work/web/.git/HEAD': 'x',
      'work/deep/more/.git/HEAD': 'x',
      'node_modules/pkg/.git/HEAD': 'x',
      '.cache/thing/.git/HEAD': 'x',
      linked: { symlink: true },
      'notes.txt': 'x',
    });
    expect(await findProjects(fs.root, fs)).toEqual([
      join(fs.root, 'alpha'),
      join(fs.root, 'work', 'api'),
      join(fs.root, 'work', 'web'),
      join(fs.root, 'zeta'),
    ]);
  });
});

describe('merging project results', () => {
  test('evidence and counts add up, the deepest depth wins, technology scores add up', () => {
    const shallow: ScanResult = {
      ...repoScan('dotnet', 's3'),
      services: [
        {
          ...repoScan().services[0],
          depth: 'exploring',
          suggestedLevel: 100,
          reasoning: 'Shallow.',
        },
      ],
      unmappedCount: 1,
      truncated: true,
    };
    const deep = repoScan('dotnet', 's3');
    const other = { ...repoScan('go', 'sqs'), pythonAnalysed: false };
    const merged = mergeScanResults([shallow, deep, other]);
    expect(
      merged.services.map((s) => [s.key, s.depth, s.suggestedLevel, s.evidence.terraformResources]),
    ).toEqual([
      ['s3', 'building', 300, 2],
      ['sqs', 'building', 300, 1],
    ]);
    expect(merged.technologies).toEqual([
      {
        key: 'dotnet',
        displayName: 'dotnet',
        group: 'platform',
        files: 4,
        declarations: 2,
        score: 14,
      },
      { key: 'go', displayName: 'go', group: 'platform', files: 2, declarations: 1, score: 7 },
    ]);
    expect(merged).toMatchObject({
      unmappedCount: 1,
      filesRead: 6,
      truncated: true,
      pythonAnalysed: false,
    });
    const reversed = mergeScanResults([deep, shallow]);
    expect(reversed.services[0]).toMatchObject({ depth: 'building', reasoning: 'A resource.' });
  });

  test('technology ties go by key', () => {
    const merged = mergeScanResults([repoScan('go'), repoScan('dotnet')]);
    expect(merged.technologies.map((t) => t.key)).toEqual(['dotnet', 'go']);
  });
});

describe('scan_repo over a dev folder', () => {
  function devFolder(count: number) {
    const tree: Record<string, string> = {};
    for (let i = 0; i < count; i += 1) {
      tree[`p${String(i).padStart(3, '0')}/.git/HEAD`] = 'x';
    }
    const fs = new MemoryScanFs(tree);
    const fake = createFakeRuntime({ scanFs: fs, cwd: fs.root });
    return { fs, fake };
  }

  test('scans each repository on its own, adds each to the profile and says how many', async () => {
    const { fs, fake } = devFolder(3);
    const roots: string[] = [];
    fake.runtime.scanRunner = (root) => {
      roots.push(root);
      if (root.endsWith('p001')) {
        return Promise.reject(new Error('worker failed'));
      }
      return Promise.resolve(repoScan(root.endsWith('p000') ? 'dotnet' : 'go'));
    };
    const outcome = await scanRepoTool({ path: fs.root }, contextFor(fake));
    expect(roots).toEqual([join(fs.root, 'p000'), join(fs.root, 'p001'), join(fs.root, 'p002')]);
    expect(outcome.ok && outcome.text).toContain(
      'Found 3 projects and scanned 2 (skipped: 1 could not be scanned).',
    );
    expect(fake.techProfile.sources.map((s) => s.id)).toEqual([
      sourceId('folder', join(fs.root, 'p000')),
      sourceId('folder', join(fs.root, 'p002')),
    ]);
    expect(outcome.ok && outcome.text).not.toContain('p000');
  });

  test('a dev folder where every project is scanned lists no skips', async () => {
    const { fs, fake } = devFolder(2);
    fake.runtime.scanRunner = () => Promise.resolve(repoScan());
    const outcome = await scanRepoTool({ path: fs.root }, contextFor(fake));
    expect(outcome.ok && outcome.text).toContain('Found 2 projects and scanned 2.');
  });

  test('stops at MAX_PROJECTS and after the time budget', async () => {
    const { fs, fake } = devFolder(MAX_PROJECTS + 2);
    let scans = 0;
    fake.runtime.scanRunner = () => {
      scans += 1;
      if (scans === 2) {
        fake.clock.set(new Date(fake.clock.now().getTime() + PROJECTS_BUDGET_MS + 1).toISOString());
      }
      return Promise.resolve(repoScan());
    };
    const outcome = await scanRepoTool({ path: fs.root }, contextFor(fake));
    expect(scans).toBe(2);
    expect(outcome.ok && outcome.text).toContain(
      `Found ${String(MAX_PROJECTS + 2)} projects and scanned 2 (skipped: 2 over the limit of ${String(MAX_PROJECTS)}, ${String(MAX_PROJECTS - 2)} not started in time).`,
    );
  });

  test('when every project fails, nothing is added and the reply says so', async () => {
    const { fs, fake } = devFolder(2);
    fake.runtime.scanRunner = () => Promise.reject(new Error('worker failed'));
    const outcome = await scanRepoTool({ path: fs.root }, contextFor(fake));
    expect(outcome).toEqual({
      ok: false,
      message:
        'Found 2 projects and scanned 0 (skipped: 2 could not be scanned). Nothing was added to your tech list.',
    });
    expect(fake.techProfile.sources).toEqual([]);
  });
});
