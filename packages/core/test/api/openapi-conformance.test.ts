import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { createHarness, response } from './operation-harness.js';
import {
  EVENTS_API_BASE_URL,
  type ClientContext,
  type ClientRequest,
  type OperationName,
} from '../../src/api/transport.js';
import { listEvents } from '../../src/api/list-events.js';
import { getEvent } from '../../src/api/get-event.js';
import { listSessions } from '../../src/api/list-sessions.js';
import { getSession } from '../../src/api/get-session.js';
import { getSchedule } from '../../src/api/get-schedule.js';
import { reserveSessions } from '../../src/api/reserve-sessions.js';
import { cancelReservation } from '../../src/api/cancel-reservation.js';
import { associateFavorites } from '../../src/api/associate-favorites.js';
import { disassociateFavorite } from '../../src/api/disassociate-favorite.js';
import { createPersonalTime } from '../../src/api/create-personal-time.js';
import { updatePersonalTime } from '../../src/api/update-personal-time.js';
import { deletePersonalTime } from '../../src/api/delete-personal-time.js';

// Structural conformance test (events-client, S1). Reads the official Events API
// OpenAPI document at test time and asserts, for all twelve operations, that the
// method, the path template and the query parameter names the client can send match
// the document exactly. No path here is hand-written: every expectation comes from
// the document, keyed by operationId.

const documentPath = fileURLToPath(
  new URL('../../../contracts/events-api.openapi.json', import.meta.url),
);

interface OpenApiParameter {
  name: string;
  in: string;
}
interface OpenApiOperation {
  operationId: string;
  parameters?: OpenApiParameter[];
}
interface OpenApiDocument {
  servers: { url: string }[];
  paths: Record<string, Record<string, OpenApiOperation>>;
}

const document = JSON.parse(readFileSync(documentPath, 'utf8')) as OpenApiDocument;

interface DocumentedOperation {
  method: string;
  /** The path template relative to the client base URL (the document's /v1 removed). */
  template: string;
  queryNames: string[];
}

/** The base URL path prefix (for example /v1) that the document puts in each path. */
const basePrefix = new URL(EVENTS_API_BASE_URL).pathname;

const documented = new Map<string, DocumentedOperation>();
for (const [path, item] of Object.entries(document.paths)) {
  for (const [method, operation] of Object.entries(item)) {
    documented.set(operation.operationId, {
      method: method.toUpperCase(),
      template: path.startsWith(basePrefix) ? path.slice(basePrefix.length) : path,
      queryNames: (operation.parameters ?? [])
        .filter((p) => p.in === 'query')
        .map((p) => p.name)
        .sort(),
    });
  }
}

/** Match a real path against a template and recover the decoded parameter values. */
function matchTemplate(template: string, actual: string): Record<string, string> | undefined {
  const names: string[] = [];
  const pattern = template
    .split(/(\{[^}]+\})/)
    .map((part) => {
      const m = /^\{([^}]+)\}$/.exec(part);
      if (m?.[1] !== undefined) {
        names.push(m[1]);
        return '([^/]+)';
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  const found = new RegExp(`^${pattern}$`).exec(actual);
  if (found === null) {
    return undefined;
  }
  return Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(found[i + 1] ?? '')]));
}

const personalTime = {
  startDateTime: '2026-12-01T12:00:00-08:00',
  endDateTime: '2026-12-01T13:00:00-08:00',
  title: 'Lunch',
  description: 'Break',
};
const emptySchedule = { schedule: { reserved: [], favorites: [], personalTime: [] } };
const bulk = { result: { successful: ['S1'], failed: [] } };
const sessionBody = { session: { sessionId: 'S1', title: 'T' } };
const eventBody = {
  eventId: 'reinvent2026',
  name: 'AWS re:Invent 2026',
  eventType: 'conference',
  startDate: '2026-11-30T00:00:00-08:00',
  endDate: '2026-12-04T23:59:59-08:00',
  isOnline: false,
  authenticationRequired: true,
};

interface Case {
  operation: OperationName;
  /** The path parameter values the call is made with, by template name. */
  expectedParams: Record<string, string>;
  /** Makes the call supplying every optional query parameter the client supports. */
  call: (ctx: ClientContext) => Promise<unknown>;
  reply: ReturnType<typeof response>;
}

