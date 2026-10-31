// The owner-run local harness (Requirement 24.7): both Lambdas on node:http, an in-memory table,
// and the owner's own certificate and key files named by path. It exists for the SP3 and SP4
// spikes (a real iPhone and a real Android phone on the LAN), where Apple allows an HTTP web
// service while testing.
//
// It prints only "listening" and Request_Logger lines, never file contents, tokens or
// identifiers. Sign-in is a stub: the bearer text typed on the page stands in for a Builder ID
// ID token, so the harness never sees a real token.
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApnsClient } from '../apns/apns-client.js';
import { createHttp2Connector } from '../apns/http2-connector.js';
import { createPassSigner } from '../apple/pass-signer.js';
import { createApiApp, API_ROUTE_KEYS } from '../app/api-app.js';
import type { ApiDeps, PasskitDeps } from '../app/deps.js';
import { createPasskitApp, PASSKIT_ROUTE_KEYS } from '../app/passkit-app.js';
import { parseApiConfig, parsePasskitConfig } from '../config/config.js';
import { createHandoffRepository } from '../data/handoff-repository.js';
import { createPassRepository } from '../data/pass-repository.js';
import { createRateLimiter } from '../data/rate-limiter.js';
import { createRegistrationRepository } from '../data/registration-repository.js';
import { buildGenericObject } from '../google/google-object.js';
import { createGoogleWalletClient } from '../google/google-wallet-client.js';
import { createGoogleTokenSource } from '../google/token-source.js';
import type { ProxyEvent, ProxyResult } from '../http/event.js';
import { ProblemError } from '../http/problem.js';
import { constantTimeEqualHex, subHash } from '../security/hashing.js';
import { createSecretsProvider, type SecretSource } from '../credentials/secrets-provider.js';
import { systemClock, systemRandom } from '../seams.js';
import { createMemoryTable } from './memory-table.js';

export interface HarnessSecrets {
  signerCertFile: string;
  signerKeyFile: string;
  wwdrFile: string;
  signerKeyPassphrase?: string;
  /** Account specific, supplied by the owner at run time. */
  passTypeIdentifier: string;
  teamIdentifier: string;
  /** Needed only for the Google spike. */
  googleKeyFile?: string;
  googleIssuerId?: string;
}

export interface HarnessOptions {
  port: number;
  host: string;
  /** The Compass environment variables (the same names the Lambdas use). */
  env: Record<string, string>;
  secrets: HarnessSecrets;
  /** Receives "listening" and Request_Logger lines. Defaults to stdout. */
  log?: (line: string) => void;
  /** APNs and Google are off unless asked for (review N2). */
  enable?: { apns?: boolean; google?: boolean };
  /** Test seams: replace the real APNs and Google clients. */
  overrides?: Partial<Pick<ApiDeps, 'apns' | 'google'>>;
}

export interface HarnessHandle {
  port: number;
  /** Set only when the harness listens beyond loopback: required on every request. */
  accessToken: string | undefined;
  close(): Promise<void>;
}

interface RouteMatcher {
  method: string;
  resource: string;
  pattern: RegExp;
  passkit: boolean;
}

