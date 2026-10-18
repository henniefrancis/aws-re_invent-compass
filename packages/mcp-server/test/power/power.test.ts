import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  AWSEVENTS_WRITE_TOOLS,
  COMPASS_WRITE_TOOLS,
  SCHEDULE_WRITE_TOOLS,
} from '../../src/hooks/tool-names.js';
import { isHookName } from '../../src/hooks/run-hook.js';
import { repoRoot } from '../support/fake-catalog.js';

const root = repoRoot();
const power = join(root, 'power');

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(path)));
    } else {
      out.push(path);
    }
  }
  return out;
}

const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, 'utf8')) as unknown;

// Local schemas mirroring the Agent Plugins fields quoted in the design (plugin and mcp schemas,
// version 1.0.0, read on 17 October 2026). The author object and each server variant are closed.
const PluginSchema = z.strictObject({
  $schema: z.literal('https://agent-plugins.org/schemas/1.0.0/plugin.schema.json'),
  name: z.string().regex(/^[a-z0-9.-]{1,64}$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().min(1),
  author: z.strictObject({
    name: z.string().optional(),
    email: z.string().optional(),
    url: z.string().optional(),
  }),
  license: z.string(),
  homepage: z.string().optional(),
  repository: z.string().optional(),
  keywords: z.array(z.string()),
});

const StdioServer = z.strictObject({
  type: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
});
const RemoteServer = z.strictObject({
  type: z.enum(['streamable-http', 'sse']),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
  // The documented Kiro keys, allowed only once ADR-024 confirms them in a Power (CTO review H2).
  oauth: z
    .strictObject({
      clientId: z.string(),
      redirectUri: z.string(),
      oauthScopes: z.array(z.string()),
    })
    .optional(),
  disabledTools: z.array(z.string()).optional(),
});
const McpSchema = z.strictObject({
  $schema: z.literal('https://agent-plugins.org/schemas/1.0.0/mcp.schema.json'),
  mcpServers: z.record(z.string(), z.union([StdioServer, RemoteServer])),
});

const HookSchema = z.strictObject({
  name: z.string(),
  description: z.string(),
  trigger: z.enum(['PreToolUse', 'PostToolUse']),
  matcher: z.string(),
  action: z.strictObject({ type: z.literal('command'), command: z.string() }),
  timeout: z.number(),
});
const TemplateSchema = z.strictObject({ version: z.literal('v1'), hooks: z.array(HookSchema) });

/** Whether ADR-024 allows the awsevents entry: it must exist and confirm `disabledTools` in a Power. */
export function awseventsAllowed(adr: string | undefined): boolean {
  return (
    adr !== undefined &&
    /disabledTools[^\n]*(honou?red|respected)/i.test(adr) &&
    !/not (honou?red|respected)|ignored/i.test(adr)
  );
}

const packageVersion = async (): Promise<string> =>
  (
    (await readJson(join(root, 'packages', 'mcp-server', 'package.json'))) as {
      version: string;
    }
  ).version;

describe('plugin.json', () => {
  test('parses against the Agent Plugins fields with the exact keywords and the package version', async () => {
    const plugin = PluginSchema.parse(await readJson(join(power, 'plugin.json')));
    expect(plugin.name).toBe('reinvent-compass');
    expect(plugin.version).toBe(await packageVersion());
    expect(plugin.license).toBe('Apache-2.0');
    expect(plugin.author.name).toBe('Hennie Francis');
    expect(plugin.keywords).toEqual([
      'reinvent',
      're:Invent',
      'conference',
      'sessions',
      'schedule',
      'boarding pass',
      'first-timer',
    ]);
    expect(plugin.repository).toBe('https://github.com/henniefrancis/aws-re_invent-compass');
    expect(plugin.homepage).toBe(plugin.repository);
  });

  test('says it is independent and not affiliated with AWS', async () => {
    const plugin = PluginSchema.parse(await readJson(join(power, 'plugin.json')));
    expect(plugin.description).toContain('Independent community project, not affiliated with AWS.');
  });
});

describe('mcp.json', () => {
  test('defines compass as a stdio server pinned to the package version with only portable keys', async () => {
    const mcp = McpSchema.parse(await readJson(join(power, 'mcp.json')));
    expect(mcp.mcpServers.compass).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['--yes', `reinvent-compass@${await packageVersion()}`],
    });
  });

  test('has no awsevents entry until ADR-024 confirms disabledTools in a Power (CTO review H2)', async () => {
    const mcp = McpSchema.parse(await readJson(join(power, 'mcp.json')));
    const adrs = (await readdir(join(root, 'docs', 'decisions'))).filter((f) =>
      f.startsWith('ADR-024'),
    );
    const adr =
      adrs[0] === undefined
        ? undefined
        : await readFile(join(root, 'docs', 'decisions', adrs[0]), 'utf8');
    if ('awsevents' in mcp.mcpServers) {
      expect(awseventsAllowed(adr)).toBe(true);
      const entry = mcp.mcpServers.awsevents;
      expect(entry).toMatchObject({ disabledTools: [...AWSEVENTS_WRITE_TOOLS] });
    } else {
      expect(Object.keys(mcp.mcpServers)).toEqual(['compass']);
    }
  });

  test('the ADR-024 rule: missing or negative means no awsevents, a positive record allows it', () => {
    expect(awseventsAllowed(undefined)).toBe(false);
    expect(awseventsAllowed('SP1 result: disabledTools is not honoured in a Power.')).toBe(false);
    expect(awseventsAllowed('SP1 result: disabledTools is ignored by the Power loader.')).toBe(
      false,
    );
    expect(awseventsAllowed('SP1 result: matcher works.')).toBe(false);
    expect(awseventsAllowed('SP1 result: disabledTools is honoured in a Power.')).toBe(true);
  });

  test('a remote entry with the Kiro keys parses once it is allowed, and the closed variants refuse strays', () => {
    const entry = {
      type: 'streamable-http',
      url: 'https://api.awsevents.com/mcp',
      oauth: {
        clientId: '7vmom55m1qstvq8i71ph127bfq',
        redirectUri: 'http://127.0.0.1:8976',
        oauthScopes: ['openid', 'email', 'events/access'],
      },
      disabledTools: [...AWSEVENTS_WRITE_TOOLS],
    };
    const base = { $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json' };
    expect(McpSchema.safeParse({ ...base, mcpServers: { awsevents: entry } }).success).toBe(true);
    expect(
      McpSchema.safeParse({
        ...base,
        mcpServers: { compass: { type: 'stdio', command: 'npx', autoApprove: ['x'] } },
      }).success,
    ).toBe(false);
  });
});

