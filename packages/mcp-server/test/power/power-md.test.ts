import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { COMPASS_WRITE_TOOLS } from '../../src/hooks/tool-names.js';
import { TOOL_SPECS } from '../../src/server/tool-registry.js';
import { repoRoot } from '../support/fake-catalog.js';

const power = join(repoRoot(), 'power');

/**
 * Reads the simple front matter of POWER.md: `key: value` lines whose value is a quoted string or a
 * flow array of quoted strings, in either quote style, possibly continued on indented lines (the
 * formatter reflows long arrays).
 */
function frontMatter(text: string): { data: Record<string, unknown>; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (match === null) {
    throw new Error('POWER.md has no front matter');
  }
  const data: Record<string, unknown> = {};
  const joined = String(match[1]).replace(/\n\s+/g, ' ');
  for (const line of joined.split('\n')) {
    const pair = /^([A-Za-z]+): (.+)$/.exec(line);
    if (pair === null) {
      throw new Error(`unreadable front matter line: ${line}`);
    }
    const json = String(pair[2]).replace(/'((?:[^']|'')*)'/g, (_all, inner: string) =>
      JSON.stringify(inner.replaceAll("''", "'")),
    );
    data[String(pair[1])] = JSON.parse(json);
  }
  return { data, body: String(match[2]) };
}

const FrontMatter = z.strictObject({
  name: z.string(),
  displayName: z.string(),
  description: z.string(),
  keywords: z.array(z.string()),
  author: z.string(),
});

interface PluginJson {
  name: string;
  description: string;
  keywords: string[];
  author: { name: string };
}

const plugin = async (): Promise<PluginJson> =>
  JSON.parse(await readFile(join(power, 'plugin.json'), 'utf8')) as PluginJson;

describe('POWER.md (QA H3: Kiro needs a valid plugin.json or POWER.md at the power root)', () => {
  test('has the front matter fields of the original power format and nothing else', async () => {
    const { data } = frontMatter(await readFile(join(power, 'POWER.md'), 'utf8'));
    expect(() => FrontMatter.parse(data)).not.toThrow();
    expect(data.displayName).toBe('Reinvent Compass');
  });

  test('agrees with plugin.json on name, description, keywords and author', async () => {
    const { data } = frontMatter(await readFile(join(power, 'POWER.md'), 'utf8'));
    const manifest = await plugin();
    expect(data.name).toBe(manifest.name);
    expect(data.description).toBe(manifest.description);
    expect(data.keywords).toEqual(manifest.keywords);
    expect(data.author).toBe(manifest.author.name);
  });

  test('names the skills, the unofficial line and the approval rules, and lists every write tool', async () => {
    const { body } = frontMatter(await readFile(join(power, 'POWER.md'), 'utf8'));
    for (const skill of ['plan-my-week', 'first-timer-guide', 'install-hooks']) {
      expect(body).toContain(`\`${skill}\``);
    }
    expect(body).toContain('Unofficial. Your badge is your ticket.');
    expect(body).toContain('not affiliated with AWS or Amazon');
    const reads = Object.values(TOOL_SPECS)
      .filter(
        (spec) =>
          spec.class === 'read' && spec.name !== 'scan_repo' && spec.name !== 'show_schedule',
      )
      .map((spec) => spec.name);
    for (const name of reads) {
      expect(body).toContain(`\`${name}\``);
    }
    for (const name of COMPASS_WRITE_TOOLS) {
      expect(body).toContain(`\`${name}\``);
    }
    expect(body).toContain('`sync_passes` can void passes, so it is a write tool');
    expect(body).toContain('Never auto-approve a write tool');
    expect(body).toContain('`scan_repo` reads a folder of yours, so approve each scan');
    expect(body).toContain('`show_schedule` reads your schedule, so approve each call');
  });

  test('the front matter reader handles both quote styles, continued lines and refuses junk', () => {
    expect(frontMatter("---\na: 'it''s'\nb: [\"x\",\n  'y']\n---\nbody").data).toEqual({
      a: "it's",
      b: ['x', 'y'],
    });
    expect(() => frontMatter('no front matter')).toThrow('no front matter');
    expect(() => frontMatter('---\nnot a pair\n---\nbody')).toThrow('unreadable');
  });
});