function matchers(): RouteMatcher[] {
  const all = [
    ...API_ROUTE_KEYS.map((key) => ({ key, passkit: false })),
    ...PASSKIT_ROUTE_KEYS.map((key) => ({ key, passkit: true })),
  ];
  return all.map(({ key, passkit }) => {
    const [method, resource] = key.split(' ') as [string, string];
    const source = resource
      .replace(/[.*+?^$()|[\]\\]/g, '\\$&')
      .replace(/\{(\w+)\}/g, '(?<$1>[^/]+)');
    return { method, resource, pattern: new RegExp(`^${source}$`), passkit };
  });
}

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Compass local harness</title></head>
<body style="font-family:system-ui;max-width:42rem;margin:1rem auto;padding:0 1rem">
<h1>Compass local harness</h1>
<p>Owner-run test page for made-up sessions. Not the product.</p>
<p><label>Stand-in sign-in text <input id="who" value="harness"></label></p>
<p><button id="issue">Issue a pass</button> <button id="update">Update the room</button>
<button id="void">Void</button> <button id="handoff">Create hand-off</button>
<button id="repeat">Repeat Google insert</button></p>
<pre id="out"></pre><div id="links"></div>
<script>
const out = document.getElementById('out');
let serial = '';
const hdr = () => ({ authorization: 'Bearer ' + document.getElementById('who').value, 'content-type': 'application/json' });
const session = (room) => ({ sessionCode: 'TEST101', title: 'Made up session', venue: 'Made Up Hall', room,
  startsAt: new Date(Date.now() + 3600e3).toISOString(), endsAt: new Date(Date.now() + 7200e3).toISOString() });
async function call(path, init) { const r = await fetch(path, init); const t = await r.text();
  out.textContent = r.status + ' ' + t.slice(0, 400); return t ? JSON.parse(t) : {}; }
document.getElementById('issue').onclick = async () => { const j = await call('/api/v1/passes', { method: 'POST', headers: hdr(),
  body: JSON.stringify({ platforms: ['apple', 'google'], passes: [session('Room 1')] }) }); serial = j.passes ? j.passes[0].serialNumber : serial; };
document.getElementById('update').onclick = () => call('/api/v1/passes/' + serial, { method: 'PUT', headers: hdr(), body: JSON.stringify(session('Room ' + Math.ceil(Math.random() * 90))) });
document.getElementById('void').onclick = () => call('/api/v1/passes/' + serial + '/void', { method: 'POST', headers: hdr() });
document.getElementById('handoff').onclick = async () => { const j = await call('/api/v1/handoffs', { method: 'POST', headers: hdr(),
  body: JSON.stringify({ serialNumbers: [serial], include: { apple: true, google: true, calendar: true } }) });
  const v = await call('/api/v1/handoffs/' + j.handoffId, {}); const links = document.getElementById('links'); links.textContent = '';
  for (const p of v.apple.bundlePaths) { const a = document.createElement('a'); a.href = p; a.textContent = 'Add to Apple Wallet'; links.append(a, ' '); }
  if (v.google) { const a = document.createElement('a'); a.href = v.google.saveUrl; a.textContent = 'Save to Google Wallet'; links.append(a, ' '); }
  if (v.calendarPath) { const a = document.createElement('a'); a.href = v.calendarPath; a.textContent = 'Calendar'; links.append(a); } };
