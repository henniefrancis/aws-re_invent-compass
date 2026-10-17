// An Api_Lambda wired to in-memory fakes: the memory table, a fake clock and seeded random, a
// stub token verifier (the bearer token is the SubHash), recording APNs and Google fakes, and
// a fake signer. Used by the handler, lifecycle, hand-off and contract tests.
import type { PassFields } from '@compass/contracts';
import type { ApnsClient, PushOutcome, PushTarget } from '../../src/apns/apns-client.js';
import type { PassSigner } from '../../src/apple/pass-signer.js';
import { createApiApp } from '../../src/app/api-app.js';
import type { ApiDeps } from '../../src/app/deps.js';
import { parseApiConfig, type ApiConfig } from '../../src/config/config.js';
import { createHandoffRepository } from '../../src/data/handoff-repository.js';
import { createPassRepository } from '../../src/data/pass-repository.js';
import { createRateLimiter } from '../../src/data/rate-limiter.js';
import { createRegistrationRepository } from '../../src/data/registration-repository.js';
import type { GenericObject } from '../../src/google/google-object.js';
import type { GoogleResult, GoogleWalletClient } from '../../src/google/google-wallet-client.js';
import { createMemoryTable, type MemoryTable } from '../../src/harness/memory-table.js';
import type { ProxyResult } from '../../src/http/event.js';
import { ProblemError } from '../../src/http/problem.js';
import { createCapture, type Capture } from './capture.js';
import { createFakeClock, type FakeClock } from './fake-clock.js';
import { createFakeSecrets, type FakeSecrets, type FakeSecretsInit } from './fake-secrets.js';
import { samplePassFields, TEST_WINDOW } from './pass-fields.js';
import { buildEvent } from './proxy-event.js';
import { createSeededRandom } from './seeded-random.js';

export const BASE_ENV: Record<string, string> = {
  TABLE_NAME: 'compass-test',
  APP_SECRET_ID: 'compass/test/app',
  ORIGIN_VERIFY_SECRET_ID: 'compass/test/origin-verify',
  APPLE_SECRET_ID: 'compass/test/apple-pass',
  GOOGLE_SECRET_ID: 'compass/test/google-wallet',
  GOOGLE_WALLET_CLASS_SUFFIX: 'compass-test',
  PUBLIC_BASE_URL: 'https://d111111abcdef8.cloudfront.net',
  EVENT_TIMEZONE: TEST_WINDOW.timezone,
  EVENT_WINDOW_START: TEST_WINDOW.start,
  EVENT_WINDOW_END: TEST_WINDOW.end,
  ID_TOKEN_ISSUER: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_AbC123xyz',
  SERVICE_VERSION: '1.2.3',
};

export interface FakeApns extends ApnsClient {
  calls: PushTarget[][];
  /** Replaces the default (everything delivered). */
  reply: (targets: PushTarget[]) => PushOutcome;
}

export interface FakeGoogle extends GoogleWalletClient {
  inserts: GenericObject[];
  patches: { objectId: string; body: Partial<GenericObject> }[];
  insertResult: (obj: GenericObject) => GoogleResult;
  patchResult: (objectId: string) => GoogleResult;
  saveUrls: { objects: { id: string; classId: string }[]; nowSeconds: number }[];
  oversize: boolean;
}

/** The metrics of the last logged request. */
export function lastLog(capture: Capture): Record<string, unknown> {
  return JSON.parse(String(capture.lines[capture.lines.length - 1])) as Record<string, unknown>;
}

export interface ApiFixture {
  deps: ApiDeps;
  app: (event: ReturnType<typeof buildEvent>) => Promise<ProxyResult>;
  table: MemoryTable;
  clock: FakeClock;
  secrets: FakeSecrets;
  apns: FakeApns;
  google: FakeGoogle;
  capture: Capture;
  config: ApiConfig;
  /** Sends a request through the whole app with the right origin header. */
  call: (request: CallOptions) => Promise<Reply>;
  /** Issues one pass as `sub` and returns its serial number. */
  issue: (sub: string, fields?: PassFields, platforms?: ('apple' | 'google')[]) => Promise<string>;
}

export interface CallOptions {
  method: string;
  resource: string;
  token?: string;
  body?: unknown;
  path?: Record<string, string>;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  origin?: string | null;
}

