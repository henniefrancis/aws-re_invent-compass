import { ProblemSchema } from '@compass/contracts';
import fc from 'fast-check';
import type { ZodType } from 'zod';
import { describe, expect, test, vi } from 'vitest';
import { API_ROUTE_KEYS } from '../../src/app/api-app.js';
import { PASSKIT_ROUTE_KEYS } from '../../src/app/passkit-app.js';
import {
  CreateHandoffResponseSchema,
  ForgetMeResponseSchema,
  HandoffViewSchema,
  HealthSchema,
  IssuePassesResponseSchema,
  SerialNumbersSchema,
  UpdatePassResponseSchema,
  VoidPassResponseSchema,
} from '../../src/validation/response-schemas.js';
import {
  createApiFixture,
  type ApiFixture,
  type CallOptions,
  type Reply,
} from '../helpers/api-fixture.js';
import {
  contractOperations,
  loadContractTree,
  responseContentTypes,
  type ContractOperation,
} from '../helpers/openapi-reader.js';
import { validateAgainstContract } from '../helpers/openapi-validator.js';
import { samplePassFields } from '../helpers/pass-fields.js';

// Contract tests do real work on a machine that may be busy.
vi.setConfig({ testTimeout: 120_000 });

const tree = loadContractTree();
const operations = contractOperations(tree);
const SUB = '5'.repeat(64);
const UNKNOWN_SERIAL = '99999999-9999-4999-8999-999999999999';
const UNKNOWN_HANDOFF = 'ZZZZZZZZZZZZZZZZZZZZZZ';
const PASS_TYPE = 'pass.test.compass';

const JSON_SCHEMAS: Record<string, ZodType> = {
  getHealth: HealthSchema,
  issuePasses: IssuePassesResponseSchema,
  updatePass: UpdatePassResponseSchema,
  voidPass: VoidPassResponseSchema,
  createHandoff: CreateHandoffResponseSchema,
  getHandoff: HandoffViewSchema,
  forgetMe: ForgetMeResponseSchema,
  getSerialNumbers: SerialNumbersSchema,
};

interface World {
  fixture: ApiFixture;
  serial: string;
  serial2: string;
  token: string;
  handoffId: string;
}

async function buildWorld(): Promise<World> {
  const fixture = createApiFixture();
  const serial = await fixture.issue(SUB, samplePassFields(), ['apple', 'google']);
  const serial2 = await fixture.issue(SUB, samplePassFields({ sessionCode: 'TWO202' }));
  const token = await fixture.authToken(serial);
  const created = await fixture.call({
    method: 'POST',
    resource: '/api/v1/handoffs',
    token: SUB,
    body: { serialNumbers: [serial], include: { apple: true, google: true, calendar: true } },
  });
  const handoffId = (created.json as { handoffId: string }).handoffId;
  await fixture.callPasskit({
    method: 'POST',
    resource: REG,
    path: {
      deviceLibraryIdentifier: 'library-0000000001',
      passTypeIdentifier: PASS_TYPE,
      serialNumber: serial,
    },
    headers: { authorization: `ApplePass ${token}` },
    body: { pushToken: 'aabbccdd' },
  });
  return { fixture, serial, serial2, token, handoffId };
}

const REG =
  '/api/passkit/v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}/{serialNumber}';
const LIST = '/api/passkit/v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}';
const LATEST = '/api/passkit/v1/passes/{passTypeIdentifier}/{serialNumber}';

const issueBody = (code: string) => ({
  platforms: ['apple'],
  passes: [samplePassFields({ sessionCode: code })],
});

type Scenario = (w: World) => Promise<Reply>;

function api(w: World, options: CallOptions): Promise<Reply> {
  return w.fixture.call(options);
}

function pk(w: World, options: CallOptions): Promise<Reply> {
  return w.fixture.callPasskit(options);
}

