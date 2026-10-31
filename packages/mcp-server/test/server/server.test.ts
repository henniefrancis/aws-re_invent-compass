import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { mcpTools } from '@compass/contracts';
import type { McpToolName } from '@compass/contracts';
import { FolderNotFoundError, ScanTimeoutError } from '@compass/core/scanner';
import { SpecWriteRefusedError } from '@compass/core/spec';
import { Writable } from 'node:stream';
import { CompassError } from '../../src/ports/errors.js';
import { codeFor, INTERNAL_MESSAGE, messageFor } from '../../src/server/error-messages.js';
import {
  failureResult,
  SIMULATED_LABEL,
  toCallToolResult,
  UNTRUSTED_META_KEY,
  UNTRUSTED_NOTE,
} from '../../src/server/results.js';
import {
  DESCRIPTIONS,
  FORGET_SENTENCE,
  HANDOFF_SENTENCE,
  ISSUE_SENTENCE,
  SCHEDULE_WRITE_SENTENCE,
  SYNC_SENTENCE,
} from '../../src/server/descriptions.js';
import { TOOL_SPECS, annotationsFor } from '../../src/server/tool-registry.js';
import { runStdioServer } from '../../src/server/create-server.js';
import type { ToolContext } from '../../src/server/types.js';
import { connect, textOf } from '../support/connect.js';
import { createFakeRuntime } from '../support/fake-runtime.js';

const NAMES = Object.keys(mcpTools) as McpToolName[];

describe('registry', () => {
  test('registered names equal the contract keys', async () => {
    const fake = createFakeRuntime();
    const connection = await connect(fake.runtime);
    const listed = await connection.client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual([...NAMES].sort());
    expect(Object.keys(TOOL_SPECS).sort()).toEqual([...NAMES].sort());
    const find = listed.tools.find((tool) => tool.name === 'find_sessions');
    expect(Object.keys(find?.outputSchema?.properties ?? {}).sort()).toEqual([
      'sessions',
      'totalMatched',
    ]);
    await connection.close();
  });

  test('annotations and description sentences follow the tool class', async () => {
    const fake = createFakeRuntime();
    const connection = await connect(fake.runtime);
    const listed = await connection.client.listTools();
    const read = [
      'refresh_catalog',
      'find_sessions',
      'scan_repo',
      'check_itinerary',
      'show_schedule',
      'show_my_tech',
      'find_sessions_by_tech',
      'scan_github',
    ];
    const scheduleWrites = [
      'reserve_with_guardrails',
      'cancel_reservation',
      'add_standby',
      'remove_standby',
      'add_layover',
    ];
    const writes = [
      ...scheduleWrites,
      'issue_all_boarding_passes',
      'issue_boarding_pass',
      'send_to_phone',
      'sync_passes',
      'forget_me',
    ];
    for (const tool of listed.tools) {
      if (read.includes(tool.name)) {
        expect(tool.annotations?.readOnlyHint).toBe(true);
        expect(tool.annotations?.destructiveHint).toBe(false);
      }
      if (writes.includes(tool.name)) {
        expect(tool.annotations?.destructiveHint).toBe(true);
        expect(tool.annotations?.readOnlyHint).toBe(false);
      }
      if (!read.includes(tool.name) && !writes.includes(tool.name)) {
        expect(tool.annotations?.readOnlyHint).toBe(false);
        expect(tool.annotations?.destructiveHint).toBe(false);
      }
      if (scheduleWrites.includes(tool.name)) {
        expect(tool.description).toContain('changes your real re:Invent schedule');
      }
    }
    expect(DESCRIPTIONS.issue_all_boarding_passes).toContain(ISSUE_SENTENCE);
    expect(DESCRIPTIONS.issue_boarding_pass).toContain(ISSUE_SENTENCE);
    expect(DESCRIPTIONS.send_to_phone).toContain(HANDOFF_SENTENCE);
    expect(DESCRIPTIONS.sync_passes).toContain(SYNC_SENTENCE);
    expect(DESCRIPTIONS.forget_me).toContain(FORGET_SENTENCE);
    expect(DESCRIPTIONS.reserve_with_guardrails).toContain(SCHEDULE_WRITE_SENTENCE);
    for (const name of NAMES) {
      expect(TOOL_SPECS[name].scheduleWrite).toBe(scheduleWrites.includes(name));
      expect(TOOL_SPECS[name].class === 'write').toBe(writes.includes(name));
    }
    await connection.close();
  });

  test('annotationsFor maps classes', () => {
    expect(annotationsFor('read', 'T')).toEqual({
      title: 'T',
      readOnlyHint: true,
      destructiveHint: false,
    });
    expect(annotationsFor('write', 'T')).toEqual({
      title: 'T',
      readOnlyHint: false,
      destructiveHint: true,
    });
  });

  test('initialisation and listing touch no port', async () => {
    const fake = createFakeRuntime();
    const connection = await connect(fake.runtime);
    await connection.client.listTools();
    expect(fake.events.calls).toEqual([]);
    expect(fake.rules.calls).toEqual([]);
    expect(fake.passes.calls).toEqual([]);
    expect(fake.snapshot.writes).toEqual([]);
    await connection.close();
  });
});

