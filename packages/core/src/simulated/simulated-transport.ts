// Simulated transport (events-client, S1, task 14.1).
//
// An offline stand-in for the live Events API behind the same Transport seam. It
// routes on the official event-scoped paths (method plus path, relative to the
// /v1 base the live transport prefixes) and the event id, so the client code that
// builds a request is exercised exactly as in live mode, and it returns real status
// codes and headers so the retry, quota and error mapping above the transport run
// unchanged (Requirement 18).
//
//   - It presents a signed-in attendee: there is no credential, no OAuth call, and no
//     network of any kind. It never builds a URL and never imports a fetch.
//   - Sessions come only from the synthetic catalog; the event comes from the
//     ListEvents and GetEvent fixtures; everything else is derived from an in-memory
//     schedule (see in-memory-schedule.ts).
//   - Configured scenarios: an operation in throttleOps answers 429 with the
//     Retry-After of its fixture (checked to be a whole number from 1 to 60), one in
//     expiredTokenOps answers the 401 expired-token fixture. Each scenario answers the
//     first `scenarioRepeats` calls of that operation (default 1) and then behaves
//     normally, so the client's single refresh or wait and retry can succeed.
//   - Request bodies are checked against the OpenAPI constraints (request-rules.ts) and
//     answer 400 when they break them.
//   - Unknown routes and a wrong event id answer 404.

import type { PersonalTimeInput, SessionWire } from '@compass/contracts';
import { GetEventResultSchema } from '../api/response-wrappers.js';
import type {
  ClientRequest,
  OperationName,
  RawResponse,
  ResponseHeaders,
  Transport,
} from '../api/transport.js';
import { createInMemorySchedule } from './in-memory-schedule.js';
import { checkBulkBody, checkPersonalTimeBody } from './request-rules.js';
import type { FixtureLoader } from './fixtures.js';

/** Scenarios and sizes for the simulated transport. */
export interface SimulatedConfig {
  /** Sessions that always answer sessionFull when reserved. */
  fullSessionIds?: readonly string[];
  /** Operations that answer the 429 fixture. */
  throttleOps?: readonly OperationName[];
  /** Operations that answer the 401 expired-token fixture. */
  expiredTokenOps?: readonly OperationName[];
  /** How many calls of a configured operation get the scenario. Default 1. */
  scenarioRepeats?: number;
  /** Sessions per ListSessions page. Default 50. */
  pageSize?: number;
  /**
   * An injected clock (epoch milliseconds), for a fixed demo instant such as
   * 2026-11-29T18:00:00-08:00. With a clock, reserving a session that has already
   * started answers timePassed; without one, nothing ever has.
   */
  now?: () => number;
}

const DEFAULT_PAGE_SIZE = 50;
const MIN_RETRY_AFTER = 1;
const MAX_RETRY_AFTER = 60;

/** Headers over a plain record, with a case-insensitive get. */
function makeHeaders(record: Record<string, string> = {}): ResponseHeaders {
  const lower = new Map(Object.entries(record).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name) => lower.get(name.toLowerCase()) ?? null };
}

function json(status: number, body: unknown): RawResponse {
  return { status, headers: makeHeaders({ 'content-type': 'application/json' }), body };
}

function noContent(): RawResponse {
  return { status: 204, headers: makeHeaders(), body: undefined };
}

function message(status: number, text: string): RawResponse {
  return json(status, { message: text });
}

/** A route the simulated API serves, and the segments it matched. */
interface Route {
  operation: OperationName;
  /** The id segment after the resource, when the route has one. */
  id?: string;
}