export interface Reply {
  result: ProxyResult;
  json: unknown;
}

export interface FixtureOptions {
  env?: Record<string, string | undefined>;
  secrets?: FakeSecretsInit;
  /** Runs before every table operation (to count or to interleave). */
  interleave?: () => Promise<void>;
  signer?: (secrets: FakeSecrets) => PassSigner;
}

export function createApiFixture(options: FixtureOptions = {}): ApiFixture {
  const env = { ...BASE_ENV, ...options.env };
  const config = parseApiConfig(env);
  const table = createMemoryTable(
    options.interleave === undefined ? {} : { interleave: options.interleave },
  );
  const clock = createFakeClock(Date.parse('2026-11-29T00:00:00Z'));
  const secrets = createFakeSecrets(options.secrets);
  const capture = createCapture();

  const apns: FakeApns = {
    calls: [],
    reply: (targets) => ({ delivered: targets.length, invalid: [], failed: 0, skipped: false }),
    push(targets) {
      apns.calls.push(targets);
      return Promise.resolve(apns.reply(targets));
    },
  };
  const google: FakeGoogle = {
    inserts: [],
    patches: [],
    saveUrls: [],
    oversize: false,
    insertResult: () => 'ok',
    patchResult: () => 'ok',
    insert(obj) {
      google.inserts.push(obj);
      return Promise.resolve(google.insertResult(obj));
    },
    patch(objectId, body) {
      google.patches.push({ objectId, body });
      return Promise.resolve(google.patchResult(objectId));
    },
    saveUrl(objects, nowSeconds) {
      google.saveUrls.push({ objects, nowSeconds });
      return Promise.resolve({
        url: `https://pay.google.com/gp/v/save/fake-${objects.length}`,
        oversize: google.oversize,
      });
    },
  };
  const signer: PassSigner = options.signer?.(secrets) ?? {
    signPass: (input) =>
      Promise.resolve(
        Buffer.from(JSON.stringify({ serial: input.serialNumber, status: input.status })),
      ),
    signBundle: (inputs) =>
      Promise.resolve(
        Buffer.from(JSON.stringify({ bundle: inputs.map((input) => input.serialNumber) })),
      ),
  };
  const deps: ApiDeps = {
    clock,
    random: createSeededRandom('fixture'),
    secrets,
    logSink: capture.sink,
    console: capture.console,
    config,
    verifier: {
      verify: (header) => {
        if (header === undefined || !header.startsWith('Bearer ')) {
          return Promise.reject(new ProblemError(401, 'unauthorized'));
        }
        return Promise.resolve({ subHash: header.slice('Bearer '.length) });
      },
    },
    limiter: createRateLimiter(table),
    table,
    passes: createPassRepository(table),
    registrations: createRegistrationRepository(table),
    handoffs: createHandoffRepository(table),
    signer,
    apns,
    google,
  };
  const app = createApiApp(deps);

  const call: ApiFixture['call'] = async (request) => {
    const event = buildEvent({
      method: request.method,
      resource: request.resource,
      origin:
        request.origin === null ? undefined : (request.origin ?? secrets.originSecret.originVerify),
      headers: {
        ...(request.token === undefined ? {} : { authorization: `Bearer ${request.token}` }),
        ...request.headers,
      },
      pathParameters: request.path,
      query: request.query,
      body: request.body,
    });
    const result = await app(event);
    let parsed: unknown;
    try {
      parsed = result.isBase64Encoded || result.body === '' ? undefined : JSON.parse(result.body);
    } catch {
      parsed = undefined;
    }
    return { result, json: parsed };
  };

  return {
    deps,
    app,
    table,
    clock,
    secrets,
    apns,
    google,
    capture,
    config,
    call,
    async issue(sub, fields = samplePassFields(), platforms = ['apple']) {
      const reply = await call({
        method: 'POST',
        resource: '/api/v1/passes',
        token: sub,
        body: { platforms, passes: [fields] },
      });
      if (reply.result.statusCode !== 201) {
        throw new Error(`issue failed with ${reply.result.statusCode}`);
      }
      return (reply.json as { passes: { serialNumber: string }[] }).passes[0]!.serialNumber;
    },
  };
}
