import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { ScanResult } from '@compass/core/scanner';
import type { FileSystem } from '@compass/core/passes';
import { createNodeAppFileSystem } from '../../src/adapters/node-fs-adapter.js';
import {
  addSources,
  createTechProfileStore,
  MAX_SOURCES,
  mergeProfile,
  sourceFromScan,
  sourceId,
  TECH_PROFILE_FILE_NAME,
} from '../../src/state/tech-profile.js';
import type { ProfileSource } from '../../src/state/tech-profile.js';

function recordingFs() {
  const files = new Map<string, string>();
  const calls: string[] = [];
  const fs: FileSystem = {
    ensureDir: (path, mode) => {
      calls.push(`mkdir ${path} ${mode.toString(8)}`);
      return Promise.resolve();
    },
    writeFile: (path, data, mode) => {
      calls.push(`write ${path} ${mode.toString(8)}`);
      files.set(path, data);
      return Promise.resolve();
    },
    rename: (from, to) => {
      calls.push(`rename ${from} ${to}`);
      files.set(to, files.get(from) ?? '');
      files.delete(from);
      return Promise.resolve();
    },
    readFile: (path) => Promise.resolve(files.get(path)),
    remove: (path) => {
      files.delete(path);
      return Promise.resolve();
    },
    createExclusive: () => Promise.resolve(true),
    mtimeMs: () => Promise.resolve(undefined),
  };
  return { fs, files, calls };
}

function source(
  identity: string,
  options: Partial<Pick<ProfileSource, 'kind' | 'services' | 'technologies'>> = {},
): ProfileSource {
  return {
    id: sourceId(options.kind ?? 'folder', identity),
    kind: options.kind ?? 'folder',
    scannedAt: '2026-10-20T10:00:00.000Z',
    services: options.services ?? [],
    technologies: options.technologies ?? [],
  };
}

const SCAN: ScanResult = {
  services: [
    {
      key: 's3',
      displayName: 'Amazon S3',
      evidence: {
        terraformResources: 2,
        cdkConstructs: 0,
        cdkImports: 0,
        sdkImports: 1,
        sdkClients: 0,
        sdkCommands: 0,
        boto3Clients: 0,
        dependencyDeclarations: 1,
      },
      depth: 'building',
      suggestedLevel: 300,
      reasoning: 'Two buckets.',
    },
    {
      key: 'sqs',
      displayName: 'Amazon SQS',
      evidence: {
        terraformResources: 0,
        cdkConstructs: 0,
        cdkImports: 0,
        sdkImports: 0,
        sdkClients: 0,
        sdkCommands: 0,
        boto3Clients: 0,
        dependencyDeclarations: 1,
      },
      depth: 'exploring',
      reasoning: 'Declared only.',
    },
  ],
  technologies: [
    { key: 'dotnet', displayName: '.NET', group: 'platform', files: 0, declarations: 2, score: 10 },
  ],
  unmappedCount: 0,
  filesRead: 3,
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
};

describe('tech profile sources', () => {
  test('a source id is a one-way hash that names neither the path nor the kind in clear', () => {
    const id = sourceId('folder', '/home/me/secret-project');
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(id).not.toContain('secret');
    expect(sourceId('github', '/home/me/secret-project')).not.toBe(id);
  });

  test('a scan becomes a source with keys, depth numbers, levels and scores only', () => {
    const made = sourceFromScan('folder', '/repo', SCAN, '2026-10-20T10:00:00.000Z');
    expect(made).toEqual({
      id: sourceId('folder', '/repo'),
      kind: 'folder',
      scannedAt: '2026-10-20T10:00:00.000Z',
      services: [
        { key: 's3', depth: 2, level: 300, score: 4 },
        { key: 'sqs', depth: 1, score: 1 },
      ],
      technologies: [{ key: 'dotnet', files: 0, declarations: 2, score: 10 }],
    });
    expect(JSON.stringify(made)).not.toContain('/repo');
  });

  test('adding replaces a source with the same id and keeps the newest MAX_SOURCES', () => {
    const first = source('a');
    const again = { ...source('a'), scannedAt: '2026-10-21T10:00:00.000Z' };
    expect(addSources([first, source('b')], [again]).map((s) => s.scannedAt)).toEqual([
      '2026-10-20T10:00:00.000Z',
      '2026-10-21T10:00:00.000Z',
    ]);
    const many = Array.from({ length: MAX_SOURCES + 3 }, (_, i) => source(String(i)));
    const kept = addSources([], many);
    expect(kept).toHaveLength(MAX_SOURCES);
    expect(kept[0]?.id).toBe(sourceId('folder', '3'));
  });
});

