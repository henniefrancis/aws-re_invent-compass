import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { mcpTools } from '@compass/contracts';
import type { McpToolName, Verdict } from '@compass/contracts';
import { exitCodeFor } from '../../src/hooks/exit-policy.js';
import { parseHookInput } from '../../src/hooks/hook-input.js';
import { postWriteSync, SYNC_REMINDER } from '../../src/hooks/post-write-sync.js';
import {
  AWSEVENTS_BLOCK_REASON,
  COULD_NOT_CHECK_NOTE,
  SNAPSHOT_MAX_AGE_MS,
  preWriteGuardrail,
} from '../../src/hooks/pre-write-guardrail.js';
import type { HookDeps } from '../../src/hooks/pre-write-guardrail.js';
import { readStdin } from '../../src/hooks/read-stdin.js';
import { HOOK_NAMES, isHookName, runHook } from '../../src/hooks/run-hook.js';
import {
  AWSEVENTS_WRITE_TOOLS,
  COMPASS_WRITE_TOOLS,
  SCHEDULE_WRITE_TOOLS,
  identifyTool,
} from '../../src/hooks/tool-names.js';
import { syntheticCatalogView } from '../support/fake-catalog.js';
import { createFakeRuntime } from '../support/fake-runtime.js';
import { TRIPLE } from '../support/triple.js';

const COMPASS_TOOLS = Object.keys(mcpTools) as McpToolName[];
const ALL_NAMES: string[] = [...COMPASS_TOOLS, ...AWSEVENTS_WRITE_TOOLS];

// Feature: compass-power, Property 38: Hook tool names resolve whatever the server prefix
describe('Property 38: hook tool names resolve whatever the server prefix', () => {
  test('prefixed, bare and re-cased names resolve to the same identity', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-zA-Z0-9-]{1,24}$/),
        fc.constantFrom(...ALL_NAMES),
        fc.constantFrom('mcp_', 'mcp__', 'x.', ''),
        fc.boolean(),
        (serverName, tool, prefix, upper) => {
          const bare = identifyTool(tool);
          expect(bare.server).not.toBe('unknown');
          expect(identifyTool(`${prefix}${serverName}_${tool}`)).toEqual(bare);
          expect(identifyTool(upper ? tool.toUpperCase() : tool.toLowerCase())).toEqual(bare);
        },
      ),
      { numRuns: 300 },
    );
  });

  test('a name is unknown exactly when no tool name ends it at a boundary', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-zA-Z0-9_-]{0,30}$/), (name) => {
        const lower = name.toLowerCase();
        const known = ALL_NAMES.some((tool) => {
          const t = tool.toLowerCase();
          return (
            lower === t ||
            (lower.endsWith(t) && !/[a-z0-9]/.test(lower.charAt(lower.length - t.length - 1)))
          );
        });
        expect(identifyTool(name).server === 'unknown').toBe(!known);
      }),
      { numRuns: 300 },
    );
  });

  test('worked examples', () => {
    expect(identifyTool('mcp_power-reinvent-compass-compass_reserve_with_guardrails')).toEqual({
      server: 'compass',
      tool: 'reserve_with_guardrails',
    });
    expect(identifyTool('mcp_awsevents_ReserveSessions')).toEqual({
      server: 'awsevents',
      tool: 'ReserveSessions',
    });
    expect(identifyTool('myreserve_with_guardrails')).toEqual({ server: 'unknown' });
    expect(identifyTool('')).toEqual({ server: 'unknown' });
    expect(identifyTool('mcp_x_remove_standby')).toEqual({
      server: 'compass',
      tool: 'remove_standby',
    });
  });

  test('the tool groups have the documented sizes and sync_passes is a write tool', () => {
    expect(AWSEVENTS_WRITE_TOOLS).toHaveLength(7);
    expect(SCHEDULE_WRITE_TOOLS).toHaveLength(5);
    expect(COMPASS_WRITE_TOOLS).toHaveLength(9);
    expect(COMPASS_WRITE_TOOLS).toContain('sync_passes');
  });
});

