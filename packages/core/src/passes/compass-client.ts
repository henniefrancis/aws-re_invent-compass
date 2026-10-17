// Compass_Client for the pass side (boarding-passes, S4, Requirement 2).
//
// The only S4 component that performs network I/O, and only through the injected
// HttpTransport. It calls the Compass API with contract-typed requests, attaches the
// Builder ID ID token as a bearer credential on every attendee route (fetched fresh per
// attempt, never stored), validates every response body against its contract schema and
// returns nothing unvalidated.
//
// Failure discipline (Requirement 8): every failure is a CompassError whose message is a
// fixed sentence naming at most the method and the route template. The request input,
// the token, the base URL and the response body are never copied into an error.
import { ProblemSchema, type PassFields, type Problem } from '@compass/contracts';
import { z } from 'zod';
import {
  CreateHandoffResponseSchema,
  ForgetMeResponseSchema,
  IssuePassesResponseSchema,
  UpdatePassResponseSchema,
  VoidPassResponseSchema,
  type CreateHandoffRequest,
  type CreateHandoffResponse,
  type ForgetMeResponse,
  type IssuePassesRequest,
  type IssuePassesResponse,
  type UpdatePassResponse,
  type VoidPassResponse,
} from './compass-api-schemas.js';
import type {
  Clock,
  HttpRequest,
  HttpResponse,
  HttpTransport,
  IdTokenProvider,
} from './interfaces.js';
import { PassError } from './redaction.js';

