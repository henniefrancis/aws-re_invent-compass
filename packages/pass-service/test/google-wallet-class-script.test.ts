import { generateKeyPairSync } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  DESIRED_CLASS_FIELDS,
  defaultDeps,
  firstDifference,
  main,
  matchesDesired,
  parseArgs,
  runCli,
  runIfDirect,
  signJwt,
  type Deps,
  type FetchInit,
  type FetchResponse,
} from '../../../scripts/google-wallet-class.mjs';

// Unit tests for the owner-run Google Wallet class script. Every network, file, clock and
// output call is a fake: no test reaches Google, AWS or a real key file. The service
// account key below is generated in the test and is worth nothing.

const ISSUER = '3388000000012345';
const CLASS_ID = `${ISSUER}.compass-dev`;
const NOW_MS = 1_700_000_000_000;
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEY_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const ACCOUNT_JSON = JSON.stringify({ client_email: 'svc@example.test', private_key: KEY_PEM });
const ARGV = ['--service-account', 'key.json', '--issuer-id', ISSUER];

function reply(status: number, body?: unknown): FetchResponse {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

interface Call {
  url: string;
  init: FetchInit;
}

interface Harness {
  deps: Deps;
  calls: Call[];
  out: string[];
  err: string[];
}

type Route = FetchResponse | (() => FetchResponse);

// A fake Deps. `routes` maps "METHOD path" to a response (or a function making one).
function harness(routes: Record<string, Route>, file: string | Error = ACCOUNT_JSON): Harness {
  const calls: Call[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const deps: Deps = {
    fetch: (url, init) => {
      calls.push({ url, init });
      const key = `${init.method ?? 'GET'} ${url.replace(/^https:\/\/[^/]+/, '')}`;
      const route = routes[key];
      if (route === undefined) return Promise.reject(new Error(`no route for ${key}`));
      return Promise.resolve(typeof route === 'function' ? route() : route);
    },
    readFile: () => {
      if (file instanceof Error) throw file;
      return file;
    },
    now: () => NOW_MS,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    env: {},
  };
  return { deps, calls, out, err };
}

const TOKEN = 'POST /token';
const ISSUER_GET = `GET /walletobjects/v1/issuer/${ISSUER}`;
const ISSUER_POST = 'POST /walletobjects/v1/issuer';
const CLASS_URL = `/walletobjects/v1/genericClass/${encodeURIComponent(CLASS_ID)}`;
const CLASS_GET = `GET ${CLASS_URL}`;
const CLASS_POST = 'POST /walletobjects/v1/genericClass';
const CLASS_PATCH = `PATCH ${CLASS_URL}`;
const goodToken = reply(200, { access_token: 'tok-1' });

// What Google returns for a class that already matches: the enum in lowerCamelCase.
function matchingClass(): Record<string, unknown> {
  return {
    id: CLASS_ID,
    ...structuredClone(DESIRED_CLASS_FIELDS),
    viewUnlockRequirement: 'unlockNotRequired',
    extraKeyFromGoogle: true,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('firstDifference and matchesDesired', () => {
  test('a class that carries the desired value matches, extra keys allowed', () => {
    expect(firstDifference(DESIRED_CLASS_FIELDS, matchingClass())).toBeNull();
    expect(matchesDesired(DESIRED_CLASS_FIELDS, matchingClass())).toBe(true);
    expect(matchesDesired(DESIRED_CLASS_FIELDS, {})).toBe(false);
  });

  test('Google default for the unlock setting counts as the same setting', () => {
    const current = {
      ...matchingClass(),
      viewUnlockRequirement: 'VIEW_UNLOCK_REQUIREMENT_UNSPECIFIED',
    };
    expect(firstDifference(DESIRED_CLASS_FIELDS, current)).toBeNull();
  });

  test('a different enum value is reported by name', () => {
    const current = { ...matchingClass(), viewUnlockRequirement: 'UNLOCK_REQUIRED_TO_VIEW' };
    expect(firstDifference(DESIRED_CLASS_FIELDS, current)).toEqual({
      path: 'viewUnlockRequirement',
      found: '"UNLOCK_REQUIRED_TO_VIEW"',
    });
  });

  test('a missing key, a null, a list, an object and scalars are described by kind only', () => {
    expect(firstDifference({ a: 1 }, {})).toEqual({ path: 'a', found: 'missing' });
    expect(firstDifference({ a: 1 }, { a: null })).toEqual({ path: 'a', found: 'null' });
    expect(firstDifference({ a: 1 }, { a: 'secret value' })).toEqual({
      path: 'a',
      found: 'a string',
    });
    expect(firstDifference({ a: 1 }, { a: 2 })).toEqual({ path: 'a', found: 'a number' });
    expect(firstDifference({ a: 1 }, { a: {} })).toEqual({ path: 'a', found: 'an object' });
    expect(firstDifference({ a: 1 }, { a: [1, 2] })).toEqual({ path: 'a', found: 'a list of 2' });
  });

  test('an enum-looking string and a field path are shown, cut to 64 characters', () => {
    expect(firstDifference({ a: 'X' }, { a: 'SOME_ENUM' })).toEqual({
      path: 'a',
      found: '"SOME_ENUM"',
    });
    const found = firstDifference(
      { t: { fieldPath: 'x' } },
      { t: { fieldPath: 'p'.repeat(100) } },
    )?.found;
    expect(found).toBe(JSON.stringify('p'.repeat(64)));
  });

  test('a desired object against a non-object, a null or an array differs at that place', () => {
    expect(firstDifference({ a: { b: 1 } }, { a: 'x' })?.path).toBe('a');
    expect(firstDifference({ a: { b: 1 } }, { a: null })?.found).toBe('null');
    expect(firstDifference({ a: { b: 1 } }, { a: [] })?.found).toBe('a list of 0');
  });

  test('lists compare item by item and by length, with an indexed path', () => {
    expect(firstDifference({ l: [1, 2] }, { l: [1, 2] })).toBeNull();
    expect(firstDifference({ l: [1, 2] }, { l: [1] })).toEqual({ path: 'l', found: 'a list of 1' });
    expect(firstDifference({ l: [1, 2] }, { l: 'no' })).toEqual({ path: 'l', found: 'a string' });
    expect(firstDifference({ l: [{ k: 1 }, { k: 2 }] }, { l: [{ k: 1 }, { k: 3 }] })).toEqual({
      path: 'l[1].k',
      found: 'a number',
    });
  });

  test('a difference at the top level is named "(the class)"', () => {
    expect(firstDifference('a', 'b')).toEqual({ path: '(the class)', found: 'a string' });
    expect(firstDifference({ a: 1 }, 'x')?.path).toBe('(the class)');
    expect(firstDifference([1], 'x')?.path).toBe('(the class)');
    expect(firstDifference([1], [1])).toBeNull();
    expect(firstDifference(undefined, undefined)).toBeNull();
  });

  test('a non-string value never matches an enum setting', () => {
    const difference = firstDifference(
      { viewUnlockRequirement: 'UNLOCK_NOT_REQUIRED' },
      { viewUnlockRequirement: 5 },
    );
    expect(difference).not.toBeNull();
  });
});

describe('parseArgs', () => {
  test('applies defaults', () => {
    expect(parseArgs(ARGV, {})).toEqual({
      serviceAccountPath: 'key.json',
      issuerId: ISSUER,
      suffix: 'compass-dev',
      issuerName: 'Compass',
    });
  });

  test('reads the process environment when none is given', () => {
    vi.stubEnv('GOOGLE_WALLET_CLASS_SUFFIX', 'from-process-env');
    expect(parseArgs(ARGV).suffix).toBe('from-process-env');
  });

  test('suffix precedence is flag, then environment, then compass-<env>', () => {
    const env = { GOOGLE_WALLET_CLASS_SUFFIX: 'from-env' };
    expect(parseArgs([...ARGV, '--suffix', 'flag'], env).suffix).toBe('flag');
    expect(parseArgs(ARGV, env).suffix).toBe('from-env');
    expect(parseArgs([...ARGV, '--env', 'prod'], {}).suffix).toBe('compass-prod');
  });

  test('takes the issuer name flag', () => {
    expect(parseArgs([...ARGV, '--issuer-name', 'Acme'], {}).issuerName).toBe('Acme');
  });

  test.each([
    ['a value without a flag', ['key.json', '--issuer-id', '1']],
    ['a flag without a value', ['--service-account']],
    ['a flag whose value is another flag', ['--service-account', '--issuer-id', '1']],
    ['an unknown flag', [...ARGV, '--other', 'x']],
    ['a missing service account', ['--issuer-id', '1']],
    ['a missing issuer id', ['--service-account', 'k']],
    ['a non numeric issuer id', ['--service-account', 'k', '--issuer-id', 'abc']],
    ['an unknown env', [...ARGV, '--env', 'qa']],
    ['a bad suffix', [...ARGV, '--suffix', 'bad suffix']],
  ])('rejects %s', (_name, argv) => {
    expect(() => parseArgs(argv, {})).toThrow();
  });
});

describe('signJwt', () => {
  test('produces three base64url parts with an RS256 header', () => {
    const jwt = signJwt({ iss: 'issuer' }, KEY_PEM);
    const [header, payload, signature] = jwt.split('.');
    expect(JSON.parse(Buffer.from(header ?? '', 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    });
    expect(JSON.parse(Buffer.from(payload ?? '', 'base64url').toString())).toEqual({
      iss: 'issuer',
    });
    expect(signature).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('runCli success paths', () => {
  test('creates the issuer and the class when both are missing', async () => {
    const h = harness({
      [TOKEN]: goodToken,
      [ISSUER_GET]: reply(404),
      [ISSUER_POST]: reply(200),
      [CLASS_GET]: reply(404),
      [CLASS_POST]: reply(200),
    });
    expect(await runCli(ARGV, h.deps)).toBe(0);
    expect(h.out).toEqual(['issuer: created\n', 'class: created\n']);
    expect(h.err).toEqual([]);

    const [tokenCall, , issuerPost, , classPost] = h.calls;
    // The assertion is signed with the injected clock.
    const assertion = (tokenCall?.init.body as URLSearchParams).get('assertion') ?? '';
    const claims: unknown = JSON.parse(
      Buffer.from(assertion.split('.')[1] ?? '', 'base64url').toString(),
    );
    expect(claims).toMatchObject({
      iss: 'svc@example.test',
      iat: 1_700_000_000,
      exp: 1_700_003_000,
    });
    expect(JSON.parse(issuerPost?.init.body as string)).toEqual({
      issuerId: ISSUER,
      name: 'Compass',
    });
    expect(JSON.parse(classPost?.init.body as string)).toMatchObject({ id: CLASS_ID });
    // Bearer token on the Wallet calls, no body on a GET, and a timeout on every call.
    expect(h.calls[1]?.init.headers?.authorization).toBe('Bearer tok-1');
    expect(h.calls[1]?.init.body).toBeUndefined();
    expect(h.calls.every((c) => c.init.signal instanceof AbortSignal)).toBe(true);
  });

  test('leaves an existing issuer and a matching class unchanged', async () => {
    const h = harness({
      [TOKEN]: goodToken,
      [ISSUER_GET]: reply(200, {}),
      [CLASS_GET]: reply(200, matchingClass()),
    });
    expect(await runCli(ARGV, h.deps)).toBe(0);
    expect(h.out).toEqual(['issuer: exists, left unchanged\n', 'class: exists, left unchanged\n']);
    expect(h.calls.map((c) => c.init.method)).toEqual(['POST', 'GET', 'GET']);
  });

  test('patches a class that differs and names where, without printing the response', async () => {
    const h = harness({
      [TOKEN]: goodToken,
      [ISSUER_GET]: reply(200, {}),
      [CLASS_GET]: reply(200, {
        id: CLASS_ID,
        viewUnlockRequirement: 'unlockNotRequired',
        textModulesData: 'sensitive-looking-value',
      }),
      [CLASS_PATCH]: reply(200),
    });
    expect(await runCli([...ARGV, '--suffix', 'compass-dev'], h.deps)).toBe(0);
    expect(h.out[1]).toBe('class: differs at textModulesData (found a string)\n');
    expect(h.out[2]).toBe('class: updated\n');

    expect(h.calls[3]?.init.method).toBe('PATCH');
  });

  test('takes the suffix and issuer name from the flags', async () => {
    const h = harness({
      [TOKEN]: goodToken,
      [ISSUER_GET]: reply(404),
      [ISSUER_POST]: reply(200),
      [`GET /walletobjects/v1/genericClass/${ISSUER}.mine`]: reply(404),
      [CLASS_POST]: reply(200),
    });
    const argv = [...ARGV, '--suffix', 'mine', '--issuer-name', 'Acme'];
    expect(await runCli(argv, h.deps)).toBe(0);
    expect(JSON.parse(h.calls[2]?.init.body as string)).toEqual({
      issuerId: ISSUER,
      name: 'Acme',
    });
  });
});

describe('runCli failures', () => {
  test('bad usage exits 2 and prints the usage line', async () => {
    const h = harness({});
    expect(await runCli(['--issuer-id', '1'], h.deps)).toBe(2);
    expect(h.err[0]).toBe('error: missing arguments\n');
    expect(h.err[1]).toMatch(/^usage: node scripts\/google-wallet-class\.mjs /);
    expect(h.calls).toEqual([]);
  });

  test.each([
    ['an unreadable key file', new Error('EACCES'), 'error: cannot read file: key.json\n'],
    ['a key file that is not JSON', 'not json', 'error: not valid JSON: key.json\n'],
    [
      'JSON that is not a service account key',
      '{}',
      'error: not a service account key: key.json\n',
    ],
    [
      'a key without a private key',
      JSON.stringify({ client_email: 'a@b.test' }),
      'error: not a service account key: key.json\n',
    ],
  ])('%s exits 2', async (_name, file, message) => {
    const h = harness({}, file);
    expect(await runCli(ARGV, h.deps)).toBe(2);
    expect(h.err[0]).toBe(message);
    expect(h.calls).toEqual([]);
  });

  const unreadable: Route = () => ({
    ok: true,
    status: 200,
    json: () => Promise.reject(new SyntaxError('bad')),
  });

  test.each<[string, Record<string, Route>, string]>([
    ['the token request failing', { [TOKEN]: reply(401) }, 'token request failed with HTTP 401'],
    [
      'a token response without a token',
      { [TOKEN]: reply(200, {}) },
      'token response had no access token',
    ],
    [
      'reading the issuer failing',
      { [TOKEN]: goodToken, [ISSUER_GET]: reply(500) },
      'reading the issuer failed with HTTP 500',
    ],
    [
      'creating the issuer failing',
      { [TOKEN]: goodToken, [ISSUER_GET]: reply(404), [ISSUER_POST]: reply(403) },
      'creating the issuer failed with HTTP 403',
    ],
    [
      'reading the class failing',
      { [TOKEN]: goodToken, [ISSUER_GET]: reply(200), [CLASS_GET]: reply(503) },
      'reading the class failed with HTTP 503',
    ],
    [
      'creating the class failing',
      {
        [TOKEN]: goodToken,
        [ISSUER_GET]: reply(200),
        [CLASS_GET]: reply(404),
        [CLASS_POST]: reply(400),
      },
      'creating the class failed with HTTP 400',
    ],
    [
      'updating the class failing',
      {
        [TOKEN]: goodToken,
        [ISSUER_GET]: reply(200),
        [CLASS_GET]: reply(200, {}),
        [CLASS_PATCH]: reply(409),
      },
      'updating the class failed with HTTP 409',
    ],
    [
      'an unreadable class response',
      { [TOKEN]: goodToken, [ISSUER_GET]: reply(200), [CLASS_GET]: unreadable },
      'reading the class returned an unreadable response',
    ],
  ])('%s exits 1 naming the step and status only', async (_name, routes, message) => {
    const h = harness(routes);
    expect(await runCli(ARGV, h.deps)).toBe(1);
    expect(h.err).toEqual([`error: ${message}\n`]);
    expect(h.out.join('')).not.toContain('tok-1');
  });

  test('an unexpected error exits 1 without its message', async () => {
    const h = harness({});
    expect(await runCli(ARGV, h.deps)).toBe(1);
    expect(h.err).toEqual(['error: unexpected failure\n']);
  });
});

describe('defaultDeps, main and runIfDirect', () => {
  test('defaultDeps wires fetch, the file read, the clock and the output streams', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(reply(200, {})));
    vi.stubGlobal('fetch', fetchMock);
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    vi.spyOn(Date, 'now').mockReturnValue(NOW_MS);

    const deps = defaultDeps();
    await deps.fetch('https://example.test/x', { method: 'GET' });
    expect(fetchMock).toHaveBeenCalledWith('https://example.test/x', { method: 'GET' });
    expect(deps.now()).toBe(NOW_MS);
    deps.stdout('out');
    deps.stderr('err');
    expect(stdout).toHaveBeenCalledWith('out');
    expect(stderr).toHaveBeenCalledWith('err');
    expect(deps.env).toBe(process.env);
    expect(typeof deps.readFile).toBe('function');
  });

  test('main sets the exit code from a run that fails usage, with no network call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const argv = process.argv;
    const exitCode = process.exitCode;
    try {
      process.argv = ['node', 'script'];
      await main();
      expect(process.exitCode).toBe(2);
    } finally {
      process.argv = argv;
      process.exitCode = exitCode;
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('runIfDirect runs only when the entry file is the module', () => {
    const run = vi.fn(() => 'ran');
    const entry = '/tmp/some-script.mjs';
    const url = pathToFileURL(entry).href;
    expect(runIfDirect(entry, url, run)).toBe('ran');
    expect(runIfDirect(entry, 'file:///elsewhere.mjs', run)).toBeUndefined();
    expect(runIfDirect(undefined, url, run)).toBeUndefined();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