describe('exit policy and input parsing', () => {
  test('only a block exits 2', () => {
    expect(exitCodeFor('block')).toBe(2);
    for (const kind of ['warn', 'allow', 'note', 'reminder', 'silent'] as const) {
      expect(exitCodeFor(kind)).toBe(0);
    }
  });

  test('parseHookInput keeps the two fields and refuses anything unusable', () => {
    const parsed = parseHookInput('{"tool_name":"x","tool_input":{"a":1},"extra":true}');
    expect(parsed?.tool_name).toBe('x');
    expect(parsed?.tool_input).toEqual({ a: 1 });
    for (const raw of ['', 'not json', '[]', '{}', '{"tool_name":5}', 'null']) {
      expect(parseHookInput(raw)).toBeUndefined();
    }
  });
});

async function* chunks(...parts: Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const part of parts) {
    yield part;
  }
  await Promise.resolve();
}

describe('readStdin', () => {
  test('reads text up to the limit and decodes bad UTF-8 with replacement characters', async () => {
    const enc = new TextEncoder();
    expect(await readStdin(chunks(enc.encode('{"a":'), enc.encode('1}')))).toBe('{"a":1}');
    expect(await readStdin(chunks(new Uint8Array([0xff, 0xfe])))).toBe('��');
    expect(await readStdin(chunks())).toBe('');
  });

  test('returns undefined when the input is too large or too slow', async () => {
    expect(
      await readStdin(chunks(new Uint8Array(11)), { maxBytes: 10, timeoutMs: 1000 }),
    ).toBeUndefined();
    async function* never(): AsyncGenerator<Uint8Array> {
      await new Promise(() => undefined);
      yield new Uint8Array(0);
    }
    expect(await readStdin(never(), { maxBytes: 10, timeoutMs: 20 })).toBeUndefined();
  });
});

interface Arrangement {
  /** Snapshot age in minutes; undefined means no snapshot. */
  ageMinutes?: number;
  catalog?: boolean;
  verdict?: Verdict;
}

function arrange(options: Arrangement = {}) {
  const fake = createFakeRuntime({ catalog: syntheticCatalogView() });
  if (options.ageMinutes !== undefined) {
    fake.snapshot.current = {
      version: 1,
      mode: 'simulated',
      fetchedAt: new Date(fake.clock.now().getTime() - options.ageMinutes * 60000).toISOString(),
      eventWindow: fake.events.window,
      schedule: { reserved: [], favorites: [], personalTime: [] },
    } as never;
  }
  const verdict = options.verdict;
  if (verdict !== undefined) {
    fake.rules.verdictFor = () => verdict;
  }
  const deps: HookDeps = {
    rules: fake.rules,
    snapshot: fake.snapshot,
    clock: fake.clock,
    catalog: () =>
      options.catalog === false ? Promise.reject(new Error('no catalog')) : fake.events.catalog(),
  };
  return { fake, deps };
}

const raw = (toolName: string, toolInput?: unknown): string =>
  JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    ...(toolInput === undefined ? {} : { tool_input: toolInput }),
  });

const reserve = (ids: unknown): string => raw('reserve_with_guardrails', { sessionIds: ids });

