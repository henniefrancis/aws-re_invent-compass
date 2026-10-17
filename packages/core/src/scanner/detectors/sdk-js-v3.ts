// The AWS SDK for JavaScript v3 detector (Requirements 2.3 and 2.6).
//
// Counted: each import (`from '<pkg>'`) or `require('<pkg>')` of `@aws-sdk/client-<name>`,
// `@aws-sdk/lib-dynamodb` or `@aws-sdk/lib-storage` as an SDK import; each
// `new <Name>Client(` as an SDK client; each `new <Name>Command(` as an SDK command.
// Clients and commands are counted only in a file that imports at least one SDK package,
// so unrelated classes with those suffixes elsewhere are not counted.
//
// Attribution rule: a client is attributed by its client name (`S3` in `S3Client`).
// A command is attributed to the imported service when every SDK package the file imports
// belongs to one service (so `client-dynamodb` plus `lib-dynamodb` is one service), and
// otherwise to nothing (counted as unmapped). Whole-line `//` comments are ignored.

import { resolveService } from '../service-table.js';
import { addHit, codeLines, grp } from './text.js';
import type { Detector, DetectorHit } from './types.js';

const PACKAGE = '@aws-sdk/(?:client-[a-z0-9-]+|lib-dynamodb|lib-storage)';
const IMPORT_FROM = new RegExp(`\\bfrom\\s*['"](${PACKAGE})['"]`, 'g');
const REQUIRE = new RegExp(`\\brequire\\(\\s*['"](${PACKAGE})['"]\\s*\\)`, 'g');
const CLIENT = /\bnew\s+([A-Z][A-Za-z0-9]*)Client\s*\(/g;
const COMMAND = /\bnew\s+([A-Z][A-Za-z0-9]*)Command\s*\(/g;

export const sdkJsV3Detector: Detector = {
  id: 'sdk-js-v3',
  accepts: (fileName) => /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/.test(fileName),
  detect: (text) => {
    const hits: DetectorHit[] = [];
    const source = codeLines(text, ['//']).join('\n');
    const packages: string[] = [];
    for (const match of [...source.matchAll(IMPORT_FROM), ...source.matchAll(REQUIRE)]) {
      const name = grp(match, 1);
      packages.push(name);
      addHit(hits, {
        identifierKind: 'sdkPackage',
        identifier: name,
        kind: 'sdkImports',
        count: 1,
      });
    }
    if (packages.length === 0) {
      return hits;
    }

    for (const match of source.matchAll(CLIENT)) {
      addHit(hits, {
        identifierKind: 'sdkClientName',
        identifier: grp(match, 1),
        kind: 'sdkClients',
        count: 1,
      });
    }

    const services = new Set(
      packages.map((name) => resolveService('sdkPackage', name) ?? `unmapped:${name}`),
    );
    const commandOwner = services.size === 1 ? packages[0] : undefined;
    const commands = [...source.matchAll(COMMAND)].length;
    if (commands > 0) {
      addHit(hits, {
        identifierKind: 'sdkPackage',
        identifier: commandOwner ?? '',
        kind: 'sdkCommands',
        count: commands,
      });
    }
    return hits;
  },
};