const scenarios: Record<string, Record<number, Scenario>> = {
  getHealth: { 200: (w) => api(w, { method: 'GET', resource: '/api/v1/health' }) },
  issuePasses: {
    201: (w) =>
      api(w, { method: 'POST', resource: '/api/v1/passes', token: SUB, body: issueBody('NEW101') }),
    400: (w) =>
      api(w, {
        method: 'POST',
        resource: '/api/v1/passes',
        token: SUB,
        body: { platforms: [], passes: [] },
      }),
    401: (w) => api(w, { method: 'POST', resource: '/api/v1/passes', body: issueBody('NEW102') }),
    429: async (w) => {
      await w.fixture.deps.limiter.record('6'.repeat(64), 'passWrites', 100, w.fixture.clock.now());
      return api(w, {
        method: 'POST',
        resource: '/api/v1/passes',
        token: '6'.repeat(64),
        body: issueBody('NEW103'),
      });
    },
  },
  getApplePass: {
    200: (w) =>
      api(w, {
        method: 'GET',
        resource: '/api/v1/passes/{serialNumber}/apple',
        path: { serialNumber: w.serial },
        token: SUB,
      }),
    401: (w) =>
      api(w, {
        method: 'GET',
        resource: '/api/v1/passes/{serialNumber}/apple',
        path: { serialNumber: w.serial },
      }),
    404: (w) =>
      api(w, {
        method: 'GET',
        resource: '/api/v1/passes/{serialNumber}/apple',
        path: { serialNumber: UNKNOWN_SERIAL },
        token: SUB,
      }),
  },
  updatePass: {
    200: (w) =>
      api(w, {
        method: 'PUT',
        resource: '/api/v1/passes/{serialNumber}',
        path: { serialNumber: w.serial },
        token: SUB,
        body: samplePassFields({ room: 'Room 7' }),
      }),
    400: (w) =>
      api(w, {
        method: 'PUT',
        resource: '/api/v1/passes/{serialNumber}',
        path: { serialNumber: w.serial },
        token: SUB,
        body: { nope: true },
      }),
    401: (w) =>
      api(w, {
        method: 'PUT',
        resource: '/api/v1/passes/{serialNumber}',
        path: { serialNumber: w.serial },
        body: samplePassFields(),
      }),
    404: (w) =>
      api(w, {
        method: 'PUT',
        resource: '/api/v1/passes/{serialNumber}',
        path: { serialNumber: UNKNOWN_SERIAL },
        token: SUB,
        body: samplePassFields(),
      }),
  },
  voidPass: {
    200: (w) =>
      api(w, {
        method: 'POST',
        resource: '/api/v1/passes/{serialNumber}/void',
        path: { serialNumber: w.serial2 },
        token: SUB,
      }),
    401: (w) =>
      api(w, {
        method: 'POST',
        resource: '/api/v1/passes/{serialNumber}/void',
        path: { serialNumber: w.serial2 },
      }),
    404: (w) =>
      api(w, {
        method: 'POST',
        resource: '/api/v1/passes/{serialNumber}/void',
        path: { serialNumber: UNKNOWN_SERIAL },
        token: SUB,
      }),
  },
  createHandoff: {
    201: (w) =>
      api(w, {
        method: 'POST',
        resource: '/api/v1/handoffs',
        token: SUB,
        body: {
          serialNumbers: [w.serial],
          include: { apple: true, google: false, calendar: false },
        },
      }),
    400: (w) =>
      api(w, {
        method: 'POST',
        resource: '/api/v1/handoffs',
        token: SUB,
        body: { serialNumbers: [], include: { apple: true, google: false, calendar: false } },
      }),
    401: (w) =>
      api(w, {
        method: 'POST',
        resource: '/api/v1/handoffs',
        body: {
          serialNumbers: [w.serial],
          include: { apple: true, google: false, calendar: false },
        },
      }),
    429: async (w) => {
      const sub = '7'.repeat(64);
      const own = await w.fixture.issue(sub);
      const body = {
        serialNumbers: [own],
        include: { apple: true, google: false, calendar: false },
      };
      for (let i = 0; i < 10; i += 1) {
        await api(w, { method: 'POST', resource: '/api/v1/handoffs', token: sub, body });
      }
      return api(w, { method: 'POST', resource: '/api/v1/handoffs', token: sub, body });
    },
  },
  getHandoff: {
    200: (w) =>
      api(w, {
        method: 'GET',
        resource: '/api/v1/handoffs/{handoffId}',
        path: { handoffId: w.handoffId },
      }),
    404: (w) =>
      api(w, {
        method: 'GET',
        resource: '/api/v1/handoffs/{handoffId}',
        path: { handoffId: UNKNOWN_HANDOFF },
      }),
  },
  getHandoffAppleBundle: {
    200: (w) =>
      api(w, {
        method: 'GET',
        resource: '/api/v1/handoffs/{handoffId}/apple/{bundleIndex}',
        path: { handoffId: w.handoffId, bundleIndex: '0' },
      }),
    404: (w) =>
      api(w, {
        method: 'GET',
        resource: '/api/v1/handoffs/{handoffId}/apple/{bundleIndex}',
        path: { handoffId: w.handoffId, bundleIndex: '9' },
      }),
  },
  getHandoffApplePass: {
    200: (w) =>
      api(w, {
        method: 'GET',
        resource: '/api/v1/handoffs/{handoffId}/apple/pass/{serialNumber}',
        path: { handoffId: w.handoffId, serialNumber: w.serial },
      }),
    404: (w) =>
      api(w, {
        method: 'GET',
        resource: '/api/v1/handoffs/{handoffId}/apple/pass/{serialNumber}',
        path: { handoffId: w.handoffId, serialNumber: UNKNOWN_SERIAL },
      }),
  },
  getHandoffSessionCalendar: {
    200: (w) =>
      api(w, {
        method: 'GET',
        resource: '/api/v1/handoffs/{handoffId}/calendar/{serialNumber}',
        path: { handoffId: w.handoffId, serialNumber: `${w.serial}.ics` },
      }),
    404: (w) =>
      api(w, {
        method: 'GET',
        resource: '/api/v1/handoffs/{handoffId}/calendar/{serialNumber}',
        path: { handoffId: w.handoffId, serialNumber: `${UNKNOWN_SERIAL}.ics` },
      }),
  },
  getHandoffCalendar: {
    200: (w) =>
      api(w, {
        method: 'GET',
        resource: '/api/v1/handoffs/{handoffId}/calendar.ics',
        path: { handoffId: w.handoffId },
      }),
    404: (w) =>
      api(w, {
        method: 'GET',
        resource: '/api/v1/handoffs/{handoffId}/calendar.ics',
        path: { handoffId: UNKNOWN_HANDOFF },
      }),
  },
  forgetMe: {
    202: (w) => api(w, { method: 'DELETE', resource: '/api/v1/me', token: '8'.repeat(64) }),
    401: (w) => api(w, { method: 'DELETE', resource: '/api/v1/me' }),
  },
  registerDevice: {
    201: (w) =>
      pk(w, {
        method: 'POST',
        resource: REG,
        path: {
          deviceLibraryIdentifier: 'library-new-00000001',
          passTypeIdentifier: PASS_TYPE,
          serialNumber: w.serial,
        },
        headers: { authorization: `ApplePass ${w.token}` },
        body: { pushToken: 'aabb' },
      }),
    200: (w) =>
      pk(w, {
        method: 'POST',
        resource: REG,
        path: {
          deviceLibraryIdentifier: 'library-0000000001',
          passTypeIdentifier: PASS_TYPE,
          serialNumber: w.serial,
        },
        headers: { authorization: `ApplePass ${w.token}` },
        body: { pushToken: 'ccdd' },
      }),
    401: (w) =>
      pk(w, {
        method: 'POST',
        resource: REG,
        path: {
          deviceLibraryIdentifier: 'library-0000000001',
          passTypeIdentifier: PASS_TYPE,
          serialNumber: w.serial,
        },
        body: { pushToken: 'aabb' },
      }),
  },
  unregisterDevice: {
    200: (w) =>
      pk(w, {
        method: 'DELETE',
        resource: REG,
        path: {
          deviceLibraryIdentifier: 'library-gone-0000001',
          passTypeIdentifier: PASS_TYPE,
          serialNumber: w.serial,
        },
        headers: { authorization: `ApplePass ${w.token}` },
      }),
    401: (w) =>
      pk(w, {
        method: 'DELETE',
        resource: REG,
        path: {
          deviceLibraryIdentifier: 'library-0000000001',
          passTypeIdentifier: PASS_TYPE,
          serialNumber: w.serial,
        },
      }),
  },
  getSerialNumbers: {
    200: (w) =>
      pk(w, {
        method: 'GET',
        resource: LIST,
        path: { deviceLibraryIdentifier: 'library-0000000001', passTypeIdentifier: PASS_TYPE },
      }),
    204: (w) =>
      pk(w, {
        method: 'GET',
        resource: LIST,
        path: { deviceLibraryIdentifier: 'nobody-library-0001', passTypeIdentifier: PASS_TYPE },
      }),
  },
  getLatestPass: {
    200: (w) =>
      pk(w, {
        method: 'GET',
        resource: LATEST,
        path: { passTypeIdentifier: PASS_TYPE, serialNumber: w.serial },
        headers: { authorization: `ApplePass ${w.token}` },
      }),
    304: (w) =>
      pk(w, {
        method: 'GET',
        resource: LATEST,
        path: { passTypeIdentifier: PASS_TYPE, serialNumber: w.serial },
        headers: {
          authorization: `ApplePass ${w.token}`,
          'if-modified-since': new Date(w.fixture.clock.now() + 3_600_000).toUTCString(),
        },
      }),
    401: (w) =>
      pk(w, {
        method: 'GET',
        resource: LATEST,
        path: { passTypeIdentifier: PASS_TYPE, serialNumber: w.serial },
      }),
  },
  logMessages: {
    200: (w) => pk(w, { method: 'POST', resource: '/api/passkit/v1/log', body: { logs: ['one'] } }),
  },
};