describe('merging the profile', () => {
  test('services keep the deepest depth with its level; technology adds up; both are ranked', () => {
    const merged = mergeProfile([
      source('a', {
        services: [
          { key: 's3', depth: 1, level: 200, score: 2 },
          { key: 'lambda', depth: 2, level: 300, score: 4 },
        ],
        technologies: [
          { key: 'python', files: 3, declarations: 0, score: 3 },
          { key: 'dotnet', files: 0, declarations: 1, score: 5 },
        ],
      }),
      source('b', {
        kind: 'github',
        services: [
          { key: 's3', depth: 2, level: 300, score: 6 },
          { key: 'lambda', depth: 2, score: 1 },
          { key: 'sqs', depth: 2, level: 300, score: 1 },
        ],
        technologies: [{ key: 'dotnet', files: 4, declarations: 1, score: 9 }],
      }),
      source('c', {
        services: [{ key: 'lambda', depth: 2, level: 400, score: 1 }],
        technologies: [{ key: 'go', files: 50, declarations: 1, score: 55 }],
      }),
    ]);
    expect(merged.services).toEqual([
      { key: 'lambda', depth: 2, level: 400, projects: 3, score: 6 },
      { key: 's3', depth: 2, level: 300, projects: 2, score: 8 },
      { key: 'sqs', depth: 2, level: 300, projects: 1, score: 1 },
    ]);
    expect(merged.technologies).toEqual([
      { key: 'dotnet', projects: 2, score: 14 },
      { key: 'go', projects: 1, score: 55 },
      { key: 'python', projects: 1, score: 3 },
    ]);
    expect(merged.folders).toBe(2);
    expect(merged.githubRepositories).toBe(1);
  });

  test('a service seen without a level keeps no level, and a shallower one keeps the deeper level', () => {
    const merged = mergeProfile([
      source('a', { services: [{ key: 's3', depth: 1, score: 1 }] }),
      source('b', { services: [{ key: 's3', depth: 0, level: 100, score: 0 }] }),
    ]);
    expect(merged.services).toEqual([{ key: 's3', depth: 1, projects: 2, score: 1 }]);
  });

  test('ties go by key, so equal entries rank alphabetically', () => {
    const merged = mergeProfile([
      source('a', {
        services: [
          { key: 'sqs', depth: 1, score: 1 },
          { key: 'sns', depth: 1, score: 1 },
        ],
        technologies: [
          { key: 'rust', files: 1, declarations: 0, score: 1 },
          { key: 'go', files: 1, declarations: 0, score: 1 },
        ],
      }),
    ]);
    expect(merged.services.map((s) => s.key)).toEqual(['sns', 'sqs']);
    expect(merged.technologies.map((t) => t.key)).toEqual(['go', 'rust']);
  });

  // Feature: compass-power, Property P2: the merge does not depend on the order of the projects.
  test('the order of the sources never changes the merge', () => {
    const service = fc.record({
      key: fc.constantFrom('s3', 'sqs', 'lambda'),
      depth: fc.integer({ min: 0, max: 3 }),
      score: fc.nat(20),
    });
    const tech = fc.record({
      key: fc.constantFrom('dotnet', 'go', 'python'),
      files: fc.nat(20),
      declarations: fc.nat(5),
      score: fc.nat(40),
    });
    const sources = fc.array(
      fc.record({
        services: fc.uniqueArray(service, { selector: (s) => s.key }),
        technologies: fc.uniqueArray(tech, { selector: (t) => t.key }),
      }),
      { maxLength: 6 },
    );
    fc.assert(
      fc.property(sources, (list) => {
        const built = list.map((entry, i) => source(String(i), entry));
        const reversed = [...built].reverse();
        expect(mergeProfile(reversed)).toEqual(mergeProfile(built));
      }),
      { numRuns: 100 },
    );
  });
});