/** Decode one path segment, or undefined if it is not valid percent-encoding. */
function decode(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

/** Match method and path against the official routes. `eventId` is checked by the caller. */
function matchRoute(
  method: string,
  segments: readonly string[],
): (Route & { eventId?: string }) | undefined {
  const [root, eventId, resource, id, extra] = segments;
  if (root !== 'events' || extra !== undefined) {
    return undefined;
  }
  if (eventId === undefined) {
    return method === 'GET' ? { operation: 'ListEvents' } : undefined;
  }
  if (resource === undefined) {
    return method === 'GET' ? { operation: 'GetEvent', eventId } : undefined;
  }
  const table: Record<string, Partial<Record<string, OperationName>>> = {
    schedule: { GET: 'GetSchedule' },
    sessions: { GET: id === undefined ? 'ListSessions' : 'GetSession' },
    reservations: id === undefined ? { POST: 'ReserveSessions' } : { DELETE: 'CancelReservation' },
    favorites:
      id === undefined ? { POST: 'AssociateFavorites' } : { DELETE: 'DisassociateFavorite' },
    'personal-time':
      id === undefined
        ? { POST: 'CreatePersonalTime' }
        : { PUT: 'UpdatePersonalTime', DELETE: 'DeletePersonalTime' },
  };
  const operation = table[resource]?.[method];
  if (operation === undefined || (resource === 'schedule' && id !== undefined)) {
    return undefined;
  }
  return id === undefined ? { operation, eventId } : { operation, eventId, id };
}

/** Create the simulated transport. */
export function createSimulatedTransport(cfg: SimulatedConfig, fixtures: FixtureLoader): Transport {
  // Fail fast: a configured scenario must have a fixture for its operation. An
  // operation the OpenAPI document gives no such status (ListEvents and GetEvent have
  // no 401 or 429) has none, and configuring it is an error, not a silent no-op.
  for (const [ops, name] of [
    [cfg.throttleOps ?? [], 'error-429'],
    [cfg.expiredTokenOps ?? [], 'error-401-expired-token'],
  ] as const) {
    for (const op of ops) {
      try {
        fixtures.fixture(op, name);
      } catch {
        throw new Error(`The simulated API has no ${name} scenario for ${op}`);
      }
    }
  }
  const catalog: readonly SessionWire[] = fixtures.catalog();
  const eventFixture = GetEventResultSchema.parse(fixtures.fixture('GetEvent', 'success').body);
  const knownEventId = eventFixture.event.eventId;
  const schedule = createInMemorySchedule({
    sessions: catalog,
    fullSessionIds: new Set(cfg.fullSessionIds ?? []),
    eventTimezone: eventFixture.event.timezone ?? '',
    ...(cfg.now === undefined ? {} : { now: cfg.now }),
  });
  const byId = new Map(catalog.map((s) => [s.sessionId, s]));
  const pageSize = cfg.pageSize ?? DEFAULT_PAGE_SIZE;
  const repeats = cfg.scenarioRepeats ?? 1;
  const served = new Map<string, number>();

  /** The configured scenario response for an operation, if one is still due. */
  function scenario(operation: OperationName): RawResponse | undefined {
    const name =
      cfg.expiredTokenOps?.includes(operation) === true
        ? 'error-401-expired-token'
        : cfg.throttleOps?.includes(operation) === true
          ? 'error-429'
          : undefined;
    if (name === undefined) {
      return undefined;
    }
    const key = `${operation}/${name}`;
    const count = served.get(key) ?? 0;
    if (count >= repeats) {
      return undefined;
    }
    served.set(key, count + 1);
    const file = fixtures.fixture(operation, name);
    if (name === 'error-429') {
      const seconds = Number(makeHeaders(file.headers).get('retry-after'));
      if (!Number.isInteger(seconds) || seconds < MIN_RETRY_AFTER || seconds > MAX_RETRY_AFTER) {
        throw new Error('The throttle fixture must carry a Retry-After of 1 to 60 whole seconds');
      }
    }
    return { status: file.status, headers: makeHeaders(file.headers), body: file.body };
  }

  function listSessions(query: Record<string, string> | undefined): RawResponse {
    const token = query?.nextToken;
    const offset = token === undefined ? 0 : Number(token);
    if (!Number.isInteger(offset) || offset < 0 || offset > catalog.length) {
      return message(400, 'Invalid nextToken');
    }
    const withAbstracts = query?.includeAbstracts !== 'false';
    const items = catalog.slice(offset, offset + pageSize).map((s) => {
      if (withAbstracts) {
        return s;
      }
      const stripped: SessionWire = { ...s };
      delete stripped.abstract;
      return stripped;
    });
    const next = offset + pageSize;
    return json(200, {
      items,
      totalCount: catalog.length,
      ...(next < catalog.length ? { nextToken: String(next) } : {}),
    });
  }

  function bulk(body: unknown, apply: (ids: readonly string[]) => unknown): RawResponse {
    const checked = checkBulkBody(body);
    return checked.ok
      ? json(200, { result: apply(checked.value.sessionIds) })
      : message(400, checked.message);
  }

  function personalTimeWrite(
    body: unknown,
    write: (input: PersonalTimeInput) => boolean,
  ): RawResponse {
    const checked = checkPersonalTimeBody(body);
    if (!checked.ok) {
      return message(400, checked.message);
    }
    return write(checked.value) ? noContent() : message(404, 'Personal time not found');
  }

  function handle(req: ClientRequest, route: Route): RawResponse {
    const id = route.id ?? '';
    switch (route.operation) {
      case 'ListEvents':
        return json(200, fixtures.fixture('ListEvents', 'success').body);
      case 'GetEvent':
        return json(200, eventFixture);
      case 'GetSchedule':
        return json(200, { schedule: schedule.snapshot() });
      case 'ListSessions':
        return listSessions(req.query);
      case 'GetSession': {
        const session = byId.get(id);
        return session === undefined ? message(404, 'Session not found') : json(200, { session });
      }
      case 'ReserveSessions':
        return bulk(req.body, (ids) => schedule.reserve(ids));
      case 'AssociateFavorites':
        return bulk(req.body, (ids) => schedule.favorite(ids));
      case 'CancelReservation':
        return schedule.cancel(id) ? noContent() : message(404, 'Reservation not found');
      case 'DisassociateFavorite':
        return schedule.unfavorite(id) ? noContent() : message(404, 'Favorite not found');
      case 'CreatePersonalTime':
        return personalTimeWrite(req.body, (input) => {
          schedule.createPersonalTime(input);
          return true;
        });
      case 'UpdatePersonalTime':
        return personalTimeWrite(req.body, (input) => schedule.updatePersonalTime(id, input));
      case 'DeletePersonalTime':
        return schedule.deletePersonalTime(id)
          ? noContent()
          : message(404, 'Personal time not found');
    }
  }

  /** Route and answer one request. May throw for a broken fixture. */
  function serve(req: ClientRequest): RawResponse {
    const segments = req.path.split('/').slice(1).map(decode);
    const decoded = segments.filter((s): s is string => s !== undefined);
    const route = decoded.length === segments.length ? matchRoute(req.method, decoded) : undefined;
    if (route === undefined) {
      return message(404, 'Unknown route');
    }
    if (route.eventId !== undefined && route.eventId !== knownEventId) {
      return message(404, 'Event not found');
    }
    return scenario(route.operation) ?? handle(req, route);
  }

  return {
    send: (req) =>
      new Promise<RawResponse>((resolve) => {
        resolve(serve(req));
      }),
  };
}
