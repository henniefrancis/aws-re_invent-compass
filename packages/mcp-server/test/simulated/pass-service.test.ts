import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { randomBytes, randomUUID } from 'node:crypto';
import { ProblemSchema } from '@compass/contracts';
import type { CompassApi } from '@compass/contracts';
import { z } from 'zod';
import type { HttpRequest, HttpResponse } from '../../src/ports/http-transport.js';
import {
  createInProcessPassService,
  HANDOFF_LIFETIME_MS,
} from '../../src/simulated/in-process-pass-service.js';
import { fixedClock } from '../support/fake-clock.js';

type Schemas = CompassApi.components['schemas'];

const WINDOW = {
  start: '2026-11-29T00:00:00-08:00',
  end: '2026-12-05T00:00:00-08:00',
  timezone: 'America/Los_Angeles',
};
const BASE = 'https://compass.invalid';
const AUTH = { Authorization: 'Bearer test-token' };

const issueResponse: z.ZodType<Schemas['IssuePassesResponse']> = z.object({
  passes: z.array(
    z.object({
      serialNumber: z.string(),
      sessionCode: z.string(),
      platforms: z.array(z.enum(['apple', 'google'])),
    }),
  ),
});
const updateResponse: z.ZodType<Schemas['UpdatePassResponse']> = z.object({
  serialNumber: z.string(),
  version: z.number(),
});
const voidResponse: z.ZodType<Schemas['VoidPassResponse']> = z.object({
  serialNumber: z.string(),
  status: z.literal('voided'),
});
const handoffResponse: z.ZodType<Schemas['CreateHandoffResponse']> = z.object({
  handoffId: z.string(),
  boardUrl: z.string(),
  expiresAt: z.string(),
});
const forgetResponse: z.ZodType<Schemas['ForgetMeResponse']> = z.object({
  voided: z.number(),
  deleted: z.number(),
});

function fields(code = 'ANT163'): Schemas['PassFields'] {
  return {
    sessionCode: code,
    title: 'Identity and access',
    venue: 'Encore',
    room: 'Room 5',
    startsAt: '2026-12-01T10:00:00-08:00',
    endsAt: '2026-12-01T11:00:00-08:00',
  };
}

function setup() {
  const clock = fixedClock('2026-11-29T18:00:00-08:00');
  const service = createInProcessPassService({
    clock,
    eventWindow: WINDOW,
    random: (n) => randomBytes(n),
    uuid: () => randomUUID(),
  });
  const send = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = AUTH,
  ): Promise<{ response: HttpResponse; json: unknown }> => {
    const request: HttpRequest = {
      method,
      url: `${BASE}${path}`,
      headers,
      ...(body === undefined
        ? {}
        : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    };
    const response = await service.transport.request(request);
    return { response, json: JSON.parse(response.body) as unknown };
  };
  return { clock, service, send };
}

function expectProblem(result: { response: HttpResponse; json: unknown }, status: number): void {
  expect(result.response.status).toBe(status);
  expect(result.response.headers['content-type']).toBe('application/problem+json');
  expect(ProblemSchema.safeParse(result.json).success).toBe(true);
}