/** The longest Retry-After wait the client sits out itself, in milliseconds. A longer wait is surfaced. */
const MAX_RETRY_WAIT_MS = 60_000;
/** Hosts a simulated run may use over plain http. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
/** The characters kept in a server-supplied problem title, and the caps on its fields. */
const TITLE_CHARACTERS = /[A-Za-z0-9 .,:;'"!?()&/+#@_-]/;
const MAX_TITLE_LENGTH = 80;
const MAX_CODE_LENGTH = 64;
const MAX_TYPE_LENGTH = 200;
/** The longest ID token the client will put in a header. */
const MAX_TOKEN_LENGTH = 8192;
/** The characters a JWT (base64url segments and dots) can contain, plus base64 padding. */
const TOKEN_PATTERN = /^[A-Za-z0-9._~+/=-]+$/;
/** A pass serial number is a UUID, so nothing else may reach a URL path. */
const SERIAL_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An HTTP-date in the IMF-fixdate form, for example Sun, 06 Nov 1994 08:49:37 GMT. */
const HTTP_DATE_PATTERN = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/;
/** Limits from the contract. */
const MAX_ISSUE_PASSES = 25;
const MAX_HANDOFF_SERIALS = 80;

/**
 * The error the client raises. The code is one of compass.problem, compass.rate_limited,
 * compass.http_error, compass.validation_failed, compass.transport_failed,
 * compass.no_id_token, compass.invalid_input or compass.invalid_config. status is the
 * HTTP status when a response was received. problem is the parsed Problem body when the
 * server sent one; the Problem shape has no field that can carry request input.
 */
export class CompassError extends PassError {
  readonly status?: number;
  readonly problem?: Problem;
  /** On a 429 whose Retry-After is usable: the server's wait in seconds, never clamped. */
  readonly retryAfterSeconds?: number;

  constructor(
    code: string,
    summary: string,
    details: { status?: number; problem?: Problem; retryAfterSeconds?: number } = {},
  ) {
    super(code, summary);
    this.name = 'CompassError';
    this.status = details.status;
    this.problem = details.problem;
    this.retryAfterSeconds = details.retryAfterSeconds;
  }
}

/** The outcome of an update: the new version, or the signal that the serial is gone. */
export type UpdatePassResult =
  { outcome: 'updated'; response: UpdatePassResponse } | { outcome: 'gone' };

/** The outcome of a void: the voided state, or the signal that the serial is gone. */
export type VoidPassResult =
  { outcome: 'voided'; response: VoidPassResponse } | { outcome: 'gone' };

/**
 * The outcome of forget-me: the HTTP status, and the validated body when there is a usable
 * one. A 404 or 410 (the server holds nothing for this attendee) and a 202 whose body does
 * not match the contract both return without a body rather than failing, so the caller can
 * still clean up locally.
 */
export interface ForgetMeResult {
  status: number;
  response?: ForgetMeResponse;
}

/** The options for createCompassClient. */
export interface CompassClientOptions {
  /**
   * https://<host>, with an optional path prefix. The host must be one of allowedHosts, or
   * (with simulated) a local host; there is no pattern match, so a look-alike host never passes.
   * The client never sends x-api-key: CloudFront adds it. The transport must be built to
   * refuse redirects (fetch with redirect 'error'), so the bearer token never follows one.
   */
  baseUrl: string;
  /**
   * The exact hosts that may receive the bearer token, compared in lower case; the port must be
   * 443 or absent. The caller MUST take this list from a build-time constant, never from the
   * same environment variable or configuration file that supplies baseUrl, otherwise whoever
   * can change the URL can change the allowlist with it.
   */
  allowedHosts: readonly string[];
  /** True only for a simulated run: allows localhost over http. */
  simulated?: boolean;
  /**
   * Refuse a token whose unverified payload does not say token_use is id. Defaults to true. This
   * is defence in depth; the check is confirmed against a real Builder ID token at spike SP2,
   * and this switch exists so a different real claim shape can be accommodated without a code
   * change. The token must still be a plain header-safe string.
   */
  checkTokenUse?: boolean;
  transport: HttpTransport;
  idToken: IdTokenProvider;
  /** Used for the single Retry-After wait and to resolve an HTTP-date. */
  clock: Clock;
}

/** The six Compass API operations S4 uses. */
export interface CompassClient {
  /** The origin (scheme, host and port) every request goes to, as pinned at construction. */
  readonly origin: string;
  issuePasses(request: IssuePassesRequest): Promise<IssuePassesResponse>;
  getApplePass(serialNumber: string): Promise<Uint8Array>;
  updatePass(serialNumber: string, fields: PassFields): Promise<UpdatePassResult>;
  voidPass(serialNumber: string): Promise<VoidPassResult>;
  createHandoff(request: CreateHandoffRequest): Promise<CreateHandoffResponse>;
  forgetMe(): Promise<ForgetMeResult>;
}

/** One planned call: everything needed to send it and to describe it safely. */
interface Call {
  method: HttpRequest['method'];
  /** The route template, for example /api/v1/passes/{serialNumber}. Safe to put in an error. */
  route: string;
  /** The concrete path, with any serial number substituted. Never put in an error. */
  path: string;
  body?: unknown;
  accept: string;
  binary?: boolean;
}

/** Client-side request checks. The messages are fixed, so no input is ever echoed. */
const platformsSchema = z
  .array(z.enum(['apple', 'google']))
  .min(1)
  .max(2);
const passesSchema = z
  .array(z.custom<PassFields>((value) => typeof value === 'object' && value !== null))
  .min(1)
  .max(MAX_ISSUE_PASSES);
const serialNumbersSchema = z
  .array(z.string().regex(SERIAL_PATTERN))
  .min(1)
  .max(MAX_HANDOFF_SERIALS);
const includeSchema = z.strictObject({
  apple: z.boolean(),
  google: z.boolean(),
  calendar: z.boolean(),
});

/** Resolve a Retry-After header to whole seconds, never clamped, or undefined when unusable. */
function retryAfterSeconds(header: string | undefined, now: Date): number | undefined {
  if (header === undefined) {
    return undefined;
  }
  const value = header.trim();
  if (/^\d+$/.test(value)) {
    return Number(value);
  }
  if (!HTTP_DATE_PATTERN.test(value)) {
    return undefined;
  }
  const at = Date.parse(value);
  if (Number.isNaN(at)) {
    return undefined;
  }
  return Math.ceil(Math.max(at - now.getTime(), 0) / 1000);
}

/** The invalid-config error. It never names the URL. */
function invalidConfig(): CompassError {
  return new CompassError('compass.invalid_config', 'The Compass API base URL is not valid.');
}

/**
 * Normalise the base URL to an origin and path with no trailing slash, and pin the host to an
 * exact allowed host (compared in lower case) or, when simulated, a local host. Credentials, a
 * query and a fragment are refused. Plain http and a port other than 443 are local-only.
 */
function normaliseBaseUrl(
  baseUrl: string,
  allowedHosts: readonly string[],
  simulated: boolean,
): { base: string; origin: string } {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw invalidConfig();
  }
  const local = simulated && LOCAL_HOSTS.has(parsed.hostname);
  const hostOk = allowedHosts.some((allowed) => allowed.toLowerCase() === parsed.hostname) || local;
  const schemeOk = parsed.protocol === 'https:' || (local && parsed.protocol === 'http:');
  const clean =
    parsed.username === '' &&
    parsed.password === '' &&
    parsed.search === '' &&
    parsed.hash === '' &&
    (parsed.port === '' || local);
  if (!hostOk || !schemeOk || !clean) {
    throw invalidConfig();
  }
  return { base: `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`, origin: parsed.origin };
}

/** True when the token's payload (decoded, not trusted) says it is an ID token. */
function claimsIdToken(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return false;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1] as string, 'base64url').toString('utf8'),
    ) as unknown;
    return (
      typeof payload === 'object' &&
      payload !== null &&
      (payload as { token_use?: unknown }).token_use === 'id'
    );
  } catch {
    return false;
  }
}