describe('pre-write guardrail examples', () => {
  test('blocks every awsevents write tool with the reason on stderr only', async () => {
    const { deps } = arrange();
    for (const tool of AWSEVENTS_WRITE_TOOLS) {
      const decision = await preWriteGuardrail(raw(`mcp_awsevents_${tool}`), deps);
      expect(decision).toEqual({ exitCode: 2, stderr: AWSEVENTS_BLOCK_REASON });
    }
  });

  test('a block exits 2 with reasons on stderr, a warn prints on stdout, an allow is silent', async () => {
    const block = arrange({
      ageMinutes: 1,
      verdict: { decision: 'block', reasons: ['It clashes.'] },
    });
    const blocked = await preWriteGuardrail(reserve([TRIPLE.a]), block.deps);
    expect(blocked.exitCode).toBe(2);
    expect(blocked.stderr).toContain('It clashes.');
    expect(blocked.stdout).toBeUndefined();

    const warn = arrange({ ageMinutes: 1, verdict: { decision: 'warn', reasons: ['Tight.'] } });
    const warned = await preWriteGuardrail(reserve([TRIPLE.a]), warn.deps);
    expect(warned.exitCode).toBe(0);
    expect(warned.stdout).toContain('Tight.');
    expect(warned.stderr).toBeUndefined();

    const allow = arrange({ ageMinutes: 1, verdict: { decision: 'allow', reasons: [] } });
    expect(await preWriteGuardrail(reserve([TRIPLE.a]), allow.deps)).toEqual({ exitCode: 0 });
  });

  test('fails open with the note when it cannot judge', async () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `s${i}`);
    const cases: [string, string, Arrangement][] = [
      ['malformed input', 'not json', { ageMinutes: 1 }],
      ['unknown tool', raw('some_other_tool'), { ageMinutes: 1 }],
      ['no snapshot', reserve([TRIPLE.a]), {}],
      ['stale snapshot', reserve([TRIPLE.a]), { ageMinutes: 16 }],
      ['no catalog', reserve([TRIPLE.a]), { ageMinutes: 1, catalog: false }],
      ['unknown session', reserve(['ghost']), { ageMinutes: 1 }],
      ['bad ids', reserve(['a/b']), { ageMinutes: 1 }],
      ['no ids', raw('reserve_with_guardrails', {}), { ageMinutes: 1 }],
      ['non-object input', raw('reserve_with_guardrails', 'text'), { ageMinutes: 1 }],
      ['null input', raw('reserve_with_guardrails', null), { ageMinutes: 1 }],
      ['too many ids', reserve(eleven), { ageMinutes: 1 }],
      ['non-string ids', reserve([1]), { ageMinutes: 1 }],
    ];
    for (const [label, input, options] of cases) {
      const { deps } = arrange(options);
      const decision = await preWriteGuardrail(input, deps);
      expect([label, decision]).toEqual([label, { exitCode: 0, stdout: COULD_NOT_CHECK_NOTE }]);
    }
  });

  test('a snapshot exactly at the age limit is still trusted', async () => {
    const { deps } = arrange({
      ageMinutes: SNAPSHOT_MAX_AGE_MS / 60000,
      verdict: { decision: 'allow', reasons: [] },
    });
    expect(await preWriteGuardrail(reserve([TRIPLE.a]), deps)).toEqual({ exitCode: 0 });
  });

  test('every other Compass tool is silent', async () => {
    const { deps } = arrange({ ageMinutes: 1 });
    for (const tool of COMPASS_TOOLS.filter((t) => t !== 'reserve_with_guardrails')) {
      expect(await preWriteGuardrail(raw(tool), deps)).toEqual({ exitCode: 0 });
    }
  });

  test('it makes no write and no network request', async () => {
    const { fake, deps } = arrange({ ageMinutes: 1 });
    await preWriteGuardrail(reserve([TRIPLE.a]), deps);
    expect(fake.events.writeCalls).toEqual([]);
    expect(fake.passes.writeCalls).toEqual([]);
  });
});