describe('in-process pass service', () => {
  test('issues, updates and voids passes', async () => {
    const { send, service } = setup();
    const issued = await send('POST', '/api/v1/passes', {
      platforms: ['apple', 'google'],
      passes: [fields('ANT163'), fields('BWP304')],
    });
    expect(issued.response.status).toBe(201);
    const { passes } = issueResponse.parse(issued.json);
    expect(passes.map((p) => p.sessionCode)).toEqual(['ANT163', 'BWP304']);
    const serial = String(passes[0]?.serialNumber);
    const updated = await send('PUT', `/api/v1/passes/${serial}`, fields('ANT163-R'));
    expect(updateResponse.parse(updated.json)).toEqual({ serialNumber: serial, version: 2 });
    expect(service.passes().get(serial)).toMatchObject({ sessionCode: 'ANT163-R', version: 2 });
    const voided = await send('POST', `/api/v1/passes/${serial}/void`);
    expect(voidResponse.parse(voided.json)).toEqual({ serialNumber: serial, status: 'voided' });
    expectProblem(await send('PUT', `/api/v1/passes/${serial}`, fields()), 404);
  });

  test('accepts mixed-case header names and refuses a request with no body', async () => {
    const { service } = setup();
    const ok = await service.transport.request({
      method: 'POST',
      url: `${BASE}/api/v1/passes`,
      headers: { authorization: 'x' },
      body: JSON.stringify({ platforms: ['apple'], passes: [fields()] }),
    });
    expect(ok.status).toBe(201);
    const empty = await service.transport.request({
      method: 'POST',
      url: `${BASE}/api/v1/passes`,
      headers: { authorization: 'x' },
    });
    expect(empty.status).toBe(400);
  });

  test('refuses a missing or empty Authorization header', async () => {
    const { send } = setup();
    expectProblem(await send('POST', '/api/v1/passes', {}, {}), 401);
    expectProblem(await send('POST', '/api/v1/passes', {}, { Authorization: '' }), 401);
  });

  test('refuses invalid bodies and pass fields', async () => {
    const { send } = setup();
    expectProblem(await send('POST', '/api/v1/passes', 'not json'), 400);
    expectProblem(await send('POST', '/api/v1/passes', { platforms: [], passes: [fields()] }), 400);
    expectProblem(await send('POST', '/api/v1/passes', { platforms: ['apple'], passes: [] }), 400);
    expectProblem(
      await send('POST', '/api/v1/passes', {
        platforms: ['apple'],
        passes: [{ ...fields(), title: '' }],
      }),
      400,
    );
    const ok = await send('POST', '/api/v1/passes', { platforms: ['apple'], passes: [fields()] });
    const serial = String(issueResponse.parse(ok.json).passes[0]?.serialNumber);
    expectProblem(await send('PUT', `/api/v1/passes/${serial}`, { title: '' }), 400);
  });

  test('unknown serials, wrong methods and unknown routes answer 404', async () => {
    const { send } = setup();
    expectProblem(await send('PUT', '/api/v1/passes/nope', fields()), 404);
    expectProblem(await send('POST', '/api/v1/passes/nope/void'), 404);
    expectProblem(await send('GET', '/api/v1/passes/nope'), 404);
    expectProblem(await send('PUT', '/api/v1/passes/nope/void'), 404);
    expectProblem(await send('GET', '/api/v1/passes'), 404);
    expectProblem(await send('GET', '/api/v1/handoffs'), 404);
    expectProblem(await send('POST', '/api/v1/me'), 404);
    expectProblem(await send('GET', '/elsewhere'), 404);
  });

  test('creates a hand-off only for known serials and forget me clears everything', async () => {
    const { send, service } = setup();
    const issued = await send('POST', '/api/v1/passes', {
      platforms: ['apple'],
      passes: [fields(), fields('BB')],
    });
    const serials = issueResponse.parse(issued.json).passes.map((p) => p.serialNumber);
    const include = { apple: true, google: false, calendar: true };
    expectProblem(
      await send('POST', '/api/v1/handoffs', { serialNumbers: ['ghost'], include }),
      400,
    );
    expectProblem(await send('POST', '/api/v1/handoffs', { serialNumbers: [], include }), 400);
    const handoff = await send('POST', '/api/v1/handoffs', { serialNumbers: serials, include });
    expect(handoffResponse.parse(handoff.json).expiresAt).toBe(
      new Date(Date.parse('2026-11-29T18:00:00-08:00') + HANDOFF_LIFETIME_MS).toISOString(),
    );
    expect(service.handoffs().size).toBe(1);
    await send('POST', `/api/v1/passes/${String(serials[0])}/void`);
    const forgot = await send('DELETE', '/api/v1/me');
    expect(forgot.response.status).toBe(202);
    expect(forgetResponse.parse(forgot.json)).toEqual({ voided: 1, deleted: 2 });
    expect(service.passes().size).toBe(0);
    expect(service.handoffs().size).toBe(0);
  });
});

