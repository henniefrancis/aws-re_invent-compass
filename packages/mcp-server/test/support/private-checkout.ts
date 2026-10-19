// A private copy of the resources the CLI reads (compass-power tasks 35 and 36). The pack smoke
// test rebuilds packages/mcp-server/dist while other files run, so a test that calls main must
// not read resources from it. This copy has no dist/, so every resource comes from the
// repository fallback, and nothing else writes to it.
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from './fake-catalog.js';

const FILES = [
  'packages/mcp-server/package.json',
  'data/venues.json',
  'fixtures/api',
  'fixtures/synthetic',
  'fixtures/sample-repo',
];

export interface PrivateCheckout {
  /** A module URL inside the copy, for the CLI host's moduleUrl. */
  moduleUrl: string;
  remove: () => Promise<void>;
}

export async function createPrivateCheckout(): Promise<PrivateCheckout> {
  const root = await mkdtemp(join(tmpdir(), 'compass-checkout-'));
  for (const file of FILES) {
    await cp(join(repoRoot(), file), join(root, file), { recursive: true });
  }
  return {
    moduleUrl: pathToFileURL(join(root, 'packages', 'mcp-server', 'src', 'cli', 'main.js')).href,
    remove: () => rm(root, { recursive: true, force: true }),
  };
}