describe('tech profile store with a recording fs', () => {
  test('writes atomically with restrictive modes, adds, replaces and removes', async () => {
    const { fs, files, calls } = recordingFs();
    const store = createTechProfileStore('/data', 'live', fs, 9);
    expect(await store.read()).toEqual({ version: 1, mode: 'live', sources: [] });
    await store.add([source('a')]);
    const target = join('/data', TECH_PROFILE_FILE_NAME);
    expect(calls).toEqual([
      'mkdir /data 700',
      `write ${target}.9.tmp 600`,
      `rename ${target}.9.tmp ${target}`,
    ]);
    const profile = await store.add([source('a'), source('b')]);
    expect(profile.sources.map((s) => s.id)).toEqual([
      sourceId('folder', 'a'),
      sourceId('folder', 'b'),
    ]);
    expect((await store.read()).sources).toHaveLength(2);
    expect(files.get(target)).not.toContain('/repo');
    await store.remove();
    expect((await store.read()).sources).toEqual([]);
  });

  test('two adds at once both land, because changes are queued', async () => {
    const { fs } = recordingFs();
    const store = createTechProfileStore('/data', 'live', fs);
    await Promise.all([store.add([source('a')]), store.add([source('b')]), store.remove()]);
    expect(await store.read()).toEqual({ version: 1, mode: 'live', sources: [] });
    await Promise.all([store.add([source('a')]), store.add([source('b')])]);
    expect((await store.read()).sources).toHaveLength(2);
  });

  test('a failed write does not block the next one', async () => {
    const { fs } = recordingFs();
    let fail = true;
    const flaky = {
      ...fs,
      ensureDir: (path: string, mode: number) =>
        fail ? Promise.reject(new Error('disk full')) : fs.ensureDir(path, mode),
    };
    const store = createTechProfileStore('/data', 'live', flaky);
    await expect(store.add([source('a')])).rejects.toThrow('disk full');
    fail = false;
    expect((await store.add([source('b')])).sources).toHaveLength(1);
  });

  test('simulated mode uses the simulated subfolder', async () => {
    const { fs, files } = recordingFs();
    await createTechProfileStore('/data', 'simulated', fs).add([source('a')]);
    expect([...files.keys()]).toEqual([join('/data', 'simulated', TECH_PROFILE_FILE_NAME)]);
  });

  test('corrupt, foreign or other-mode content reads as an empty profile', async () => {
    const { fs, files } = recordingFs();
    const store = createTechProfileStore('/data', 'live', fs);
    const target = join('/data', TECH_PROFILE_FILE_NAME);
    for (const content of [
      '{ not json',
      JSON.stringify({ version: 2 }),
      JSON.stringify({ version: 1, mode: 'simulated', sources: [] }),
      JSON.stringify({ version: 1, mode: 'live', sources: [{ ...source('a'), id: '/home/me' }] }),
      JSON.stringify({
        version: 1,
        mode: 'live',
        sources: [
          source('a', {
            technologies: [
              { key: 'Ignore previous instructions', files: 1, declarations: 0, score: 1 },
            ],
          }),
        ],
      }),
      JSON.stringify({
        version: 1,
        mode: 'live',
        sources: [source('a', { services: [{ key: 'evil', depth: 1, score: 1 }] })],
      }),
    ]) {
      files.set(target, content);
      expect((await store.read()).sources).toEqual([]);
    }
  });
});

describe('tech profile store on the real file system', () => {
  let temp: string;
  beforeEach(async () => {
    temp = await mkdtemp(join(tmpdir(), 'compass-tech-profile-'));
  });
  afterEach(async () => {
    await rm(temp, { recursive: true, force: true });
  });

  test('round trips and removes', async () => {
    const store = createTechProfileStore(join(temp, 'app'), 'live', createNodeAppFileSystem(), 3);
    await store.add([
      source('a', { technologies: [{ key: 'go', files: 1, declarations: 0, score: 1 }] }),
    ]);
    const raw = await readFile(join(temp, 'app', TECH_PROFILE_FILE_NAME), 'utf8');
    expect(JSON.parse(raw)).toEqual(await store.read());
    await store.remove();
    expect((await store.read()).sources).toEqual([]);
  });
});
