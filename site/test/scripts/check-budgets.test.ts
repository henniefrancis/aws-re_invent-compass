import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import {
  DEMO_ENTRY_POINT,
  LIMITS,
  closure,
  demoFiles,
  evaluateBudgets,
  gzipSize,
  initialFiles,
  runCli,
  runDefault,
} from '../../scripts/check-budgets.mjs';

type Outputs = Parameters<typeof closure>[0];

// A metafile shaped like the one the Angular 22.2.3 builder writes as browser-stats.json.
const OUTPUTS: Outputs = {
  'main-AAA.js': {
    bytes: 1000,
    entryPoint: 'src/main.ts',
    imports: [
      { path: 'home-BBB.js', kind: 'dynamic-import' },
      { path: 'demo-CCC.js', kind: 'dynamic-import' },
    ],
  },
  'home-BBB.js': {
    bytes: 100,
    entryPoint: 'src/app/pages/home/home-page.component.ts',
    imports: [{ path: 'main-AAA.js', kind: 'import-statement' }],
  },
  'demo-CCC.js': {
    bytes: 100,
    entryPoint: DEMO_ENTRY_POINT,
    imports: [
      { path: 'main-AAA.js', kind: 'import-statement' },
      { path: 'shared-DDD.js', kind: 'import-statement' },
      { path: 'lazy-EEE.js', kind: 'dynamic-import' },
    ],
  },
  'shared-DDD.js': { bytes: 50 },
  'lazy-EEE.js': { bytes: 10, imports: [] },
};

const INDEX_HTML = `<html><head><link rel="stylesheet" href="styles-X.css"><link rel="icon" href="a.svg"></head><body><script src="main-AAA.js" type="module"></script><link rel="modulepreload" href="home-BBB.js"><script type="module">1</script><script src="classic.js"></script></body></html>`;

describe('budget helpers', () => {
  test('gzipSize is the gzip level 9 length', () => {
    const data = Buffer.from('a'.repeat(5000));
    expect(gzipSize(data)).toBe(gzipSync(data, { level: 9 }).length);
  });

  test('initialFiles lists module scripts and modulepreload links with a target', () => {
    expect(initialFiles(INDEX_HTML)).toEqual(['main-AAA.js', 'home-BBB.js']);
  });

  test('closure follows static imports only and tolerates unknown files', () => {
    expect(closure(OUTPUTS, ['demo-CCC.js']).sort()).toEqual([
      'demo-CCC.js',
      'main-AAA.js',
      'shared-DDD.js',
    ]);
    expect(closure(OUTPUTS, ['missing.js'])).toEqual(['missing.js']);
  });

  test('demoFiles is the demo closure minus the initial closure', () => {
    const initial = closure(OUTPUTS, ['main-AAA.js', 'home-BBB.js']);
    expect(demoFiles(OUTPUTS, initial).sort()).toEqual(['demo-CCC.js', 'shared-DDD.js']);
    expect(demoFiles({ 'main-AAA.js': {} }, ['main-AAA.js'])).toEqual([]);
  });

  test('evaluateBudgets reports measured and allowed sizes', () => {
    const ok = evaluateBudgets({ initial: 250_000, demo: 150_000 }, LIMITS);
    expect(ok.pass).toBe(true);
    expect(ok.lines).toEqual([
      'initial JavaScript: measured 250000 bytes gzip, allowed 250000 bytes gzip: ok',
      'Demo_Page route chunk: measured 150000 bytes gzip, allowed 150000 bytes gzip: ok',
    ]);
    const over = evaluateBudgets({ initial: 250_001, demo: 1 }, LIMITS);
    expect(over.pass).toBe(false);
    expect(over.lines[0]).toContain('OVER BUDGET');
    expect(evaluateBudgets({ initial: 1, demo: 150_001 }, LIMITS).pass).toBe(false);
  });

  test('the limits are 250,000 and 150,000 bytes', () => {
    expect(LIMITS).toEqual({ initial: 250_000, demo: 150_000 });
  });
});