const cases: Case[] = [
  {
    operation: 'ListEvents',
    expectedParams: {},
    call: (c) => listEvents(c, { includePast: true }),
    reply: response(200, { items: [] }),
  },
  {
    operation: 'GetEvent',
    expectedParams: { eventId: 'reinvent2026' },
    call: (c) => getEvent(c, 'reinvent2026'),
    reply: response(200, { event: eventBody }),
  },
  {
    operation: 'ListSessions',
    expectedParams: { eventId: 'reinvent2026' },
    call: (c) => listSessions(c, { locale: 'en-US', includeAbstracts: true, nextToken: 'tok' }),
    reply: response(200, { items: [], totalCount: 0 }),
  },
  {
    operation: 'GetSession',
    expectedParams: { eventId: 'reinvent2026', sessionId: 'S/1' },
    call: (c) => getSession(c, 'S/1', { locale: 'en-US' }),
    reply: response(200, sessionBody),
  },
  {
    operation: 'GetSchedule',
    expectedParams: { eventId: 'reinvent2026' },
    call: (c) => getSchedule(c),
    reply: response(200, emptySchedule),
  },
  {
    operation: 'ReserveSessions',
    expectedParams: { eventId: 'reinvent2026' },
    call: (c) => reserveSessions(c, ['S1']),
    reply: response(200, bulk),
  },
  {
    operation: 'CancelReservation',
    expectedParams: { eventId: 'reinvent2026', sessionId: 'S/1' },
    call: (c) => cancelReservation(c, 'S/1'),
    reply: response(204, undefined),
  },
  {
    operation: 'AssociateFavorites',
    expectedParams: { eventId: 'reinvent2026' },
    call: (c) => associateFavorites(c, ['S1']),
    reply: response(200, bulk),
  },
  {
    operation: 'DisassociateFavorite',
    expectedParams: { eventId: 'reinvent2026', sessionId: 'S/1' },
    call: (c) => disassociateFavorite(c, 'S/1'),
    reply: response(204, undefined),
  },
  {
    operation: 'CreatePersonalTime',
    expectedParams: { eventId: 'reinvent2026' },
    call: (c) => createPersonalTime(c, personalTime),
    reply: response(204, undefined),
  },
  {
    operation: 'UpdatePersonalTime',
    expectedParams: { eventId: 'reinvent2026', personalTimeId: 'p/1' },
    call: (c) => updatePersonalTime(c, 'p/1', personalTime),
    reply: response(204, undefined),
  },
  {
    operation: 'DeletePersonalTime',
    expectedParams: { eventId: 'reinvent2026', personalTimeId: 'p/1' },
    call: (c) => deletePersonalTime(c, 'p/1'),
    reply: response(204, undefined),
  },
];

describe('events-client: the client matches the official Events API document', () => {
  test('the document describes exactly the twelve operations and one server', () => {
    expect([...documented.keys()].sort()).toEqual(cases.map((c) => c.operation).sort());
    expect(document.servers.map((s) => s.url)).toEqual(['https://api.awsevents.com']);
    expect(EVENTS_API_BASE_URL).toBe(`${document.servers[0]?.url ?? ''}${basePrefix}`);
  });

  for (const testCase of cases) {
    test(`${testCase.operation}: method, path template and query names match`, async () => {
      const spec = documented.get(testCase.operation);
      expect(spec).toBeDefined();
      const h = createHarness({ responses: [testCase.reply] });
      await testCase.call(h.ctx);
      const sent: ClientRequest | undefined = h.sent[0];
      expect(sent?.operation).toBe(testCase.operation);
      expect(sent?.method).toBe(spec?.method);
      // The sent path must fit the documented template, and the recovered values must
      // be the ones the call was made with (so every segment is encoded and in place).
      expect(matchTemplate(spec?.template ?? '', sent?.path ?? '')).toEqual(
        testCase.expectedParams,
      );
      // The call supplying every supported option sends exactly the documented set
      // of query names, so no undocumented parameter can be sent and none is missing.
      expect(Object.keys(sent?.query ?? {}).sort()).toEqual(spec?.queryNames);
    });
  }
});