// Feature: compass-power, Property 39: The hook decision table is exact
describe('Property 39: the hook decision table is exact', () => {
  test('exit 2 exactly for an awsevents write or a fresh, valid reserve block', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<string>(...ALL_NAMES, 'unrelated_tool'),
        fc.constantFrom('', 'mcp_awsevents_', 'mcp_power-x-compass_'),
        fc.constantFrom<Verdict['decision']>('allow', 'warn', 'block'),
        fc.option(fc.integer({ min: 0, max: 40 }), { nil: undefined }),
        fc.boolean(),
        async (tool, prefix, decision, age, validIds) => {
          const verdict: Verdict =
            decision === 'allow' ? { decision, reasons: [] } : { decision, reasons: ['why'] };
          const { deps } = arrange({
            verdict,
            ...(age === undefined ? {} : { ageMinutes: age }),
          });
          const result = await preWriteGuardrail(
            reserve(validIds ? [TRIPLE.a] : ['x/y']).replace(
              'reserve_with_guardrails',
              `${prefix}${tool}`,
            ),
            deps,
          );
          const identity = identifyTool(`${prefix}${tool}`);
          const fresh = age !== undefined && age * 60000 <= SNAPSHOT_MAX_AGE_MS;
          const expectBlock =
            identity.server === 'awsevents' ||
            (identity.server === 'compass' &&
              identity.tool === 'reserve_with_guardrails' &&
              fresh &&
              validIds &&
              decision === 'block');
          expect(result.exitCode).toBe(expectBlock ? 2 : 0);
          if (result.stderr !== undefined) {
            expect(result.exitCode).toBe(2);
          }
          if (result.exitCode === 2) {
            expect(result.stdout).toBeUndefined();
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

// Feature: compass-power, Property 41: The sync reminder follows schedule writes only
describe('Property 41: the sync reminder follows schedule writes only', () => {
  test('the reminder is printed exactly for schedule and awsevents writes, and the exit is 0', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<string>(...ALL_NAMES, 'unrelated_tool'),
        fc.constantFrom('', 'mcp_awsevents_', 'mcp_power-x-compass_'),
        (tool, prefix) => {
          const result = postWriteSync(raw(`${prefix}${tool}`));
          const identity = identifyTool(`${prefix}${tool}`);
          const expectReminder =
            identity.server === 'awsevents' ||
            (identity.server === 'compass' &&
              (SCHEDULE_WRITE_TOOLS as readonly string[]).includes(identity.tool));
          expect(result.exitCode).toBe(0);
          expect(result.stdout).toBe(expectReminder ? SYNC_REMINDER : undefined);
          expect(result.stderr).toBeUndefined();
        },
      ),
      { numRuns: 200 },
    );
    expect(postWriteSync('garbage')).toEqual({ exitCode: 0 });
  });
});

// Feature: compass-power, Property 40: The hook fails open on any input
describe('Property 40: the hook fails open on any input', () => {
  test('any bytes on stdin resolve without throwing and exit 0', async () => {
    const enc = new TextEncoder();
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...HOOK_NAMES),
        fc.oneof(
          fc.uint8Array({ maxLength: 200 }),
          fc.string({ maxLength: 120 }).map((s) => enc.encode(s)),
          fc.json().map((s) => enc.encode(s)),
          fc
            .constantFrom('{"tool_name":5}', '{"tool_name":"x","tool_input":7}', '[1,2]')
            .map((s) => enc.encode(s)),
        ),
        async (name, bytes) => {
          const { deps } = arrange({ ageMinutes: 1 });
          const decision = await runHook(name, chunks(bytes), deps);
          expect(decision.exitCode).toBe(0);
        },
      ),
      { numRuns: 300 },
    );
  });

  test('a valid block input blocks, an oversized input and a stream error fail open', async () => {
    const { deps } = arrange({ ageMinutes: 1 });
    const enc = new TextEncoder();
    const blocked = await runHook(
      'pre-write-guardrail',
      chunks(enc.encode(raw('mcp_awsevents_ReserveSessions'))),
      deps,
    );
    expect(blocked.exitCode).toBe(2);
    const big = await runHook('pre-write-guardrail', chunks(new Uint8Array(20)), deps, {
      maxBytes: 10,
      timeoutMs: 1000,
    });
    expect(big).toEqual({ exitCode: 0, stdout: COULD_NOT_CHECK_NOTE });
    async function* broken(): AsyncGenerator<Uint8Array> {
      await Promise.resolve();
      throw new Error('stream failed');
    }
    expect(await runHook('pre-write-guardrail', broken(), deps)).toEqual({
      exitCode: 0,
      stdout: COULD_NOT_CHECK_NOTE,
    });
    expect(await runHook('post-write-sync', broken(), deps)).toEqual({ exitCode: 0 });
  });

  test('only the two documented names are hook names', () => {
    expect(isHookName('pre-write-guardrail')).toBe(true);
    expect(isHookName('post-write-sync')).toBe(true);
    expect(isHookName('rm -rf')).toBe(false);
  });
});