describe('Property 17: The budget check measures and classifies chunks correctly', () => {
  // Feature: showcase-site, Property 17: The budget check measures and classifies chunks correctly

  /** A random acyclic graph: file i may import only files with a higher index. */
  const graph = fc
    .integer({ min: 2, max: 12 })
    .chain((size) =>
      fc.tuple(
        fc.constant(size),
        fc.array(fc.array(fc.tuple(fc.nat(size - 1), fc.boolean()), { maxLength: 4 }), {
          minLength: size,
          maxLength: size,
        }),
        fc.integer({ min: 0, max: size - 1 }),
      ),
    )
    .map(([size, edges, demoIndex]) => {
      const outputs: Outputs = {};
      for (let i = 0; i < size; i += 1) {
        outputs[`f${String(i)}.js`] = {
          imports: (edges[i] ?? [])
            .filter(([target]) => target > i)
            .map(([target, isStatic]) => ({
              path: `f${String(target)}.js`,
              kind: isStatic ? 'import-statement' : 'dynamic-import',
            })),
          ...(i === demoIndex ? { entryPoint: DEMO_ENTRY_POINT } : {}),
        };
      }
      return { outputs, size };
    });

  function reachable(outputs: Outputs, start: string, seen = new Set<string>()): Set<string> {
    seen.add(start);
    for (const edge of outputs[start]?.imports ?? []) {
      if (edge.kind === 'import-statement' && !seen.has(edge.path)) {
        reachable(outputs, edge.path, seen);
      }
    }
    return seen;
  }

  test('closure returns exactly the files reachable through static imports', () => {
    fc.assert(
      fc.property(graph, fc.nat(11), ({ outputs, size }, startRaw) => {
        const start = `f${String(startRaw % size)}.js`;
        expect(new Set(closure(outputs, [start]))).toEqual(reachable(outputs, start));
      }),
      { numRuns: 200 },
    );
  });

  test('demoFiles equals the demo closure minus the initial closure', () => {
    fc.assert(
      fc.property(graph, fc.nat(11), ({ outputs, size }, startRaw) => {
        const initial = closure(outputs, [`f${String(startRaw % size)}.js`]);
        const demoChunk = Object.keys(outputs).find(
          (f) => outputs[f]?.entryPoint === DEMO_ENTRY_POINT,
        );
        const expected = [...reachable(outputs, demoChunk ?? '')].filter(
          (f) => !initial.includes(f),
        );
        expect(new Set(demoFiles(outputs, initial))).toEqual(new Set(expected));
      }),
      { numRuns: 200 },
    );
  });

  test('evaluateBudgets passes exactly when each total is at or under its limit', () => {
    const around = (limit: number): fc.Arbitrary<number> =>
      fc.integer({ min: limit - 3, max: limit + 3 });
    fc.assert(
      fc.property(around(LIMITS.initial), around(LIMITS.demo), (initial, demo) => {
        const result = evaluateBudgets({ initial, demo }, LIMITS);
        expect(result.pass).toBe(initial <= LIMITS.initial && demo <= LIMITS.demo);
        expect(result.lines).toHaveLength(2);
      }),
      { numRuns: 200 },
    );
  });
});

describe('runCli', () => {
  const files: Record<string, string> = {
    'index.html': INDEX_HTML,
    'main-AAA.js': 'a'.repeat(2000),
    'home-BBB.js': 'b'.repeat(200),
    'demo-CCC.js': 'c'.repeat(200),
    'shared-DDD.js': 'd'.repeat(100),
  };
  const read = (map: Record<string, string>) => (path: string) => {
    const name = path.split(/[\\/]/).pop() ?? '';
    return Promise.resolve(
      new TextEncoder().encode(
        name === 'stats.json' ? JSON.stringify({ outputs: OUTPUTS }) : (map[name] ?? ''),
      ),
    );
  };

  test('passes when both budgets hold and prints the measured sizes', async () => {
    const result = await runCli({ distDir: 'd', statsPath: 'd/stats.json', readFile: read(files) });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('budget check ok');
    expect(result.stdout).toContain('initial JavaScript: measured');
  });

  test('fails when a budget is exceeded and reports measured and allowed sizes', async () => {
    const noisy = new Uint8Array(randomBytes(300_000));
    const result = await runCli({
      distDir: 'd',
      statsPath: 'd/stats.json',
      readFile: (path) =>
        path.endsWith('main-AAA.js') ? Promise.resolve(noisy) : read(files)(path),
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('OVER BUDGET');
    expect(result.stderr).toContain('allowed 250000');
  });

  test('the default run reads a real folder and its metafile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'site-budget-'));
    try {
      const browser = join(root, 'browser');
      await mkdir(browser, { recursive: true });
      await writeFile(
        join(root, 'browser-stats.json'),
        JSON.stringify({ outputs: OUTPUTS }),
        'utf8',
      );
      for (const [name, text] of Object.entries(files)) {
        await writeFile(join(browser, name), text, 'utf8');
      }
      expect((await runDefault(browser)).code).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