/** Checks a reply against the contract for its operation and status. */
function expectConforms(op: ContractOperation, reply: Reply): void {
  const { result } = reply;
  const status = result.statusCode;
  const declared = responseContentTypes(tree, op.path, op.method, status);
  if (declared.length === 0) {
    expect(result.body).toBe('');
    return;
  }
  const contentType = result.headers['content-type'];
  expect(declared).toContain(contentType);
  if (contentType === 'application/problem+json' || contentType === 'application/json') {
    // Review M3: the body also has to satisfy the OpenAPI schema itself (ajv, nullable on).
    expect(
      validateAgainstContract(op.path, op.method, status, contentType, JSON.parse(result.body)),
    ).toBe('');
  }
  if (contentType === 'application/problem+json') {
    const problem = ProblemSchema.parse(JSON.parse(result.body));
    expect(Object.keys(JSON.parse(result.body) as object).sort()).toEqual([
      'code',
      'status',
      'title',
      'type',
    ]);
    expect(problem.status).toBe(status);
    expect(problem.type).toBe('about:blank');
    return;
  }
  if (contentType === 'application/json') {
    const schema = JSON_SCHEMAS[op.operationId];
    expect(schema, op.operationId).toBeDefined();
    expect(schema?.safeParse(JSON.parse(result.body)).success).toBe(true);
    return;
  }
  expect(result.isBase64Encoded).toBe(true);
}

