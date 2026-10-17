// The AWS CDK TypeScript detector (Requirements 2.2 and 2.6).
//
// Imports counted: `from 'aws-cdk-lib/aws-<module>'` (one per statement) and each
// `aws_<module>` namespace named in an import from `aws-cdk-lib` (one per namespace).
// Constructs counted per instantiation from a CDK module: `new <alias>.<Class>(` where the
// alias is a namespace or an `aws_<module>` binding, `new <Class>(` where the class is a
// named import from a module path, and `new <lib>.aws_<module>.<Class>(` where the lib is
// a namespace import of `aws-cdk-lib`. Classes that do not come from a CDK module, such as
// `Stack` or unrelated classes, count for nothing. Whole-line `//` comments are ignored.

import { parseImports } from './imports.js';
import { addHit, codeLines, grp } from './text.js';
import type { Detector, DetectorHit } from './types.js';

const MODULE_PATH = /^aws-cdk-lib\/(aws-[a-z0-9-]+)$/;
const NAMESPACE_EXPORT = /^aws_([a-z0-9_]+)$/;
const NEW_EXPRESSION =
  /\bnew\s+([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?(?:\.([A-Za-z_$][\w$]*))?\s*\(/g;

function moduleFromNamespace(exportName: string): string | undefined {
  const match = NAMESPACE_EXPORT.exec(exportName);
  return match === null ? undefined : `aws-${grp(match, 1).replace(/_/g, '-')}`;
}

export const cdkTypescriptDetector: Detector = {
  id: 'cdk-typescript',
  accepts: (fileName) => /\.(?:ts|tsx|mts|cts)$/.test(fileName),
  detect: (text) => {
    const hits: DetectorHit[] = [];
    const source = codeLines(text, ['//']).join('\n');
    const aliases = new Map<string, string>();
    const classes = new Map<string, string>();
    const libraryNamespaces = new Set<string>();

    const countImport = (module: string): void => {
      addHit(hits, {
        identifierKind: 'cdkModule',
        identifier: module,
        kind: 'cdkImports',
        count: 1,
      });
    };

    for (const statement of parseImports(source)) {
      const path = MODULE_PATH.exec(statement.specifier);
      if (path !== null) {
        const module = grp(path, 1);
        countImport(module);
        if (statement.namespace !== undefined) {
          aliases.set(statement.namespace, module);
        }
        for (const binding of statement.named) {
          classes.set(binding.local, module);
        }
      } else if (statement.specifier === 'aws-cdk-lib') {
        if (statement.namespace !== undefined) {
          libraryNamespaces.add(statement.namespace);
        }
        for (const binding of statement.named) {
          const module = moduleFromNamespace(binding.imported);
          if (module !== undefined) {
            countImport(module);
            aliases.set(binding.local, module);
          }
        }
      }
    }

    for (const match of source.matchAll(NEW_EXPRESSION)) {
      const first = grp(match, 1);
      const second = match[2];
      const third = match[3];
      let module: string | undefined;
      if (second === undefined) {
        module = classes.get(first);
      } else if (third === undefined) {
        module = aliases.get(first);
      } else if (libraryNamespaces.has(first)) {
        module = moduleFromNamespace(second);
      }
      if (module !== undefined) {
        addHit(hits, {
          identifierKind: 'cdkModule',
          identifier: module,
          kind: 'cdkConstructs',
          count: 1,
        });
      }
    }
    return hits;
  },
};