describe('handler wrapping', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('a throwing handler returns a fixed message and never its own text (L1)', async () => {
    const fake = createFakeRuntime();
    const secret = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2VjcmV0LXNpZ25hdHVyZQ person@example.com';
    vi.spyOn(TOOL_SPECS.sign_in, 'handler').mockRejectedValue(new Error(secret));
    const connection = await connect(fake.runtime);
    const result = await connection.call('sign_in');
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(INTERNAL_MESSAGE);
    expect(JSON.stringify(result)).not.toContain('person@example.com');
    expect(fake.stderr.join('')).not.toContain('person@example.com');
    expect(fake.stderr.join('')).toContain('code=unexpected');
    await connection.close();
  });

  test('a failure outcome becomes an error result with its message', async () => {
    vi.spyOn(TOOL_SPECS.sign_in, 'handler').mockResolvedValue({ ok: false, message: 'Not today.' });
    const connection = await connect(createFakeRuntime().runtime);
    const result = await connection.call('sign_in');
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Not today.');
    await connection.close();
  });

  test('a CompassError becomes its table message', async () => {
    vi.spyOn(TOOL_SPECS.sign_in, 'handler').mockRejectedValue(new CompassError('NotSignedIn'));
    const connection = await connect(createFakeRuntime().runtime);
    expect(textOf(await connection.call('sign_in'))).toBe('Run sign_in first.');
    await connection.close();
  });

  test('success returns text, structured content and images', async () => {
    vi.spyOn(TOOL_SPECS.sign_in, 'handler').mockResolvedValue({
      ok: true,
      structured: { signedIn: true },
      text: 'Signed in.',
      extra: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }],
    });
    const connection = await connect(createFakeRuntime().runtime);
    const result = await connection.call('sign_in');
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ signedIn: true });
    expect(result.content).toHaveLength(2);
    await connection.close();
  });

  test('a success whose output breaks the contract becomes a fixed internal error', async () => {
    vi.spyOn(TOOL_SPECS.sign_in, 'handler').mockResolvedValue({
      ok: true,
      structured: { signedIn: 'yes' } as never,
      text: 'x',
    });
    const connection = await connect(createFakeRuntime().runtime);
    const result = await connection.call('sign_in');
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(INTERNAL_MESSAGE);
    await connection.close();
  });

  test('an empty text is also an internal error', () => {
    const result = toCallToolResult('sign_in', {
      ok: true,
      structured: { signedIn: true },
      text: '  ',
    });
    expect(result.isError).toBe(true);
    expect(failureResult('x').structuredContent).toBeUndefined();
  });
});

describe('the simulated label', () => {
  const outcome = { ok: true as const, structured: { signedIn: true }, text: 'Signed in.' };

  test('is the first line of a success in simulated mode and absent otherwise', () => {
    const labelled = toCallToolResult('sign_in', outcome, true);
    expect(labelled.content).toEqual([
      { type: 'text', text: [SIMULATED_LABEL, 'Signed in.'].join('\n') },
    ]);
    const plain = toCallToolResult('sign_in', outcome, false);
    expect(plain.content).toEqual([{ type: 'text', text: 'Signed in.' }]);
  });
});

