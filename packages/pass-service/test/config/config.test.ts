import fc from 'fast-check';
import { describe, expect, test, vi } from 'vitest';
import {
  API_VARIABLES,
  ConfigError,
  PASSKIT_VARIABLES,
  parseApiConfig,
  parsePasskitConfig,
  webServiceUrl,
} from '../../src/config/config.js';

type Env = Record<string, string | undefined>;

const COGNITO_ISSUER = 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_AbC123xyz';

const cognitoEnv: Env = {
  TABLE_NAME: 'compass-dev',
  APP_SECRET_ID: 'compass/dev/app',
  ORIGIN_VERIFY_SECRET_ID: 'compass/dev/origin-verify',
  APPLE_SECRET_ID: 'compass/dev/apple-pass',
  GOOGLE_SECRET_ID: 'compass/dev/google-wallet',
  GOOGLE_WALLET_CLASS_SUFFIX: 'compass-boarding',
  PUBLIC_BASE_URL: 'https://d111111abcdef8.cloudfront.net',
  EVENT_TIMEZONE: 'America/Los_Angeles',
  EVENT_WINDOW_START: '2026-11-30T08:00:00-08:00',
  EVENT_WINDOW_END: '2026-12-04T20:00:00-08:00',
  ID_TOKEN_ISSUER: COGNITO_ISSUER,
  SERVICE_VERSION: '1.0.0',
};

const oidcEnv: Env = {
  ...cognitoEnv,
  ID_TOKEN_VERIFIER: 'oidc',
  ID_TOKEN_ISSUER: 'https://idp.example.test/realm',
  ID_TOKEN_JWKS_URI: 'https://idp.example.test/realm/jwks.json',
};

type Mode = 'cognito' | 'oidc';

// For each variable, a list of invalid values (undefined means "not set"). The needle is
// folded into every value that can carry one, so the no-echo check is meaningful.
const invalidValues: Record<string, (n: string, mode: Mode) => (string | undefined)[]> = {
  TABLE_NAME: (n) => [undefined, '', `bad name ${n}`],
  APP_SECRET_ID: (n) => [undefined, `bad name ${n}`],
  ORIGIN_VERIFY_SECRET_ID: (n) => [undefined, `bad name ${n}`],
  APPLE_SECRET_ID: (n) => [undefined, `bad name ${n}`],
  GOOGLE_WALLET_ENABLED: (n) => [`yes${n}`, 'TRUE'],
  GOOGLE_SECRET_ID: (n) => [undefined, `bad name ${n}`],
  GOOGLE_WALLET_CLASS_SUFFIX: (n) => [undefined, `bad suffix ${n}`],
  PUBLIC_BASE_URL: (n) => [
    undefined,
    'http://host.example',
    `https://host.example/path${n}`,
    `ftp://host.example${n}`,
    `not a url ${n}`,
    'https://host.example?q=1',
    'mailto:someone@example.test',
  ],
  PASSKIT_WEB_SERVICE_PATH: (n) => [`api/passkit${n}`, '/api/passkit/', '//x', `/a b${n}`],
  EVENT_TIMEZONE: (n) => [undefined, `Not/AZone${n}`, `bad zone ${n}`],
  EVENT_WINDOW_START: (n) => [undefined, `2026-12-01${n}`, '2026-13-45T00:00:00Z'],
  EVENT_WINDOW_END: (n) => [
    undefined,
    `2026-12-01${n}`,
    '2026-13-45T00:00:00Z',
    '2026-11-30T08:00:00-08:00',
  ],
  ID_TOKEN_VERIFIER: (n) => [`saml${n}`],
  ID_TOKEN_ISSUER: (n, mode) =>
    mode === 'cognito'
      ? [
          undefined,
          'https://cognito-idp.us-east-1.amazonaws.com/us-west-2_abc',
          `https://example.test/${n}`,
        ]
      : [undefined, 'not-a-url', 'http://idp.example.test/realm'],
  ID_TOKEN_CLIENT_ID: (n) => [`bad id ${n}`],
  ID_TOKEN_JWKS_URI: (n) => [
    undefined,
    'http://idp.example.test/jwks',
    'https://other.example.test/jwks',
    `not a url ${n}`,
  ],
  APNS_ENABLED: (n) => [`1${n}`],
  APNS_HOST: (n) => [`bad host ${n}`, '-x.example'],
  APNS_PUSH_TYPE: (n) => [`silent${n}`],
  APNS_TIMEOUT_MS: (n) => [`12x${n}`, '99', '60001', '-1'],
  APNS_BUDGET_MS: (n) => [`12x${n}`, '99', '60001', '-1'],
  HANDOFF_CALENDAR_ENABLED: (n) => [`maybe${n}`],
  SECRETS_CACHE_TTL_SECONDS: (n) => ['0', '3601', `x${n}`],
  SERVICE_VERSION: (n) => [undefined, `v 1 ${n}`],
};

function invalidFor(name: string, needle: string, mode: Mode): (string | undefined)[] {
  return invalidValues[name]?.(needle, mode) ?? [];
}