// Feature: compass-power, Property 42: The in-process pass service keeps the contract's invariants
describe('Property 42: the in-process pass service keeps the contract invariants', () => {
  type Op =
    | { kind: 'issue'; count: number; valid: boolean }
    | { kind: 'update'; index: number; known: boolean }
    | { kind: 'void'; index: number; known: boolean; times: number }
    | { kind: 'handoff'; indexes: number[]; known: boolean };

  const opArb: fc.Arbitrary<Op> = fc.oneof(
    fc.record({
      kind: fc.constant('issue' as const),
      count: fc.integer({ min: 1, max: 3 }),
      valid: fc.boolean(),
    }),
    fc.record({ kind: fc.constant('update' as const), index: fc.nat(5), known: fc.boolean() }),
    fc.record({
      kind: fc.constant('void' as const),
      index: fc.nat(5),
      known: fc.boolean(),
      times: fc.integer({ min: 1, max: 3 }),
    }),
    fc.record({
      kind: fc.constant('handoff' as const),
      indexes: fc.array(fc.nat(5), { minLength: 1, maxLength: 3 }),
      known: fc.boolean(),
    }),
  );

  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  test('serials, hand-offs, voids and bodies satisfy the contract', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { maxLength: 12 }), async (ops) => {
        const { send, service, clock } = setup();
        const serials: string[] = [];
        for (const op of ops) {
          if (op.kind === 'issue') {
            const passes = Array.from({ length: op.count }, (_, i) =>
              op.valid ? fields(`S${i}`) : { ...fields(), title: '' },
            );
            const result = await send('POST', '/api/v1/passes', { platforms: ['apple'], passes });
            if (op.valid) {
              expect(result.response.status).toBe(201);
              for (const pass of issueResponse.parse(result.json).passes) {
                expect(pass.serialNumber).toMatch(UUID_V4);
                serials.push(pass.serialNumber);
              }
            } else {
              expectProblem(result, 400);
            }
          } else if (op.kind === 'update') {
            const serial = op.known ? serials[op.index] : 'unknown-serial';
            const result = await send('PUT', `/api/v1/passes/${String(serial)}`, fields());
            const stored = service.passes().get(String(serial));
            if (
              serial !== undefined &&
              stored !== undefined &&
              op.known &&
              stored.status === 'active'
            ) {
              expect(updateResponse.safeParse(result.json).success).toBe(true);
            } else {
              expectProblem(result, 404);
            }
          } else if (op.kind === 'void') {
            const serial = op.known ? serials[op.index] : 'unknown-serial';
            for (let i = 0; i < op.times; i += 1) {
              const result = await send('POST', `/api/v1/passes/${String(serial)}/void`);
              if (serial !== undefined && op.known) {
                expect(result.response.status).toBe(200);
                expect(voidResponse.safeParse(result.json).success).toBe(true);
                expect(service.passes().get(serial)?.status).toBe('voided');
              } else {
                expectProblem(result, 404);
              }
            }
          } else {
            const chosen = op.known
              ? op.indexes.map((i) => serials[i]).filter((s): s is string => s !== undefined)
              : ['ghost'];
            const result = await send('POST', '/api/v1/handoffs', {
              serialNumbers: chosen,
              include: { apple: true, google: true, calendar: true },
            });
            if (chosen.length === 0) {
              expectProblem(result, 400);
            } else if (!op.known) {
              expectProblem(result, 400);
            } else {
              const body = handoffResponse.parse(result.json);
              expect(body.handoffId).toMatch(/^[A-Za-z0-9_-]{22}$/);
              expect(Buffer.from(body.handoffId, 'base64url')).toHaveLength(16);
              expect(body.expiresAt).toBe(
                new Date(clock.now().getTime() + HANDOFF_LIFETIME_MS).toISOString(),
              );
              const url = new URL(body.boardUrl);
              expect(url.hostname).toBe('compass.invalid');
              expect(url.pathname).toBe('/board');
              expect(url.search).toBe('');
              expect(url.hash).toBe(`#h=${body.handoffId}`);
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