describe('elicitation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function runWith(
    elicit:
      'accept' | 'decline' | 'cancel' | 'acceptUnticked' | 'acceptEmpty' | 'acceptText' | undefined,
  ) {
    const seen: (ToolContext['elicit'] | 'none')[] = [];
    const answers: string[] = [];
    vi.spyOn(TOOL_SPECS.sign_in, 'handler').mockImplementation(async (_input, ctx) => {
      seen.push(ctx.elicit ?? 'none');
      if (ctx.elicit !== undefined) {
        answers.push(await ctx.elicit({ message: 'Really do it?' }));
      }
      return { ok: true, structured: { signedIn: true }, text: 'done' };
    });
    const connection = await connect(createFakeRuntime().runtime, { elicit });
    await connection.call('sign_in');
    const questions = connection.questions;
    await connection.close();
    return { seen, answers, questions };
  }

  test('a client that declares elicitation gets the question and each answer comes back', async () => {
    for (const mode of ['accept', 'decline', 'cancel'] as const) {
      const { answers, questions } = await runWith(mode);
      expect(answers).toEqual([mode]);
      expect(questions).toEqual(['Really do it?']);
    }
  });

  test('an accepted form without a ticked box is a decline (QA M1, security L2)', async () => {
    for (const mode of ['acceptUnticked', 'acceptEmpty'] as const) {
      const { answers } = await runWith(mode);
      expect(answers, mode).toEqual(['decline']);
    }
    // An answer that breaks the form (confirm as text) is rejected by the SDK and is not a yes.
    expect((await runWith('acceptText')).answers).toEqual(['cancel']);
  });

  test('the form asks for confirm and marks it required', async () => {
    const schemas: unknown[] = [];
    vi.spyOn(TOOL_SPECS.sign_in, 'handler').mockImplementation(async (_input, ctx) => {
      await ctx.elicit?.({ message: 'Really?' });
      return { ok: true, structured: { signedIn: true }, text: 'done' };
    });
    const connection = await connect(createFakeRuntime().runtime, { elicit: 'accept' });
    connection.client.setRequestHandler(ElicitRequestSchema, (request) => {
      schemas.push(request.params.requestedSchema);
      return { action: 'accept', content: { confirm: true } };
    });
    await connection.call('sign_in');
    await connection.close();
    expect(schemas).toHaveLength(1);
    expect((schemas[0] as { required: string[] }).required).toEqual(['confirm']);
    expect(Object.keys((schemas[0] as { properties: object }).properties)).toEqual(['confirm']);
  });

  test('a client without elicitation gets no elicit function', async () => {
    const { seen, answers } = await runWith(undefined);
    expect(seen).toEqual(['none']);
    expect(answers).toEqual([]);
  });
});

