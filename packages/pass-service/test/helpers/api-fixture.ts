// An Api_Lambda wired to in-memory fakes: the memory table, a fake clock and seeded random, a
// stub token verifier (the bearer token is the SubHash), recording APNs and Google fakes, and
// a fake signer. Used by the handler, lifecycle, hand-off and contract tests.
import type { PassFields } from '@compass/contracts';
import type { ApnsClient, PushOutcome, PushTarget } from '../../src/apns/apns-client.js';
import type { TokenVerifier } from '../../src/auth/token-verifier.js';
import type { PassSigner } from '../../src/apple/pass-signer.js';
import { createApiApp } from '../../src/app/api-app.js';
import { createPasskitApp } from '../../src/app/passkit-app.js';
import type { ApiDeps } from '../../src/app/deps.js';
import { parseApiConfig, parsePasskitConfig, type ApiConfig } from '../../src/config/config.js';
import { deriveAuthToken } from '../../src/security/auth-token.js';
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
  /** How many objects one link holds (everything in one link by default). */
  perLink: number;
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
  /** Sends a request to the PassKit Lambda with the right origin header. */
  callPasskit: (request: CallOptions) => Promise<Reply>;
  /** The Auth_Token of a stored pass, re-derived the way the service does. */
  authToken: (serial: string) => Promise<string>;
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
  /** Replaces the stub verifier (the bearer is the SubHash) with a real one. */
  verifier?: (parts: {
    config: ApiConfig;
    secrets: FakeSecrets;
    clock: FakeClock;
  }) => TokenVerifier;
  /** Adjusts the dependencies before the apps are built (to inject failures). */
  tweak?: (deps: ApiDeps) => void;
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
    perLink: Number.POSITIVE_INFINITY,
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
    saveLinks(objects, nowSeconds) {
      google.saveUrls.push({ objects, nowSeconds });
      const links: { url: string; oversize: boolean; count: number }[] = [];
      for (let from = 0; from < objects.length; from += google.perLink) {
        const count = Math.min(google.perLink, objects.length - from);
        links.push({
          url: `https://pay.google.com/gp/v/save/fake-${from}-${count}-${objects[from]!.id.split('.')[1]}`,
          oversize: google.oversize,
          count,
        });
      }
      return Promise.resolve(links);
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
    verifier: options.verifier?.({ config, secrets, clock }) ?? {
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
  options.tweak?.(deps);
  const app = createApiApp(deps);
  const passkitApp = createPasskitApp({
    clock,
    random: deps.random,
    secrets,
    logSink: capture.sink,
    console: capture.console,
    config: parsePasskitConfig(env),
    passes: deps.passes,
    registrations: deps.registrations,
    signer,
  });

  const send = async (run: typeof app, request: CallOptions): Promise<Reply> => {
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
    const result = await run(event);
    let parsed: unknown;
    try {
      parsed = result.isBase64Encoded || result.body === '' ? undefined : JSON.parse(result.body);
    } catch {
      parsed = undefined;
    }
    return { result, json: parsed };
  };

  const call: ApiFixture['call'] = (request) => send(app, request);
  const callPasskit: ApiFixture['callPasskit'] = (request) => send(passkitApp, request);

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
    callPasskit,
    async authToken(serial) {
      const rec = await deps.passes.get(serial, clock.now());
      return deriveAuthToken(secrets.appSecret.pepper, serial, String(rec?.tokenSalt));
    },
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