const needleArb = fc.stringMatching(/^[a-z0-9]{12}$/);

function isActive(name: string, mode: Mode): boolean {
  return !(name === 'ID_TOKEN_JWKS_URI' && mode === 'cognito');
}

// Property tests do real work (signing, TLS, many records) and the machine may be busy.
vi.setConfig({ testTimeout: 120_000 });

describe('Feature: pass-service, configuration parsing', () => {
  test('a minimal valid environment parses with the documented defaults', () => {
    const cfg = parseApiConfig(cognitoEnv);
    expect(cfg.passkitPath).toBe('/api/passkit');
    expect(cfg.idToken).toEqual({
      mode: 'cognito',
      issuer: COGNITO_ISSUER,
      clientId: '7vmom55m1qstvq8i71ph127bfq',
      userPoolId: 'us-east-1_AbC123xyz',
    });
    expect(cfg.apns).toEqual({
      enabled: true,
      host: 'api.push.apple.com',
      timeoutMs: 2000,
      budgetMs: 4000,
    });
    expect(cfg.google).toEqual({ enabled: true, classSuffix: 'compass-boarding' });
    expect(cfg.googleSecretId).toBe('compass/dev/google-wallet');
    expect(cfg.handoffCalendarEnabled).toBe(true);
    expect(cfg.secretsCacheSeconds).toBe(300);
    expect(cfg.eventWindow.timezone).toBe('America/Los_Angeles');
  });

  test('an oidc environment keeps the issuer and the https jwks uri', () => {
    const cfg = parseApiConfig(oidcEnv);
    expect(cfg.idToken).toEqual({
      mode: 'oidc',
      issuer: 'https://idp.example.test/realm',
      clientId: '7vmom55m1qstvq8i71ph127bfq',
      jwksUri: 'https://idp.example.test/realm/jwks.json',
    });
  });

  test('google disabled needs neither the google secret id nor the class suffix', () => {
    const cfg = parseApiConfig({
      ...cognitoEnv,
      GOOGLE_WALLET_ENABLED: 'false',
      GOOGLE_SECRET_ID: undefined,
      GOOGLE_WALLET_CLASS_SUFFIX: undefined,
    });
    expect(cfg.google).toEqual({ enabled: false });
    expect(cfg.googleSecretId).toBeUndefined();
    expect('googleSecretId' in cfg).toBe(false);
  });

  test('every optional variable can be set, and a push type is carried through', () => {
    const cfg = parseApiConfig({
      ...cognitoEnv,
      PASSKIT_WEB_SERVICE_PATH: '/pk/v2',
      ID_TOKEN_CLIENT_ID: 'abc123',
      APNS_ENABLED: 'false',
      APNS_HOST: 'api.sandbox.push.apple.com',
      APNS_PUSH_TYPE: 'background',
      APNS_TIMEOUT_MS: '1500',
      APNS_BUDGET_MS: '3000',
      HANDOFF_CALENDAR_ENABLED: 'false',
      SECRETS_CACHE_TTL_SECONDS: '60',
      PUBLIC_BASE_URL: 'https://host.example:8443/',
    });
    expect(cfg.passkitPath).toBe('/pk/v2');
    expect(cfg.idToken.clientId).toBe('abc123');
    expect(cfg.apns).toEqual({
      enabled: false,
      host: 'api.sandbox.push.apple.com',
      pushType: 'background',
      timeoutMs: 1500,
      budgetMs: 3000,
    });
    expect(cfg.handoffCalendarEnabled).toBe(false);
    expect(cfg.secretsCacheSeconds).toBe(60);
    expect(cfg.publicBaseUrl).toBe('https://host.example:8443');
  });

  test('an empty string counts as not set for an optional variable', () => {
    const cfg = parseApiConfig({ ...cognitoEnv, APNS_ENABLED: '', APNS_PUSH_TYPE: '' });
    expect(cfg.apns.enabled).toBe(true);
    expect(cfg.apns.pushType).toBeUndefined();
  });

  test('http base urls are refused unless the harness allows them', () => {
    const env = { ...cognitoEnv, PUBLIC_BASE_URL: 'http://192.168.1.20:8443' };
    expect(() => parseApiConfig(env)).toThrow(ConfigError);
    expect(parseApiConfig(env, { allowHttpBaseUrl: true }).publicBaseUrl).toBe(
      'http://192.168.1.20:8443',
    );
    expect(parsePasskitConfig(env, { allowHttpBaseUrl: true }).publicBaseUrl).toBe(
      'http://192.168.1.20:8443',
    );
    expect(() => parsePasskitConfig(env)).toThrow(ConfigError);
  });

  test('the passkit environment needs only its own variables', () => {
    const cfg = parsePasskitConfig({
      TABLE_NAME: 'compass-dev',
      APP_SECRET_ID: 'compass/dev/app',
      ORIGIN_VERIFY_SECRET_ID: 'compass/dev/origin-verify',
      APPLE_SECRET_ID: 'compass/dev/apple-pass',
      PUBLIC_BASE_URL: 'https://host.example',
      EVENT_TIMEZONE: 'Africa/Johannesburg',
    });
    expect(cfg).toEqual({
      tableName: 'compass-dev',
      appSecretId: 'compass/dev/app',
      originVerifySecretId: 'compass/dev/origin-verify',
      appleSecretId: 'compass/dev/apple-pass',
      publicBaseUrl: 'https://host.example',
      passkitPath: '/api/passkit',
      eventTimezone: 'Africa/Johannesburg',
      secretsCacheSeconds: 300,
    });
  });

  test('every invalid value of every variable is refused with that variable named', () => {
    for (const mode of ['cognito', 'oidc'] as const) {
      for (const name of API_VARIABLES) {
        if (!isActive(name, mode)) {
          continue;
        }
        for (const value of invalidFor(name, 'needle', mode)) {
          const env: Env = { ...(mode === 'cognito' ? cognitoEnv : oidcEnv), [name]: value };
          let caught: unknown;
          try {
            parseApiConfig(env);
          } catch (error) {
            caught = error;
          }
          expect((caught as ConfigError | undefined)?.variable).toBe(name);
        }
      }
    }
  });

  test('the error names the variable and carries no value', () => {
    const error = ((): unknown => {
      try {
        parseApiConfig({ ...cognitoEnv, TABLE_NAME: 'bad name SECRETVALUE' });
      } catch (caught) {
        return caught;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).variable).toBe('TABLE_NAME');
    expect((error as ConfigError).message).not.toContain('SECRETVALUE');
    expect((error as ConfigError).name).toBe('ConfigError');
  });

  // Feature: pass-service, Property 36: Configuration parses or fails closed without echo
  test('Property 36: parsing succeeds exactly when every active variable is valid, and never echoes', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Mode>('cognito', 'oidc'),
        needleArb,
        fc.uniqueArray(fc.constantFrom(...API_VARIABLES), { minLength: 0, maxLength: 5 }),
        fc.nat(1000),
        (mode, needle, mutated, pick) => {
          const base = mode === 'cognito' ? cognitoEnv : oidcEnv;
          const env: Env = { ...base };
          for (const name of mutated) {
            const choices = invalidFor(name, needle, mode);
            env[name] = choices[pick % choices.length];
          }
          const expectedFirst = API_VARIABLES.find((v) => mutated.includes(v) && isActive(v, mode));
          if (expectedFirst === undefined) {
            expect(() => parseApiConfig(env)).not.toThrow();
            return;
          }
          let caught: unknown;
          try {
            parseApiConfig(env);
          } catch (error) {
            caught = error;
          }
          expect(caught).toBeInstanceOf(ConfigError);
          const configError = caught as ConfigError;
          expect(configError.variable).toBe(expectedFirst);
          expect(configError.message).not.toContain(needle);
          expect(configError.variable).not.toContain(needle);
        },
      ),
      { numRuns: 300 },
    );
  });

  // Feature: pass-service, Property 36: Configuration parses or fails closed without echo
  test('Property 36: passkit parsing fails closed on the first invalid passkit variable', () => {
    fc.assert(
      fc.property(
        needleArb,
        fc.uniqueArray(fc.constantFrom(...PASSKIT_VARIABLES), { minLength: 1, maxLength: 4 }),
        fc.nat(1000),
        (needle, mutated, pick) => {
          const env: Env = { ...cognitoEnv };
          for (const name of mutated) {
            const choices = invalidFor(name, needle, 'cognito');
            env[name] = choices[pick % choices.length];
          }
          const expectedFirst = PASSKIT_VARIABLES.find((v) => mutated.includes(v));
          let caught: unknown;
          try {
            parsePasskitConfig(env);
          } catch (error) {
            caught = error;
          }
          expect(caught).toBeInstanceOf(ConfigError);
          expect((caught as ConfigError).variable).toBe(expectedFirst);
          expect((caught as ConfigError).message).not.toContain(needle);
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: pass-service, Property 36: Configuration parses or fails closed without echo
  test('Property 36: webServiceURL is the base url, one slash, the path, and no trailing slash', () => {
    const labelArb = fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/);
    fc.assert(
      fc.property(
        labelArb,
        fc.boolean(),
        fc.array(fc.stringMatching(/^[A-Za-z0-9._~-]{1,8}$/), { minLength: 1, maxLength: 4 }),
        (host, trailingSlash, segments) => {
          const origin = `https://${host}.example.test`;
          const path = `/${segments.join('/')}`;
          const env = {
            ...cognitoEnv,
            PUBLIC_BASE_URL: trailingSlash ? `${origin}/` : origin,
            PASSKIT_WEB_SERVICE_PATH: path,
          };
          const cfg = parseApiConfig(env);
          const url = webServiceUrl(cfg);
          expect(url).toBe(`${origin}${path}`);
          expect(url.endsWith('/')).toBe(false);
          expect(url.slice(origin.length).startsWith('//')).toBe(false);
          expect(url.slice(origin.length).startsWith('/')).toBe(true);
          expect(webServiceUrl(parsePasskitConfig(env))).toBe(url);
        },
      ),
      { numRuns: 100 },
    );
  });
});
