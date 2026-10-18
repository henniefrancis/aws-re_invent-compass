import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  GetScheduleSchema,
  GetSessionSchema,
  ListSessionsSchema,
  SessionWireSchema,
  type SessionWire,
} from '@compass/contracts';
import {
  BulkWriteResultSchema,
  GetEventResultSchema,
  ListEventsResultSchema,
} from '../../src/api/response-wrappers.js';
import { classifyFailure } from '../../src/api/bulk-failure-codes.js';
import { errorForStatus, EventsApiError } from '../../src/api/errors.js';
import {
  createFsFixtureLoader,
  defaultFixturesRoot,
  operationFolder,
} from '../../src/simulated/fixtures.js';
import { createSimulatedTransport } from '../../src/simulated/simulated-transport.js';
import type { OperationName } from '../../src/api/transport.js';

// Tests for the fixtures under fixtures/api (events-client, S1, task 15; Requirement
// 19). The fixtures are read through the real loader and checked against the contract
// schemas. Every session in them must be a verbatim member of the read-only synthetic
// catalog.

const OPERATIONS: OperationName[] = [
  'ListEvents',
  'GetEvent',
  'ListSessions',
  'GetSession',
  'GetSchedule',
  'ReserveSessions',
  'CancelReservation',
  'AssociateFavorites',
  'DisassociateFavorite',
  'CreatePersonalTime',
  'UpdatePersonalTime',
  'DeletePersonalTime',
];
const NO_BODY: OperationName[] = [
  'CancelReservation',
  'DisassociateFavorite',
  'CreatePersonalTime',
  'UpdatePersonalTime',
  'DeletePersonalTime',
];

/** The statuses the official OpenAPI document declares for each operation. */
const openApi = JSON.parse(
  readFileSync(new URL('../../../contracts/events-api.openapi.json', import.meta.url), 'utf8'),
) as {
  paths: Record<
    string,
    Record<string, { operationId: string; responses: Record<string, unknown> }>
  >;
};
const declared = new Map<string, Set<number>>();
for (const item of Object.values(openApi.paths)) {
  for (const operation of Object.values(item)) {
    declared.set(operation.operationId, new Set(Object.keys(operation.responses).map(Number)));
  }
}
/** The operations whose document entry declares the given status. */
const declaring = (status: number): OperationName[] =>
  OPERATIONS.filter((op) => declared.get(op)?.has(status) === true);

const root = defaultFixturesRoot();
const apiRoot = join(root, 'api');
const loader = createFsFixtureLoader(root);
const catalog = loader.catalog();
const catalogById = new Map(catalog.map((s) => [s.sessionId, s]));

/** Every fixture file as [folder, scenario]. */
function allFixtures(): [string, string][] {
  return readdirSync(apiRoot).flatMap((folder) =>
    readdirSync(join(apiRoot, folder)).map((file): [string, string] => [
      folder,
      file.replace(/\.json$/, ''),
    ]),
  );
}

function operationOf(folder: string): OperationName {
  const found = OPERATIONS.find((op) => operationFolder(op) === folder);
  if (found === undefined) throw new Error(`unknown folder ${folder}`);
  return found;
}

describe('events-client, task 15.1: layout and naming (Requirements 19.1, 19.7)', () => {
  test('folders are exactly the twelve kebab-case operation names, and files are <scenario>.json', () => {
    expect(readdirSync(apiRoot).sort()).toEqual(OPERATIONS.map(operationFolder).sort());
    for (const [folder, scenario] of allFixtures()) {
      expect(scenario).toMatch(/^[a-z0-9-]+$/);
      expect(readFileSync(join(apiRoot, folder, `${scenario}.json`), 'utf8').endsWith('\n')).toBe(
        true,
      );
    }
  });

  test('every fixture loads through the real loader as { status, headers?, body? }', () => {
    for (const [folder, scenario] of allFixtures()) {
      const file = loader.fixture(operationOf(folder), scenario);
      expect(file.status).toBeGreaterThanOrEqual(100);
    }
  });
});