describe('Feature: pass-service, contract conformance', () => {
  test('the two routers serve exactly the contract methods and paths', () => {
    const contractKeys = operations.map((op) => `${op.method.toUpperCase()} ${op.path}`).sort();
    expect([...API_ROUTE_KEYS, ...PASSKIT_ROUTE_KEYS].sort()).toEqual(contractKeys);
    expect(contractKeys).toHaveLength(17);
    expect(API_ROUTE_KEYS.every((key) => !key.includes('/api/passkit/'))).toBe(true);
    expect(PASSKIT_ROUTE_KEYS.every((key) => key.includes('/api/passkit/'))).toBe(true);
    expect(PASSKIT_ROUTE_KEYS).toHaveLength(5);
    expect(API_ROUTE_KEYS).toHaveLength(12);
  });

  test.each(operations.map((op) => [op.operationId, op] as const))(
    '%s answers every status the contract lists except 500',
    async (_name, op) => {
      const listed = op.statuses.filter((status) => status !== 500);
      expect(
        Object.keys(scenarios[op.operationId] ?? {})
          .map(Number)
          .sort(),
      ).toEqual([...listed].sort());
      for (const status of listed) {
        const w = await buildWorld();
        const reply = await (scenarios[op.operationId] as Record<number, Scenario>)[status]!(w);
        expect(reply.result.statusCode).toBe(status);
        expectConforms(op, reply);
      }
    },
  );

  test('the ajv check rejects a body that breaks the OpenAPI schema', () => {
    const check = (body: unknown) =>
      validateAgainstContract('/api/v1/health', 'get', 200, 'application/json', body);
    expect(check({ status: 'ok' })).not.toBe('');
    expect(check('nope')).not.toBe('');
    expect(
      validateAgainstContract('/api/v1/passes', 'post', 400, 'application/problem+json', {
        type: 'about:blank',
      }),
    ).not.toBe('');
  });

  test('an unknown route is a 404 Problem', async () => {
    const w = await buildWorld();
    const reply = await w.fixture.call({ method: 'GET', resource: '/api/v1/nothing-here' });
    expect(reply.result.statusCode).toBe(404);
    expect(ProblemSchema.parse(reply.json).code).toBe('not_found');
    const wrongMethod = await w.fixture.call({ method: 'DELETE', resource: '/api/v1/health' });
    expect(wrongMethod.result.statusCode).toBe(404);
  });

  // Feature: pass-service, Property 2: Every response conforms to the contract
  test('Property 2: every response to a generated request conforms to the contract', async () => {
    const world = await buildWorld();
    let counter = 0;
    const choice = fc.record({
      op: fc.constantFrom(...operations),
      auth: fc.constantFrom('good', 'good', 'none', 'garbage'),
      origin: fc.constantFrom('good', 'good', 'good', 'none', 'wrong'),
      body: fc.constantFrom('valid', 'valid', 'invalid', 'junk', 'none'),
      target: fc.constantFrom('valid', 'valid', 'unknown', 'malformed'),
      since: fc.constantFrom('0', 'abc', ''),
      index: fc.constantFrom('0', '1', 'x'),
    });
    await fc.assert(
      fc.asyncProperty(choice, async (c) => {
        const { serial, token, handoffId, fixture } = world;
        const isPasskit = c.op.path.startsWith('/api/passkit/');
        const target = (valid: string, unknown: string) =>
          c.target === 'valid' ? valid : c.target === 'unknown' ? unknown : 'bad value!';
        const headers: Record<string, string> = {};
        if (c.auth === 'good' && isPasskit) {
          headers.authorization = `ApplePass ${token}`;
        } else if (c.auth === 'garbage') {
          headers.authorization = isPasskit ? 'ApplePass junk' : 'Bearer junk';
        }
        const bodies: Record<string, Record<string, unknown>> = {
          issuePasses: {
            valid: issueBody(`RND${String(100 + (counter += 1))}`),
            invalid: { platforms: [] },
          },
          updatePass: { valid: samplePassFields({ room: 'Room 8' }), invalid: { nope: 1 } },
          createHandoff: {
            valid: {
              serialNumbers: [serial],
              include: { apple: true, google: true, calendar: true },
            },
            invalid: { serialNumbers: [] },
          },
          registerDevice: { valid: { pushToken: 'aabb' }, invalid: { pushToken: 'zz' } },
          logMessages: { valid: { logs: ['x'] }, invalid: { logs: 5 } },
        };
        const set = bodies[c.op.operationId];
        const body =
          set === undefined || c.body === 'none'
            ? undefined
            : c.body === 'junk'
              ? '{not json'
              : set[c.body];
        const options: CallOptions = {
          method: c.op.method.toUpperCase(),
          resource: c.op.path,
          token: c.auth === 'good' && !isPasskit ? SUB : undefined,
          headers,
          body,
          origin: c.origin === 'good' ? undefined : c.origin === 'none' ? null : 'wrong',
          query: { passesUpdatedSince: c.since },
          path: {
            serialNumber: target(serial, UNKNOWN_SERIAL),
            handoffId: target(handoffId, UNKNOWN_HANDOFF),
            bundleIndex: c.index,
            deviceLibraryIdentifier: target('library-0000000001', 'nobody-library-0001'),
            passTypeIdentifier: c.target === 'malformed' ? 'pass.other' : PASS_TYPE,
          },
        };
        const reply: Reply = await (isPasskit
          ? fixture.callPasskit(options)
          : fixture.call(options));
        const status = reply.result.statusCode;
        const allowed = [...c.op.statuses.filter((s) => s !== 500), 403];
        expect(allowed, `${c.op.operationId} answered ${status}`).toContain(status);
        if (status === 403) {
          expect(ProblemSchema.parse(reply.json).code).toBe('forbidden');
        } else {
          expectConforms(c.op, reply);
        }
      }),
      { numRuns: 300 },
    );
  });
});
