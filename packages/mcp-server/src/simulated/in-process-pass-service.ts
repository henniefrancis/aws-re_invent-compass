// The In_Process_Pass_Service (Requirements 22.2 to 22.4, design Component 11): an in-memory
// stand-in for the Compass API routes the pass client calls (issue, update, void, hand-off
// create, forget me). It implements the HttpTransport seam, so simulated mode, the demo and
// the end-to-end test run with no socket at all.
//
// Bodies are typed against the generated `CompassApi` types and pass fields are validated
// with `createPassFieldsSchema` for the event window. Serials are UUID v4, hand-off ids are
// 16 random bytes in base64url (22 characters), the hand-off expires 15 minutes after
// creation, and the board URL is on the reserved `.invalid` domain (RFC 2606) with the id
// only in the URL fragment, so it can never resolve. Errors are `application/problem+json`.

import { createPassFieldsSchema, ProblemSchema } from '@compass/contracts';
import type { CompassApi, PassFields } from '@compass/contracts';
import { z } from 'zod';
import type { Clock } from '../ports/clock.js';
import type { EventWindow } from '../ports/events-port.js';
import type { HttpRequest, HttpResponse, HttpTransport } from '../ports/http-transport.js';

type Schemas = CompassApi.components['schemas'];

/** The reserved host used for board URLs and the simulated base URL. */
export const SIMULATED_HOST = 'compass.invalid';

/** How long a hand-off lives. */
export const HANDOFF_LIFETIME_MS = 15 * 60 * 1000;

/** A stored pass, for tests to inspect. */
export interface StoredPass {
  sessionCode: string;
  status: 'active' | 'voided';
  version: number;
}

/** The service. */
export interface InProcessPassService {
  transport: HttpTransport;
  passes(): ReadonlyMap<string, StoredPass>;
  handoffs(): ReadonlyMap<string, { serials: string[]; expiresAt: string }>;
}

/** What the service needs. */
export interface PassServiceDeps {
  clock: Clock;
  eventWindow: EventWindow;
  random: (bytes: number) => Uint8Array;
  uuid: () => string;
}

const SERIAL_ROUTE = /^\/api\/v1\/passes\/([^/]+)(\/void)?$/;

const IssueBodySchema = z.object({
  platforms: z.array(z.enum(['apple', 'google'])).min(1),
  passes: z.array(z.unknown()).min(1).max(25),
});

const HandoffBodySchema = z.object({
  serialNumbers: z.array(z.string()).min(1).max(80),
  include: z.object({ apple: z.boolean(), google: z.boolean(), calendar: z.boolean() }),
});

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