describe('events-client, task 15.1: success fixtures (Requirement 19.2)', () => {
  test('each operation has a success fixture that validates against its response schema', () => {
    const schemas = {
      ListEvents: ListEventsResultSchema,
      GetEvent: GetEventResultSchema,
      ListSessions: ListSessionsSchema,
      GetSession: GetSessionSchema,
      GetSchedule: GetScheduleSchema,
      ReserveSessions: BulkWriteResultSchema,
      AssociateFavorites: BulkWriteResultSchema,
    } as const;
    for (const op of OPERATIONS) {
      const file = loader.fixture(op, 'success');
      if (NO_BODY.includes(op)) {
        expect(file.status).toBe(204);
        expect(file.body).toBeUndefined();
      } else {
        expect(file.status).toBe(200);
        const schema = schemas[op as keyof typeof schemas];
        expect(schema.safeParse(file.body).success).toBe(true);
      }
    }
  });

  test('the event fixture carries the 30 Nov to 4 Dec window and an IANA timezone', () => {
    const { event } = GetEventResultSchema.parse(loader.fixture('GetEvent', 'success').body);
    expect(event.startDate.startsWith('2026-11-30')).toBe(true);
    expect(event.endDate.startsWith('2026-12-04')).toBe(true);
    expect(event.timezone).toBe('America/Los_Angeles');
  });
});

describe('events-client, task 15.1: error fixtures (Requirements 19.3, 19.6)', () => {
  const errorFixtures = allFixtures().filter(([, scenario]) => scenario.startsWith('error-'));

  test('statuses 400, 401, 403, 404, 409, 429 and 500 to 599 are all covered', () => {
    const statuses = errorFixtures.map(
      ([folder, scenario]) => loader.fixture(operationOf(folder), scenario).status,
    );
    for (const wanted of [400, 401, 403, 404, 409, 429]) {
      expect(statuses).toContain(wanted);
    }
    expect(statuses.some((s) => s >= 500 && s <= 599)).toBe(true);
  });

  test('each error fixture maps to a typed error carrying its status', () => {
    for (const [folder, scenario] of errorFixtures) {
      const op = operationOf(folder);
      const { status } = loader.fixture(op, scenario);
      const error = errorForStatus(op, status);
      expect(error).toBeInstanceOf(EventsApiError);
      expect(error.status).toBe(status);
    }
  });

  test('every status in every fixture is one the OpenAPI document declares for that operation (QA M6)', () => {
    for (const [folder, scenario] of allFixtures()) {
      const op = operationOf(folder);
      const { status } = loader.fixture(op, scenario);
      expect(
        declared.get(op)?.has(status),
        `${folder}/${scenario} uses status ${String(status)}`,
      ).toBe(true);
    }
  });

  test('ListEvents and GetEvent, which the document gives no 401 or 429, have no such fixtures', () => {
    for (const op of ['ListEvents', 'GetEvent'] as const) {
      expect(declaring(401)).not.toContain(op);
      expect(declaring(429)).not.toContain(op);
      expect(() => loader.fixture(op, 'error-429')).toThrow();
      expect(() => loader.fixture(op, 'error-401-expired-token')).toThrow();
    }
    expect(declaring(429)).toHaveLength(10);
  });

  test('the personal time in the schedule fixture uses the documented UTC format with no offset (QA M6)', () => {
    const { schedule } = GetScheduleSchema.parse(loader.fixture('GetSchedule', 'success').body);
    expect(schedule.personalTime.length).toBeGreaterThan(0);
    for (const entry of schedule.personalTime) {
      for (const value of [entry.startDateTime, entry.endDateTime]) {
        expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
      }
    }
  });

  test('every operation that declares 429 has a 429 fixture with a whole-second Retry-After from 1 to 60', () => {
    for (const op of declaring(429)) {
      const file = loader.fixture(op, 'error-429');
      expect(file.status).toBe(429);
      const seconds = Number(file.headers?.['retry-after']);
      expect(Number.isInteger(seconds)).toBe(true);
      expect(seconds).toBeGreaterThanOrEqual(1);
      expect(seconds).toBeLessThanOrEqual(60);
    }
  });

  test('every operation that declares 401 has an expired-token fixture that says the token expired', () => {
    for (const op of declaring(401)) {
      const file = loader.fixture(op, 'error-401-expired-token');
      expect(file.status).toBe(401);
      expect(JSON.stringify(file.body)).toContain('expired');
    }
  });

  test('the simulated transport serves these fixtures for every operation that declares them', async () => {
    for (const op of declaring(429)) {
      const transport = createSimulatedTransport({ throttleOps: [op] }, loader);
      // Route each operation through its own documented path via the shared route table.
      const routes: Record<OperationName, ['GET' | 'POST' | 'PUT' | 'DELETE', string]> = {
        ListEvents: ['GET', '/events'],
        GetEvent: ['GET', '/events/reinvent2026'],
        ListSessions: ['GET', '/events/reinvent2026/sessions'],
        GetSession: ['GET', '/events/reinvent2026/sessions/syn-001'],
        GetSchedule: ['GET', '/events/reinvent2026/schedule'],
        ReserveSessions: ['POST', '/events/reinvent2026/reservations'],
        CancelReservation: ['DELETE', '/events/reinvent2026/reservations/syn-001'],
        AssociateFavorites: ['POST', '/events/reinvent2026/favorites'],
        DisassociateFavorite: ['DELETE', '/events/reinvent2026/favorites/syn-001'],
        CreatePersonalTime: ['POST', '/events/reinvent2026/personal-time'],
        UpdatePersonalTime: ['PUT', '/events/reinvent2026/personal-time/pt-1'],
        DeletePersonalTime: ['DELETE', '/events/reinvent2026/personal-time/pt-1'],
      };
      const [m, p] = routes[op];
      const res = await transport.send({ operation: op, method: m, path: p });
      expect(res.status).toBe(429);
      const expired = createSimulatedTransport({ expiredTokenOps: [op] }, loader);
      expect((await expired.send({ operation: op, method: m, path: p })).status).toBe(401);
    }
  });
});

