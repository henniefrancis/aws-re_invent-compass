import { describe, expect, test } from 'vitest';
import { parseImports } from '../../src/scanner/detectors/imports.js';

describe('parseImports', () => {
  test('reads default, namespace, named, aliased and type imports', () => {
    const text = [
      "import a from 'pkg-a';",
      "import * as ns from 'pkg-b';",
      "import { x, y as z, type T } from 'pkg-c';",
      "import type { Only } from 'pkg-d';",
      'import   { spaced }\n   from\n"pkg-e";',
    ].join('\n');
    expect(parseImports(text)).toEqual([
      { specifier: 'pkg-a', named: [] },
      { specifier: 'pkg-b', namespace: 'ns', named: [] },
      {
        specifier: 'pkg-c',
        named: [
          { imported: 'x', local: 'x' },
          { imported: 'y', local: 'z' },
          { imported: 'T', local: 'T' },
        ],
      },
      { specifier: 'pkg-d', named: [{ imported: 'Only', local: 'Only' }] },
      { specifier: 'pkg-e', named: [{ imported: 'spaced', local: 'spaced' }] },
    ]);
  });

  test('statements that are not imports with a clause are skipped', () => {
    for (const text of [
      "import 'side-effect';",
      "reimport { a } from 'x';",
      "import{a} from 'x';",
      'import',
      'import ',
      'import { a } from',
      "import { a } from 'unterminated",
      "import { a } from '';",
      `import { a } from '${'p'.repeat(400)}';`,
      `import ${'a, '.repeat(200)} from 'x';`,
      'import { a } ; from "x"',
      "import { a } fro 'x'",
    ]) {
      expect(parseImports(text), text.slice(0, 40)).toEqual([]);
    }
  });

  test('an import after a skipped one is still found', () => {
    expect(parseImports("import 'a';\nimport { b } from 'pkg-b';")).toEqual([
      { specifier: 'pkg-b', named: [{ imported: 'b', local: 'b' }] },
    ]);
  });
});