/** Creates an empty service. */
export function createInProcessPassService(deps: PassServiceDeps): InProcessPassService {
  const passFields = createPassFieldsSchema(deps.eventWindow);
  const passes = new Map<string, StoredPass>();
  const handoffs = new Map<string, { serials: string[]; expiresAt: string }>();
  const encoder = new TextEncoder();

  const respond = (
    status: number,
    body: unknown,
    contentType = 'application/json',
  ): HttpResponse => ({
    status,
    headers: { 'content-type': contentType },
    body: encoder.encode(JSON.stringify(body)),
  });

  const problem = (status: number, code: string, title: string): HttpResponse =>
    respond(
      status,
      ProblemSchema.parse({
        type: `https://${SIMULATED_HOST}/problems/${code}`,
        title,
        status,
        code,
      }),
      'application/problem+json',
    );

  const parseJson = (request: HttpRequest): unknown => {
    const text =
      typeof request.body === 'string' ? request.body : new TextDecoder().decode(request.body);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  };

  const issue = (request: HttpRequest): HttpResponse => {
    const body = IssueBodySchema.safeParse(parseJson(request));
    if (!body.success) {
      return problem(400, 'invalid_request', 'The request was not valid.');
    }
    const parsed: PassFields[] = [];
    for (const candidate of body.data.passes) {
      const fields = passFields.safeParse(candidate);
      if (!fields.success) {
        return problem(400, 'invalid_pass_fields', 'The pass fields were not valid.');
      }
      parsed.push(fields.data);
    }
    const issued: Schemas['IssuePassesResponse']['passes'] = parsed.map((fields) => {
      const serialNumber = deps.uuid();
      passes.set(serialNumber, { sessionCode: fields.sessionCode, status: 'active', version: 1 });
      return { serialNumber, sessionCode: fields.sessionCode, platforms: body.data.platforms };
    });
    return respond(201, { passes: issued } satisfies Schemas['IssuePassesResponse']);
  };

  const update = (serial: string, request: HttpRequest): HttpResponse => {
    const stored = passes.get(serial);
    if (stored === undefined || stored.status === 'voided') {
      return problem(404, 'not_found', 'That pass was not found.');
    }
    const fields = passFields.safeParse(parseJson(request));
    if (!fields.success) {
      return problem(400, 'invalid_pass_fields', 'The pass fields were not valid.');
    }
    stored.version += 1;
    stored.sessionCode = fields.data.sessionCode;
    return respond(200, {
      serialNumber: serial,
      version: stored.version,
    } satisfies Schemas['UpdatePassResponse']);
  };

  const voidPass = (serial: string): HttpResponse => {
    const stored = passes.get(serial);
    if (stored === undefined) {
      return problem(404, 'not_found', 'That pass was not found.');
    }
    stored.status = 'voided';
    return respond(200, {
      serialNumber: serial,
      status: 'voided',
    } satisfies Schemas['VoidPassResponse']);
  };

  const createHandoff = (request: HttpRequest): HttpResponse => {
    const body = HandoffBodySchema.safeParse(parseJson(request));
    if (!body.success || !body.data.serialNumbers.every((serial) => passes.has(serial))) {
      return problem(400, 'invalid_request', 'The request was not valid.');
    }
    const handoffId = base64Url(deps.random(16));
    const expiresAt = new Date(deps.clock.now().getTime() + HANDOFF_LIFETIME_MS).toISOString();
    handoffs.set(handoffId, { serials: [...body.data.serialNumbers], expiresAt });
    return respond(201, {
      handoffId,
      boardUrl: `https://${SIMULATED_HOST}/board#h=${handoffId}`,
      expiresAt,
    } satisfies Schemas['CreateHandoffResponse']);
  };

  const forgetMe = (): HttpResponse => {
    const active = [...passes.values()].filter((pass) => pass.status === 'active').length;
    const deleted = passes.size;
    passes.clear();
    handoffs.clear();
    return respond(202, { voided: active, deleted } satisfies Schemas['ForgetMeResponse']);
  };

  const route = (request: HttpRequest): HttpResponse => {
    const { pathname } = new URL(request.url);
    const match = SERIAL_ROUTE.exec(pathname);
    if (match !== null) {
      const serial = String(match[1]);
      const isVoid = match[2] !== undefined;
      if (!isVoid && request.method === 'PUT') {
        return update(serial, request);
      }
      if (isVoid && request.method === 'POST') {
        return voidPass(serial);
      }
    }
    if (pathname === '/api/v1/passes' && request.method === 'POST') {
      return issue(request);
    }
    if (pathname === '/api/v1/handoffs' && request.method === 'POST') {
      return createHandoff(request);
    }
    if (pathname === '/api/v1/me' && request.method === 'DELETE') {
      return forgetMe();
    }
    return problem(404, 'not_found', 'There is no such route.');
  };

  const hasAuthorization = (request: HttpRequest): boolean =>
    Object.entries(request.headers).some(
      ([name, value]) => name.toLowerCase() === 'authorization' && value !== '',
    );

  return {
    transport: {
      request: (request) => {
        return Promise.resolve(
          hasAuthorization(request)
            ? route(request)
            : problem(401, 'unauthorized', 'Sign in first.'),
        );
      },
    },
    passes: () => passes,
    handoffs: () => handoffs,
  };
}