describe('events-client, task 15.1: catalog pages (Requirement 19.4)', () => {
  const pageNames = readdirSync(join(apiRoot, 'list-sessions'))
    .map((f) => f.replace(/\.json$/, ''))
    .filter((n) => /^page-\d+$/.test(n))
    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));

  test('there are at least two pages; every page but the last has a nextToken and the last has none', () => {
    expect(pageNames.length).toBeGreaterThanOrEqual(2);
    pageNames.forEach((name, i) => {
      const page = ListSessionsSchema.parse(loader.fixture('ListSessions', name).body);
      expect(page.nextToken !== undefined).toBe(i < pageNames.length - 1);
      if (page.nextToken !== undefined) {
        expect(page.nextToken.length).toBeGreaterThan(0);
      }
    });
  });

  test('the pages together are the whole synthetic catalog, in order', () => {
    const ids = pageNames.flatMap((name) =>
      ListSessionsSchema.parse(loader.fixture('ListSessions', name).body).items.map(
        (s) => s.sessionId,
      ),
    );
    expect(ids).toEqual(catalog.map((s) => s.sessionId));
  });
});

describe('events-client, task 15.1: unknown failure codes (Requirement 19.5)', () => {
  test('a bulk fixture carries a per-session failure whose code is not a known BulkFailureCode', () => {
    const found = (['ReserveSessions', 'AssociateFavorites'] as const).some((op) => {
      const body = BulkWriteResultSchema.parse(
        loader.fixture(op, 'partial-failure-unknown-code').body,
      );
      return body.result.failed.some((f) => classifyFailure(f) === 'unrecognised-refusal');
    });
    expect(found).toBe(true);
  });
});

describe('events-client, task 15.1: sessions are drawn only from the synthetic catalog', () => {
  /** Every object in a fixture body that looks like a session (has sessionId and title). */
  function sessionsIn(value: unknown, out: SessionWire[] = []): SessionWire[] {
    if (Array.isArray(value)) {
      value.forEach((v) => sessionsIn(v, out));
    } else if (typeof value === 'object' && value !== null) {
      const record = value as Record<string, unknown>;
      if (typeof record.sessionId === 'string' && typeof record.title === 'string') {
        out.push(SessionWireSchema.parse(record));
      } else {
        Object.values(record).forEach((v) => sessionsIn(v, out));
      }
    }
    return out;
  }

  test('every session in every fixture equals its entry in fixtures/synthetic/catalog.json', () => {
    let seen = 0;
    for (const [folder, scenario] of allFixtures()) {
      for (const s of sessionsIn(loader.fixture(operationOf(folder), scenario).body)) {
        expect(s).toEqual(catalogById.get(s.sessionId));
        seen += 1;
      }
    }
    expect(seen).toBeGreaterThan(100);
  });

  test('every session id mentioned by a bulk or schedule fixture exists in the catalog', () => {
    const mentioned: string[] = [];
    for (const op of ['ReserveSessions', 'AssociateFavorites'] as const) {
      for (const scenario of ['success', 'partial-failure-unknown-code']) {
        const body = BulkWriteResultSchema.parse(loader.fixture(op, scenario).body);
        mentioned.push(...body.result.successful, ...body.result.failed.map((f) => f.sessionId));
      }
    }
    const schedule = GetScheduleSchema.parse(
      loader.fixture('GetSchedule', 'success').body,
    ).schedule;
    mentioned.push(...schedule.reserved, ...schedule.favorites);
    for (const id of mentioned) {
      expect(catalogById.has(id)).toBe(true);
    }
  });
});