document.getElementById('repeat').onclick = () => call('/harness/repeat-insert/' + serial, { method: 'POST', headers: hdr() });
</script></body></html>`;

function fileSecretSource(opts: HarnessSecrets, ids: string[]): SecretSource {
  const [appId, originId, appleId] = ids;
  const pepper = randomBytes(32).toString('base64url');
  const originVerify = randomBytes(32).toString('base64url');
  return {
    get(secretId) {
      if (secretId === appId) {
        return Promise.resolve(JSON.stringify({ pepper, pepperId: 'harness' }));
      }
      if (secretId === originId) {
        return Promise.resolve(JSON.stringify({ originVerify }));
      }
      if (secretId === appleId) {
        return Promise.resolve(
          JSON.stringify({
            passTypeIdentifier: opts.passTypeIdentifier,
            teamIdentifier: opts.teamIdentifier,
            signerCertPem: readFileSync(opts.signerCertFile, 'utf8'),
            signerKeyPem: readFileSync(opts.signerKeyFile, 'utf8'),
            signerKeyPassphrase: opts.signerKeyPassphrase ?? '',
            wwdrPem: readFileSync(opts.wwdrFile, 'utf8'),
          }),
        );
      }
      // The google-wallet secret: the service account key file and the issuer id.
      return Promise.resolve(
        JSON.stringify({
          issuerId: opts.googleIssuerId,
          serviceAccount: JSON.parse(readFileSync(String(opts.googleKeyFile), 'utf8')) as unknown,
        }),
      );
    },
  };
}

async function readBody(request: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return chunks.length === 0 ? null : Buffer.concat(chunks).toString('utf8');
}

const HARNESS_COOKIE = 'harness_token';

/** The harness is for one owner on one machine: only a loopback bind needs no access token. */
export function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '::1' || host.startsWith('127.');
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  return (header ?? '')
    .split(';')
    .map((part) => part.trim().split('='))
    .find(([key]) => key === name)?.[1];
}

function sameText(given: string | string[] | undefined, expected: string): boolean {
  return typeof given === 'string' && constantTimeEqualHex(given, expected);
}

function send(
  response: ServerResponse,
  result: ProxyResult,
  extraHeaders: Record<string, string> = {},
): void {
  response.writeHead(result.statusCode, { ...result.headers, ...extraHeaders });
  response.end(result.isBase64Encoded ? Buffer.from(result.body, 'base64') : result.body);
}

export async function startLocalHarness(options: HarnessOptions): Promise<HarnessHandle> {
  const log = options.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const accessToken = isLoopbackHost(options.host)
    ? undefined
    : randomBytes(24).toString('base64url');
  const env: Record<string, string> = {
    ...options.env,
    APNS_ENABLED: options.enable?.apns === true ? 'true' : 'false',
    GOOGLE_WALLET_ENABLED: options.enable?.google === true ? 'true' : 'false',
    // Apple's device sends no token of its own, so beyond loopback the pass carries it in the path.
    ...(accessToken === undefined
      ? {}
      : { PASSKIT_WEB_SERVICE_PATH: `/api/passkit/${accessToken}` }),
  };
  const parseOptions = { allowHttpBaseUrl: true, allowAnyApnsHost: true };
  const config = parseApiConfig(env, parseOptions);
  const passkitConfig = parsePasskitConfig(env, parseOptions);
  const table = createMemoryTable();
  const source = fileSecretSource(options.secrets, [
    config.appSecretId,
    config.originVerifySecretId,
    config.appleSecretId,
  ]);
  const secrets = createSecretsProvider(
    source,
    {
      app: config.appSecretId,
      origin: config.originVerifySecretId,
      apple: config.appleSecretId,
      google: config.googleSecretId,
    },
    config.secretsCacheSeconds,
    systemClock,
  );
  const origin = (await secrets.origin()).originVerify;
  const pepper = (await secrets.app()).pepper;
  const passes = createPassRepository(table);
  const registrations = createRegistrationRepository(table);
  const signer = createPassSigner(secrets);
  const google =
    options.overrides?.google ??
    createGoogleWalletClient({ http: fetch, tokens: createGoogleTokenSource(secrets), secrets });
  const base = {
    clock: systemClock,
    random: systemRandom,
    secrets,
    logSink: log,
    console: globalThis.console,
  };
  const apiDeps: ApiDeps = {
    ...base,
    config,
    // A stand-in for sign-in: the bearer text is the identity. Never a real token.
    verifier: {
      verify: (header) =>
        header === undefined
          ? Promise.reject(new ProblemError(401, 'unauthorized'))
          : Promise.resolve({ subHash: subHash(pepper, header.replace(/^Bearer /, '')) }),
    },
    limiter: createRateLimiter(table),
    table,
    passes,
    registrations,
    handoffs: createHandoffRepository(table),
    signer,
    apns:
      options.overrides?.apns ??
      createApnsClient(config.apns, { connector: createHttp2Connector(), secrets }),
    google,
  };
  const passkitDeps: PasskitDeps = {
    ...base,
    config: passkitConfig,
    passes,
    registrations,
    signer,
  };
  const apiApp = createApiApp(apiDeps);
  const passkitApp = createPasskitApp(passkitDeps);
  const routes = matchers();

  async function repeatInsert(serial: string): Promise<ProxyResult> {
    const rec = await passes.get(serial, Date.now());
    const classSuffix = config.google.enabled ? config.google.classSuffix : '';
    if (rec === undefined || !config.google.enabled) {
      return { statusCode: 404, headers: {}, body: '', isBase64Encoded: false };
    }
    const issuer = (await secrets.google()).issuerId;
    const object = buildGenericObject(
      {
        serialNumber: serial,
        fields: rec.fields,
        state: 'ACTIVE',
        timezone: config.eventWindow.timezone,
      },
      { issuerId: issuer, classSuffix, publicBaseUrl: config.publicBaseUrl },
    );
    const first = await google.insert(object);
    const second = await google.insert(object);
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ first, second }),
      isBase64Encoded: false,
    };
  }

  const server: Server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url!, 'http://harness.local');
      const method = request.method!;
      let pathname = url.pathname;
      let setCookie: Record<string, string> = {};
      if (accessToken !== undefined) {
        const given = [
          request.headers['x-harness-token'],
          cookieValue(request.headers.cookie, HARNESS_COOKIE),
          url.searchParams.get('harness_token') ?? undefined,
        ];
        const inPath = /^\/api\/passkit\/([^/]+)(\/.*)$/.exec(pathname);
        const viaPath = inPath !== null && sameText(inPath[1], accessToken);
        if (viaPath) {
          pathname = `/api/passkit${inPath[2]}`;
        } else if (given.some((value) => sameText(value, accessToken))) {
          setCookie = {
            'set-cookie': `${HARNESS_COOKIE}=${accessToken}; HttpOnly; SameSite=Strict; Path=/`,
          };
        } else {
          send(response, { statusCode: 401, headers: {}, body: '', isBase64Encoded: false });
          return;
        }
      }
      if (method === 'GET' && pathname === '/') {
        send(
          response,
          {
            statusCode: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
            body: PAGE,
            isBase64Encoded: false,
          },
          setCookie,
        );
        return;
      }
      const repeat = /^\/harness\/repeat-insert\/([0-9a-f-]{36})$/.exec(pathname);
      if (method === 'POST' && repeat !== null) {
        send(response, await repeatInsert(String(repeat[1])));
        return;
      }
      for (const route of routes) {
        const match = route.method === method ? route.pattern.exec(pathname) : null;
        if (match !== null) {
          const headers: Record<string, string> = { 'x-origin-verify': origin };
          for (let i = 0; i + 1 < request.rawHeaders.length; i += 2) {
            headers[String(request.rawHeaders[i]).toLowerCase()] = String(
              request.rawHeaders[i + 1],
            );
          }
          headers['x-origin-verify'] = origin;
          const event: ProxyEvent = {
            resource: route.resource,
            httpMethod: method,
            headers,
            pathParameters: Object.fromEntries(
              Object.entries(match.groups ?? {}).map(([k, v]) => [k, decodeURIComponent(v)]),
            ),
            queryStringParameters: Object.fromEntries(url.searchParams),
            body: await readBody(request),
            isBase64Encoded: false,
            requestContext: { requestId: randomUUID() },
          };
          send(response, await (route.passkit ? passkitApp : apiApp)(event), setCookie);
          return;
        }
      }
      send(response, { statusCode: 404, headers: {}, body: '', isBase64Encoded: false });
    })().catch(() => {
      send(response, { statusCode: 500, headers: {}, body: '', isBase64Encoded: false });
    });
  });
  await new Promise<void>((resolve) => server.listen(options.port, options.host, resolve));
  log('listening');
  if (accessToken !== undefined) {
    log(
      `WARNING: listening on ${options.host}, which is not loopback. Anyone on this network who has the access token can issue and void passes here.`,
    );
    log(`Access token for this run (shown once): ${accessToken}`);
    log(
      'Open the page once with ?harness_token=<token> added to the address; it is then kept in a cookie.',
    );
  }
  return {
    accessToken,
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