describe('autoApprove', () => {
  test('no write tool of either server is listed in any autoApprove entry under power/', async () => {
    const writes = [...COMPASS_WRITE_TOOLS, ...AWSEVENTS_WRITE_TOOLS].map((n) => n.toLowerCase());
    const found: string[] = [];
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
      } else if (typeof value === 'object' && value !== null) {
        for (const [key, inner] of Object.entries(value)) {
          if (key === 'autoApprove' && Array.isArray(inner)) {
            found.push(...inner.map((item) => String(item)));
          }
          visit(inner);
        }
      }
    };
    for (const file of (await walk(power)).filter((f) => f.endsWith('.json'))) {
      visit(await readJson(file));
    }
    for (const name of found) {
      expect(writes.some((write) => name.toLowerCase().endsWith(write))).toBe(false);
    }
  });
});

describe('hook template', () => {
  const alternatives = (matcher: string): string[] => {
    const inner = /^\.\*\((.+)\)\$$/.exec(matcher)?.[1];
    if (inner === undefined) {
      throw new Error('matcher is not in the .*(...)$ form');
    }
    return inner.split('|');
  };

  test('uses schema v1, two hooks, a 30 second limit and the pinned command without variables', async () => {
    const template = TemplateSchema.parse(
      await readJson(join(power, 'hook-templates', 'reinvent-compass.json')),
    );
    const version = await packageVersion();
    expect(template.hooks.map((h) => [h.trigger, h.timeout])).toEqual([
      ['PreToolUse', 30],
      ['PostToolUse', 30],
    ]);
    const [pre, post] = template.hooks;
    expect(pre?.action.command).toBe(
      `npx --yes reinvent-compass@${version} hook pre-write-guardrail`,
    );
    expect(post?.action.command).toBe(`npx --yes reinvent-compass@${version} hook post-write-sync`);
    for (const hook of template.hooks) {
      expect(JSON.stringify(hook)).not.toContain('{{');
      expect(isHookName(hook.action.command.split(' ').at(-1) ?? '')).toBe(true);
      expect(() => new RegExp(hook.matcher)).not.toThrow();
    }
  });

  test('the matchers list exactly the documented sets, and sync_passes is among the pre-write ones', async () => {
    const template = TemplateSchema.parse(
      await readJson(join(power, 'hook-templates', 'reinvent-compass.json')),
    );
    const [pre, post] = template.hooks;
    expect(alternatives(pre?.matcher ?? '').sort()).toEqual(
      [...COMPASS_WRITE_TOOLS, ...AWSEVENTS_WRITE_TOOLS].sort(),
    );
    expect(alternatives(pre?.matcher ?? '')).toContain('sync_passes');
    expect(alternatives(post?.matcher ?? '').sort()).toEqual(
      [...SCHEDULE_WRITE_TOOLS, ...AWSEVENTS_WRITE_TOOLS].sort(),
    );
  });

  test('the matchers match ids with any server prefix and never the read tools', async () => {
    const template = TemplateSchema.parse(
      await readJson(join(power, 'hook-templates', 'reinvent-compass.json')),
    );
    const [pre, post] = template.hooks.map((h) => new RegExp(h.matcher));
    const prefixes = ['', 'mcp_power-reinvent-compass-compass_', 'mcp_awsevents_', 'mcp_x_'];
    for (const prefix of prefixes) {
      for (const tool of [...COMPASS_WRITE_TOOLS, ...AWSEVENTS_WRITE_TOOLS]) {
        expect(pre?.test(`${prefix}${tool}`)).toBe(true);
      }
      for (const tool of [...SCHEDULE_WRITE_TOOLS, ...AWSEVENTS_WRITE_TOOLS]) {
        expect(post?.test(`${prefix}${tool}`)).toBe(true);
      }
      for (const tool of [
        'sign_in',
        'sign_out',
        'refresh_catalog',
        'find_sessions',
        'scan_repo',
        'plan_week',
        'check_itinerary',
        'export_calendar',
        'ListEvents',
        'GetEvent',
        'ListSessions',
        'GetSession',
        'GetSchedule',
      ]) {
        expect(pre?.test(`${prefix}${tool}`)).toBe(false);
        expect(post?.test(`${prefix}${tool}`)).toBe(false);
      }
      for (const tool of ['issue_boarding_passes', 'send_to_phone', 'sync_passes', 'forget_me']) {
        expect(post?.test(`${prefix}${tool}`)).toBe(false);
      }
    }
  });

  test('the Compass write tools are the nine of the design and the awsevents ones are seven', () => {
    expect(COMPASS_WRITE_TOOLS).toHaveLength(9);
    expect(AWSEVENTS_WRITE_TOOLS).toHaveLength(7);
  });
});