/** Keep only the allowed characters of a server-supplied string, capped in length. */
function cleaned(value: string, allowed: RegExp, max: number): string {
  return Array.from(value)
    .filter((character) => allowed.test(character))
    .join('')
    .slice(0, max)
    .trim();
}

/** A parsed Problem with its text fields reduced to a safe character set and length. */
function sanitisedProblem(problem: Problem): Problem {
  return {
    type: cleaned(problem.type, /[A-Za-z0-9:/._~#?&=%+@-]/, MAX_TYPE_LENGTH),
    title: cleaned(problem.title, TITLE_CHARACTERS, MAX_TITLE_LENGTH),
    status: problem.status,
    code: cleaned(problem.code, /[A-Za-z0-9_.-]/, MAX_CODE_LENGTH),
  };
}

/** Throw the fixed invalid-input error. */
function invalidInput(what: string): never {
  throw new CompassError('compass.invalid_input', `The ${what} is not valid.`);
}

/** Check a serial number before it is placed in a URL path. */
function checkSerial(serialNumber: string): string {
  if (!SERIAL_PATTERN.test(serialNumber)) {
    invalidInput('serial number');
  }
  return serialNumber;
}

/** Build the Compass_Client over the injected seams. */
export function createCompassClient(options: CompassClientOptions): CompassClient {
  const { transport, idToken, clock } = options;
  const checkTokenUse = options.checkTokenUse ?? true;
  const { base: baseUrl, origin } = normaliseBaseUrl(
    options.baseUrl,
    options.allowedHosts,
    options.simulated ?? false,
  );

  /** Fetch the ID token fresh and refuse anything that is not a plain token. */
  async function bearer(): Promise<string> {
    let token: string;
    try {
      token = await idToken.getIdToken();
    } catch {
      throw new CompassError('compass.no_id_token', 'No ID token is available. Sign in again.');
    }
    if (
      token.length > MAX_TOKEN_LENGTH ||
      !TOKEN_PATTERN.test(token) ||
      (checkTokenUse && !claimsIdToken(token))
    ) {
      throw new CompassError('compass.no_id_token', 'No ID token is available. Sign in again.');
    }
    return `Bearer ${token}`;
  }

  /** Send the call once. A transport failure is reduced to the route template. */
  async function attempt(call: Call): Promise<HttpResponse> {
    const headers: Record<string, string> = {
      accept: call.accept,
      authorization: await bearer(),
    };
    const request: HttpRequest = { method: call.method, url: `${baseUrl}${call.path}`, headers };
    if (call.body !== undefined) {
      headers['content-type'] = 'application/json';
      request.body = JSON.stringify(call.body);
    }
    if (call.binary) {
      request.binary = true;
    }
    try {
      return await transport.request(request);
    } catch {
      throw new CompassError(
        'compass.transport_failed',
        `The Compass API request ${call.method} ${call.route} failed.`,
      );
    }
  }

  /** Send the call, retrying exactly once after a usable Retry-After on a 429. */
  async function send(call: Call): Promise<HttpResponse> {
    const first = await attempt(call);
    if (first.status !== 429) {
      return first;
    }
    const seconds = retryAfterSeconds(first.headers['retry-after'], clock.now());
    if (seconds === undefined || seconds * 1000 > MAX_RETRY_WAIT_MS) {
      return first;
    }
    await clock.sleep(seconds * 1000);
    return attempt(call);
  }

  /** Turn a non-success response into the right CompassError. */
  function failure(response: HttpResponse, call: Call): CompassError {
    const label = `${call.method} ${call.route}`;
    const contentType = (response.headers['content-type'] ?? '').toLowerCase();
    let problem: Problem | undefined;
    if (contentType.startsWith('application/problem+json')) {
      const parsed = parseProblem(response.body);
      if (parsed === undefined) {
        return new CompassError(
          'compass.validation_failed',
          `The Compass API error for ${label} did not match the contract.`,
          { status: response.status },
        );
      }
      problem = sanitisedProblem(parsed);
    }
    const details = { status: response.status, problem };
    if (response.status === 429) {
      const wait = retryAfterSeconds(response.headers['retry-after'], clock.now());
      return new CompassError(
        'compass.rate_limited',
        wait === undefined
          ? `The Compass API rate limit was hit for ${label}.`
          : `The Compass API rate limit was hit for ${label}. Retry after ${String(wait)} seconds.`,
        { ...details, retryAfterSeconds: wait },
      );
    }
    if (problem) {
      return new CompassError(
        'compass.problem',
        `The Compass API refused ${label}: ${problem.title} (${problem.code}).`,
        details,
      );
    }
    return new CompassError(
      'compass.http_error',
      `The Compass API answered ${String(response.status)} for ${label}.`,
      details,
    );
  }

  /** Parse and validate a success body. Nothing unvalidated is returned. */
  function validated<T>(response: HttpResponse, call: Call, schema: z.ZodType<T>): T {
    if (response.status < 200 || response.status >= 300) {
      throw failure(response, call);
    }
    let json: unknown;
    try {
      json = JSON.parse(response.body);
    } catch {
      json = undefined;
    }
    const result = schema.safeParse(json);
    if (!result.success) {
      throw new CompassError(
        'compass.validation_failed',
        `The Compass API response for ${call.method} ${call.route} did not match the contract.`,
        { status: response.status },
      );
    }
    return result.data;
  }

  const SERIAL_ROUTE = '/api/v1/passes/{serialNumber}';

  return {
    origin,

    async issuePasses(request) {
      if (!platformsSchema.safeParse(request.platforms).success) {
        invalidInput('platform list');
      }
      if (!passesSchema.safeParse(request.passes).success) {
        invalidInput('pass list');
      }
      const call: Call = {
        method: 'POST',
        route: '/api/v1/passes',
        path: '/api/v1/passes',
        body: { platforms: request.platforms, passes: request.passes },
        accept: 'application/json',
      };
      return validated(await send(call), call, IssuePassesResponseSchema);
    },

    async getApplePass(serialNumber) {
      const call: Call = {
        method: 'GET',
        route: `${SERIAL_ROUTE}/apple`,
        path: `/api/v1/passes/${checkSerial(serialNumber)}/apple`,
        accept: 'application/vnd.apple.pkpass',
        binary: true,
      };
      const response = await send(call);
      if (response.status < 200 || response.status >= 300) {
        throw failure(response, call);
      }
      if (!(response.bytes instanceof Uint8Array) || response.bytes.length === 0) {
        throw new CompassError(
          'compass.validation_failed',
          `The Compass API response for ${call.method} ${call.route} did not match the contract.`,
          { status: response.status },
        );
      }
      return response.bytes;
    },

    async updatePass(serialNumber, fields) {
      const call: Call = {
        method: 'PUT',
        route: SERIAL_ROUTE,
        path: `/api/v1/passes/${checkSerial(serialNumber)}`,
        body: fields,
        accept: 'application/json',
      };
      const response = await send(call);
      if (isGone(response)) {
        return { outcome: 'gone' };
      }
      return { outcome: 'updated', response: validated(response, call, UpdatePassResponseSchema) };
    },

    async voidPass(serialNumber) {
      const call: Call = {
        method: 'POST',
        route: `${SERIAL_ROUTE}/void`,
        path: `/api/v1/passes/${checkSerial(serialNumber)}/void`,
        accept: 'application/json',
      };
      const response = await send(call);
      if (isGone(response)) {
        return { outcome: 'gone' };
      }
      return { outcome: 'voided', response: validated(response, call, VoidPassResponseSchema) };
    },

    async createHandoff(request) {
      if (!serialNumbersSchema.safeParse(request.serialNumbers).success) {
        invalidInput('serial number list');
      }
      if (!includeSchema.safeParse(request.include).success) {
        invalidInput('include flags');
      }
      const call: Call = {
        method: 'POST',
        route: '/api/v1/handoffs',
        path: '/api/v1/handoffs',
        body: { serialNumbers: request.serialNumbers, include: request.include },
        accept: 'application/json',
      };
      return validated(await send(call), call, CreateHandoffResponseSchema);
    },

    async forgetMe() {
      const call: Call = {
        method: 'DELETE',
        route: '/api/v1/me',
        path: '/api/v1/me',
        accept: 'application/json',
      };
      const response = await send(call);
      if (response.status === 404 || response.status === 410) {
        return { status: response.status };
      }
      if (response.status === 202) {
        let json: unknown;
        try {
          json = JSON.parse(response.body);
        } catch {
          json = undefined;
        }
        const parsed = ForgetMeResponseSchema.safeParse(json);
        return parsed.success ? { status: 202, response: parsed.data } : { status: 202 };
      }
      return {
        status: response.status,
        response: validated(response, call, ForgetMeResponseSchema),
      };
    },
  };
}

/** True for a 404 that is a real contract Problem, the only 404 that means the serial is gone. */
function isGone(response: HttpResponse): boolean {
  return (
    response.status === 404 &&
    (response.headers['content-type'] ?? '').toLowerCase().startsWith('application/problem+json') &&
    parseProblem(response.body) !== undefined
  );
}

/** Parse a problem+json body, or undefined when it is not valid JSON or not a Problem. */
function parseProblem(body: string): Problem | undefined {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return undefined;
  }
  const result = ProblemSchema.safeParse(json);
  return result.success ? result.data : undefined;
}