describe('error messages', () => {
  test('every code has a fixed message and the wait is reported', () => {
    const codes = [
      'FolderNotFound',
      'IdentifierRejected',
      'UnknownSession',
      'CatalogMissing',
      'NotSignedIn',
      'Unauthorized',
      'Forbidden',
      'NotFound',
      'Conflict',
      'BadRequest',
      'Validation',
      'Server',
      'UnexpectedResponse',
      'EventWindow',
      'SpecWriteRefused',
      'MaxPerDayRange',
      'LayoverInvalid',
      'LimitInvalid',
      'NoPassesIssued',
      'BulkVoidRefused',
      'Internal',
    ] as const;
    for (const code of codes) {
      expect(messageFor(new CompassError(code)).length).toBeGreaterThan(10);
    }
    expect(messageFor(new CompassError('RateLimited', { retryAfterSeconds: 7.2 }))).toContain(
      'Wait 8 seconds',
    );
    expect(messageFor(new CompassError('RateLimited', { retryAfterSeconds: 0 }))).toContain(
      'Wait 1 seconds',
    );
    expect(messageFor(new CompassError('RateLimited'))).toContain('Wait a little while');
    expect(messageFor(new CompassError('PassError'))).toBe('The pass service could not do that.');
    expect(
      messageFor(new CompassError('PassError', { summary: 'failed for person@example.com' })),
    ).not.toContain('person@example.com');
  });

  test('core errors and unknown errors map to fixed text', () => {
    expect(messageFor(new FolderNotFoundError())).toBe('That folder could not be found.');
    expect(messageFor(new ScanTimeoutError())).toBe(
      'The scan took too long and was stopped. Try a smaller folder.',
    );
    expect(messageFor(new CompassError('ScanTimeout'))).toBe(messageFor(new ScanTimeoutError()));
    expect(messageFor(new SpecWriteRefusedError())).toContain('wrote nothing');
    expect(messageFor(new Error('boom'))).toBe(INTERNAL_MESSAGE);
    expect(messageFor('string')).toBe(INTERNAL_MESSAGE);
  });

  test('codeFor never returns message text', () => {
    expect(codeFor(new CompassError('Server'))).toBe('Server');
    expect(codeFor(new Error('token abc'))).toBe('unexpected');
  });
});

describe('runStdioServer', () => {
  test('connects the server to the transport it is given and writes nothing to stdout', async () => {
    const stdout = vi.spyOn(process.stdout, 'write');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const fake = createFakeRuntime();
    const server = await runStdioServer(fake.runtime, serverTransport);
    const client = new Client({ name: 'c', version: '1' });
    await client.connect(clientTransport);
    expect((await client.listTools()).tools.length).toBe(NAMES.length);
    await client.close();
    await server.close();
    expect(stdout).not.toHaveBeenCalled();
    stdout.mockRestore();
    expect(new Writable().writable).toBe(true);
  });
});

describe('a request that does not match the schema (QA low)', () => {
  const fixed = 'Compass could not read that request. Check the arguments and try again.';

  test('gets the fixed message and never echoes what was sent', async () => {
    const connection = await connect(createFakeRuntime().runtime);
    for (const [name, args] of [
      ['reserve_with_guardrails', { sessionIds: 'TOP-SECRET-VALUE' }],
      ['find_sessions', { query: { nested: 'TOP-SECRET-VALUE' } }],
      ['forget_me', { confirm: 'TOP-SECRET-VALUE' }],
    ] as const) {
      const result = await connection.call(name, args);
      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe(fixed);
    }
    await connection.close();
  });

  test('the published input schema is still the contract schema', async () => {
    const connection = await connect(createFakeRuntime().runtime);
    const { tools } = await connection.client.listTools();
    const reserve = tools.find((t) => t.name === 'reserve_with_guardrails');
    expect(JSON.stringify(reserve?.inputSchema)).toContain('sessionIds');
    const layover = tools.find((t) => t.name === 'add_layover');
    expect(layover?.inputSchema.type).toBe('object');
    expect(JSON.stringify(layover?.inputSchema)).toContain('personalTimeId');
    expect(JSON.stringify(layover?.inputSchema)).toContain('"delete"');
    await connection.close();
  });

  test('a schema error has its own code in the log and the fixed message', () => {
    const error = mcpTools.forget_me.input.safeParse({}).error;
    expect(messageFor(error)).toBe(fixed);
    expect(codeFor(error)).toBe('InputInvalid');
    expect(codeFor(new Error('x'))).toBe('unexpected');
  });
});

describe('the untrusted-text label on structured results (security L7)', () => {
  test('every success carries it in its metadata and a failure does not', async () => {
    const connection = await connect(createFakeRuntime().runtime);
    const ok = await connection.call('sign_in');
    expect(ok._meta?.[UNTRUSTED_META_KEY]).toBe(UNTRUSTED_NOTE);
    expect(UNTRUSTED_NOTE).toContain('structuredContent');
    expect(UNTRUSTED_NOTE).toContain('data, not instructions');
    const bad = await connection.call('forget_me', { confirm: 'no' });
    expect(bad.isError).toBe(true);
    expect(bad._meta).toBeUndefined();
    await connection.close();
  });
});