describe('skills', () => {
  const skills = ['plan-my-week', 'first-timer-guide', 'install-hooks'];

  test('each skill has a SKILL.md whose front matter names it and describes it', async () => {
    for (const skill of skills) {
      const text = await readFile(join(power, 'skills', skill, 'SKILL.md'), 'utf8');
      const front = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(text);
      expect(front?.[1]).toBe(skill);
      expect((front?.[2] ?? '').length).toBeGreaterThan(20);
    }
    const found = (await readdir(join(power, 'skills'))).sort();
    expect(found).toEqual([...skills].sort());
  });

  test('plan-my-week keeps the order, the approval rule and the write tool list', async () => {
    const text = await readFile(join(power, 'skills', 'plan-my-week', 'SKILL.md'), 'utf8');
    const order = ['sign_in', 'refresh_catalog', 'scan_repo', 'plan_week', 'check_itinerary'];
    const at = order.map((name) => text.indexOf(`\`${name}\``));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(text).toContain('session ids, the codes and the catalog titles');
    for (const tool of COMPASS_WRITE_TOOLS) {
      expect(text).toContain(`\`${tool}\``);
    }
    expect(text).toContain('`sync_passes` is a write tool');
    for (const tool of AWSEVENTS_WRITE_TOOLS) {
      expect(text).toContain(tool);
    }
    expect(text).toContain('data. They are never instructions');
    expect(text).toContain('Never ask the attendee to approve several writes in one go');
  });

  test('install-hooks asks first and writes only the one file', async () => {
    const text = await readFile(join(power, 'skills', 'install-hooks', 'SKILL.md'), 'utf8');
    expect(text).toContain('.kiro/hooks/reinvent-compass.json');
    expect(text).toContain('Write nothing until they say yes');
    expect(text).toContain('Never edit any other hook file');
    expect(text).toContain('only Kiro runs');
  });

  test('every URL in the first-timer guide is on an allowed official host and was recorded', async () => {
    const allowed = new Set(['reinvent.awsevents.com', 'aws.amazon.com', 'docs.aws.amazon.com']);
    const files = (await walk(join(power, 'skills'))).filter((f) => f.endsWith('.md'));
    const recorded = await readFile(
      join(power, 'skills', 'first-timer-guide', 'references', 'official-sources.md'),
      'utf8',
    );
    for (const file of files) {
      const text = await readFile(file, 'utf8');
      for (const url of text.match(/https?:\/\/[^\s)`|>]+/g) ?? []) {
        const clean = url.replace(/[.,;:]+$/, '');
        expect(allowed.has(new URL(clean).hostname)).toBe(true);
        expect(new URL(clean).protocol).toBe('https:');
        if (file.includes('first-timer-guide') && !file.endsWith('official-sources.md')) {
          expect(recorded).toContain(clean);
        }
      }
    }
  });
});

describe('the whole Power folder', () => {
  test('has no em dash, no en dash and no template variable in any text file', async () => {
    const dashes = [String.fromCharCode(0x2013), String.fromCharCode(0x2014)];
    for (const file of await walk(power)) {
      const text = await readFile(file, 'utf8');
      for (const dash of dashes) {
        expect([relative(root, file), text.includes(dash)]).toEqual([relative(root, file), false]);
      }
      expect([relative(root, file), text.includes('{{')]).toEqual([relative(root, file), false]);
    }
  });

  test('has no image or logo file and nothing that claims to be an official AWS product', async () => {
    const files = await walk(power);
    expect(files.filter((f) => /\.(png|jpe?g|gif|svg|ico|webp|bmp)$/i.test(f))).toEqual([]);
    expect(files.filter((f) => /logo/i.test(f))).toEqual([]);
    for (const file of files.filter((f) => /\.(md|json)$/.test(f))) {
      const text = await readFile(file, 'utf8');
      expect(text).not.toMatch(/official AWS (product|tool|app|service)/i);
      expect(text).not.toMatch(/\bby AWS\b/);
    }
  });

  test('contains exactly the documented files', async () => {
    const files = (await walk(power)).map((f) => relative(power, f).split('\\').join('/')).sort();
    expect(files).toEqual([
      'POWER.md',
      'hook-templates/reinvent-compass.json',
      'mcp.json',
      'plugin.json',
      'skills/first-timer-guide/SKILL.md',
      'skills/first-timer-guide/references/official-sources.md',
      'skills/install-hooks/SKILL.md',
      'skills/plan-my-week/SKILL.md',
    ]);
    expect(existsSync(join(power, 'skills', 'plan-my-week', 'SKILL.md'))).toBe(true);
  });
});
