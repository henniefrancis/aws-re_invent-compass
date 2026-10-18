import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { parseHookInput, unwrapPowerCall } from '../../src/hooks/hook-input.js';
import {
  AWSEVENTS_BLOCK_REASON,
  COULD_NOT_CHECK_NOTE,
  preWriteGuardrail,
} from '../../src/hooks/pre-write-guardrail.js';
import type { HookDeps } from '../../src/hooks/pre-write-guardrail.js';
import { identifyTool } from '../../src/hooks/tool-names.js';
import { syntheticCatalogView } from '../support/fake-catalog.js';
import { createFakeRuntime } from '../support/fake-runtime.js';

// ADR-024 (SP1 on Kiro IDE 1.3.11): a Power's tools reach hooks as the built-in `kiro_powers`
// tool with the real tool inside `tool_input`. The fixtures are the recorded payload shapes.

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');

function arrange(verdict: 'block' | 'allow' | 'none' = 'block') {
  const fake = createFakeRuntime({ catalog: syntheticCatalogView() });
  fake.snapshot.current = {
    version: 1,
    mode: 'simulated',
    fetchedAt: fake.clock.now().toISOString(),
    eventWindow: fake.events.window,
    schedule: { reserved: [], favorites: [], personalTime: [] },
  } as never;
  if (verdict === 'block') {
    fake.rules.verdictFor = () => ({ decision: 'block', reasons: ['It clashes.'] });
  } else if (verdict === 'allow') {
    fake.rules.verdictFor = () => ({ decision: 'allow', reasons: [] });
  }
  const deps: HookDeps = {
    rules: fake.rules,
    snapshot: fake.snapshot,
    clock: fake.clock,
    catalog: () => fake.events.catalog(),
  };
  return { fake, deps };
}

describe('the recorded kiro_powers payload', () => {
  test('a reserve through the Compass power is judged from tool_input.arguments, and a block exits 2', async () => {
    const { deps } = arrange('block');
    for (const name of ['kiro-powers-reserve.json', 'kiro-powers-reserve-folder-import.json']) {
      const decision = await preWriteGuardrail(fixture(name), deps);
      expect([name, decision.exitCode]).toEqual([name, 2]);
      expect(decision.stderr).toContain('It clashes.');
      expect(decision.stdout).toBeUndefined();
    }
  });

  test('an allowed reserve is silent, and the arguments really were read', async () => {
    const { deps } = arrange('allow');
    expect(await preWriteGuardrail(fixture('kiro-powers-reserve.json'), deps)).toEqual({
      exitCode: 0,
    });
    const bad = JSON.parse(fixture('kiro-powers-reserve.json')) as {
      tool_input: { arguments: { sessionIds: string[] } };
    };
    bad.tool_input.arguments.sessionIds = ['ghost'];
    expect(await preWriteGuardrail(JSON.stringify(bad), deps)).toEqual({
      exitCode: 0,
      stdout: COULD_NOT_CHECK_NOTE,
    });
  });

  test('activation, other powers and other actions are ignored with exit 0 and no output', async () => {
    const { deps } = arrange('block');
    for (const name of ['kiro-powers-activate.json', 'kiro-powers-other-power.json']) {
      expect([name, await preWriteGuardrail(fixture(name), deps)]).toEqual([name, { exitCode: 0 }]);
    }
    const loaded = JSON.parse(fixture('kiro-powers-reserve.json')) as {
      tool_input: { action: string };
    };
    loaded.tool_input.action = 'readSteering';
    expect(await preWriteGuardrail(JSON.stringify(loaded), deps)).toEqual({ exitCode: 0 });
  });

  test('a write to the official server through a power is blocked', async () => {
    const { deps } = arrange('allow');
    expect(await preWriteGuardrail(fixture('kiro-powers-awsevents.json'), deps)).toEqual({
      exitCode: 2,
      stderr: AWSEVENTS_BLOCK_REASON,
    });
  });

  test('the direct mcp form still works, including the lower-cased workspace name', async () => {
    const { deps } = arrange('allow');
    expect(await preWriteGuardrail(fixture('mcp-direct-awsevents-write.json'), deps)).toEqual({
      exitCode: 2,
      stderr: AWSEVENTS_BLOCK_REASON,
    });
    // A lower-cased read of the official server is not a write tool and not a Compass tool.
    expect(await preWriteGuardrail(fixture('mcp-direct-awsevents.json'), deps)).toEqual({
      exitCode: 0,
      stdout: COULD_NOT_CHECK_NOTE,
    });
  });

  test('identifyTool resolves the exact lower-cased ids Kiro sends', () => {
    expect(identifyTool('mcp_awsevents_awseventspublicapi_mcp_prod___reservesessions')).toEqual({
      server: 'awsevents',
      tool: 'ReserveSessions',
    });
    expect(identifyTool('mcp_awsevents_awseventspublicapi_mcp_prod___deletepersonaltime')).toEqual({
      server: 'awsevents',
      tool: 'DeletePersonalTime',
    });
    expect(identifyTool('mcp_power-power-compass_reserve_with_guardrails')).toEqual({
      server: 'compass',
      tool: 'reserve_with_guardrails',
    });
  });
});

describe('unwrapPowerCall', () => {
  const call = (toolName: string, toolInput: unknown) => {
    const parsed = parseHookInput(JSON.stringify({ tool_name: toolName, tool_input: toolInput }));
    if (parsed === undefined) {
      throw new Error('fixture did not parse');
    }
    return unwrapPowerCall(parsed);
  };
  const use = (extra: Record<string, unknown>) => ({ action: 'use', ...extra });

  test('a direct tool name passes through unchanged', () => {
    expect(call('mcp_x_add_standby', { a: 1 })).toEqual({
      toolName: 'mcp_x_add_standby',
      toolInput: { a: 1 },
    });
  });

  test('the Compass server names are accepted, in any case and with a power prefix', () => {
    for (const serverName of [
      'compass',
      'Compass',
      'power-power-compass',
      'power-reinvent-compass-compass',
    ]) {
      expect(
        call('kiro_powers', use({ serverName, toolName: 'add_standby', arguments: { k: 1 } })),
      ).toEqual({ toolName: 'add_standby', toolInput: { k: 1 } });
    }
    expect(call('KIRO_POWERS', use({ serverName: 'compass', toolName: 'add_standby' }))).toEqual({
      toolName: 'add_standby',
      toolInput: undefined,
    });
  });

  test('the official server names are accepted too, so a stray copy in a Power is still blocked', () => {
    for (const serverName of ['awsevents', 'power-power-awsevents']) {
      expect(call('kiro_powers', use({ serverName, toolName: 'ReserveSessions' }))).toEqual({
        toolName: 'ReserveSessions',
        toolInput: undefined,
      });
    }
  });

  test('everything else is ignored', () => {
    const ignored: unknown[] = [
      undefined,
      null,
      'text',
      [],
      { action: 'activate', serverName: null, toolName: null },
      { action: 'use', serverName: 'sp1-probe', toolName: 'ProbeWrite' },
      { action: 'use', serverName: 'mycompass', toolName: 'add_standby' },
      { action: 'use', serverName: 'compass', toolName: 5 },
      { action: 'use', serverName: 7, toolName: 'add_standby' },
      { action: 'use', toolName: 'add_standby' },
    ];
    for (const toolInput of ignored) {
      expect(call('kiro_powers', toolInput)).toBe('ignore');
    }
  });
});
