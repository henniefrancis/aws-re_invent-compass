import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { mcpTools } from '@compass/contracts';
import type { McpToolName } from '@compass/contracts';
import { TOOL_SPECS } from '../../src/server/tool-registry.js';
import { repoRoot } from '../support/fake-catalog.js';

const readme = readFile(join(repoRoot(), 'packages', 'mcp-server', 'README.md'), 'utf8');
const names = Object.keys(mcpTools) as McpToolName[];

describe('the package README', () => {
  test('opens with the unofficial line and the not-affiliated statement', async () => {
    const text = await readme;
    expect(text).toContain('**Unofficial. Your badge is your ticket.**');
    expect(text).toContain('not affiliated with, endorsed by or sponsored by AWS or Amazon');
  });

  test('lists all seventeen tools with the class the registry gives them', async () => {
    const text = await readme;
    const classes = { read: 'read', localAction: 'local action', write: 'write' } as const;
    for (const name of names) {
      const row = text.split('\n').find((line) => line.startsWith(`| \`${name}\``));
      expect(row, name).toBeDefined();
      expect(row?.split('|')[2]?.trim()).toBe(classes[TOOL_SPECS[name].class]);
    }
    expect(names).toHaveLength(17);
  });

  test('allows only the four read tools to be auto-approved and says write tools never are', async () => {
    const text = await readme;
    const reads = names.filter((n) => TOOL_SPECS[n].class === 'read');
    expect(reads).toHaveLength(4);
    expect(text).toContain(`"autoApprove": [${reads.map((n) => `"${n}"`).join(', ')}]`);
    expect(text).toContain('**Write tools must never be auto-approved.**');
    expect(text).toContain('including `sync_passes`, which can void passes');
    const snippet = /"autoApprove": \[(.*)\]/.exec(text)?.[1] ?? '';
    for (const name of names.filter((n) => TOOL_SPECS[n].class === 'write')) {
      expect(snippet).not.toContain(name);
    }
  });

  test('documents setup for Kiro, Claude Desktop, VS Code and the Kiro CLI with official links', async () => {
    const text = await readme;
    for (const heading of [
      '### Kiro (the Power)',
      '### Claude Desktop',
      '### VS Code',
      '### Kiro CLI',
    ]) {
      expect(text).toContain(heading);
    }
    for (const url of [
      'https://kiro.dev/docs/mcp/configuration/',
      'https://modelcontextprotocol.io/docs/develop/connect-local-servers',
      'https://code.visualstudio.com/docs/copilot/customization/mcp-servers',
      'https://kiro.dev/docs/mcp/',
      'https://kiro.dev/docs/reference/cli-commands/',
    ]) {
      expect(text).toContain(url);
    }
    expect(text).toContain('"servers": {');
    expect(text).toContain('claude_desktop_config.json');
    expect(text).toContain('.kiro/settings/mcp.json');
  });

  test('documents both GitHub import forms for the Power (CTO review M11)', async () => {
    const text = await readme;
    expect(text).toContain('https://github.com/henniefrancis/aws-re_invent-compass`');
    expect(text).toContain(
      'https://github.com/henniefrancis/aws-re_invent-compass/tree/main/power`',
    );
  });

  test('says hooks are Kiro only and that the server guardrail runs regardless', async () => {
    const text = await readme;
    expect(text).toContain('## Hooks (Kiro only)');
    expect(text).toContain('only Kiro runs');
    expect(text).toContain('runs inside the Compass server');
  });

  test('documents simulated mode, the demo, what leaves the machine, depth and the threat model', async () => {
    const text = await readme;
    for (const phrase of [
      'COMPASS_MODE=simulated',
      'SIMULATED MODE: no real data.',
      'demo',
      '## What leaves your machine',
      '## How depth is worked out',
      '## Threat model',
      'the local copy risk',
      'claim the npm package name `reinvent-compass`',
      'No OS keychain is available',
    ]) {
      expect(text).toContain(phrase);
    }
  });

  test('has no em dash or en dash', async () => {
    const text = await readme;
    expect(text).not.toContain(String.fromCharCode(0x2013));
    expect(text).not.toContain(String.fromCharCode(0x2014));
  });
});
