// Configuration parsing for both Lambdas (design Component 1). Every spike assumption
// (SP2 issuer, SP3 PassKit and APNs settings, SP4 Google switches) is an environment
// variable here, so a spike result changes configuration and not code.
//
// Parsing is strict and fails closed: a missing or invalid variable throws a
// ConfigError that names the variable and never holds a value. An empty string counts
// as "not set" for every variable.

export type VerifierMode = 'cognito' | 'oidc';

export interface EventWindow {
  start: string;
  end: string;
  timezone: string;
}

export type IdTokenConfig =
  | { mode: 'cognito'; issuer: string; clientId: string; userPoolId: string }
  | { mode: 'oidc'; issuer: string; clientId: string; jwksUri: string };

export interface ApiConfig {
  tableName: string;
  appSecretId: string;
  originVerifySecretId: string;
  appleSecretId: string;
  googleSecretId?: string; // required when google.enabled
  publicBaseUrl: string; // origin only: scheme, host and optional port
  passkitPath: string; // starts with '/', no trailing '/', default '/api/passkit'
  idToken: IdTokenConfig;
  eventWindow: EventWindow;
  apns: {
    enabled: boolean;
    host: string;
    pushType?: 'alert' | 'background';
    timeoutMs: number;
    budgetMs: number;
  };
  google: { enabled: false } | { enabled: true; classSuffix: string; insertBudgetMs: number };
  handoffCalendarEnabled: boolean;
  secretsCacheSeconds: number;
  serviceVersion: string;
}

export type PasskitConfig = Pick<
  ApiConfig,
  | 'tableName'
  | 'appSecretId'
  | 'originVerifySecretId'
  | 'appleSecretId'
  | 'publicBaseUrl'
  | 'passkitPath'
  | 'secretsCacheSeconds'
> & {
  eventTimezone: string;
};

export interface ParseOptions {
  /** Only the owner-run local harness sets this (Apple allows HTTP while testing). */
  allowHttpBaseUrl?: boolean;
  /** Only the owner-run local harness and the loopback tests set this (review N10). */
  allowAnyApnsHost?: boolean;
}

type Env = Readonly<Record<string, string | undefined>>;

/** The order in which the Api_Lambda variables are checked: the first failure is reported. */
export const API_VARIABLES = [
  'TABLE_NAME',
  'APP_SECRET_ID',
  'ORIGIN_VERIFY_SECRET_ID',
  'APPLE_SECRET_ID',
  'GOOGLE_WALLET_ENABLED',
  'GOOGLE_SECRET_ID',
  'GOOGLE_WALLET_CLASS_SUFFIX',
  'GOOGLE_INSERT_BUDGET_MS',
  'PUBLIC_BASE_URL',
  'PASSKIT_WEB_SERVICE_PATH',
  'EVENT_TIMEZONE',
  'EVENT_WINDOW_START',
  'EVENT_WINDOW_END',
  'ID_TOKEN_VERIFIER',
  'ID_TOKEN_ISSUER',
  'ID_TOKEN_CLIENT_ID',
  'ID_TOKEN_JWKS_URI',
  'APNS_ENABLED',
  'APNS_HOST',
  'APNS_PUSH_TYPE',
  'APNS_TIMEOUT_MS',
  'APNS_BUDGET_MS',
  'HANDOFF_CALENDAR_ENABLED',
  'SECRETS_CACHE_TTL_SECONDS',
  'SERVICE_VERSION',
] as const;

/** The order in which the Passkit_Lambda variables are checked. */
export const PASSKIT_VARIABLES = [
  'TABLE_NAME',
  'APP_SECRET_ID',
  'ORIGIN_VERIFY_SECRET_ID',
  'APPLE_SECRET_ID',
  'PUBLIC_BASE_URL',
  'PASSKIT_WEB_SERVICE_PATH',
  'EVENT_TIMEZONE',
  'SECRETS_CACHE_TTL_SECONDS',
] as const;

/** The default client id: the shared, public Builder ID app client. */
export const DEFAULT_CLIENT_ID = '7vmom55m1qstvq8i71ph127bfq';
export const DEFAULT_PASSKIT_PATH = '/api/passkit';
export const DEFAULT_APNS_HOST = 'api.push.apple.com';

/** An error that names the variable and never carries a value. */
export class ConfigError extends Error {
  readonly variable: string;

  constructor(variable: string) {
    super(`Invalid or missing configuration: ${variable}`);
    this.name = 'ConfigError';
    this.variable = variable;
  }
}

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/;
const HOST_PATTERN = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
/** APNs production and sandbox. Pass pushes work only in production, but the sandbox exists. */
export const APNS_HOSTS: readonly string[] = ['api.push.apple.com', 'api.sandbox.push.apple.com'];
const PATH_PATTERN = /^(?:\/[A-Za-z0-9._~-]+)+$/;
const ZONE_PATTERN = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;
const ISO_OFFSET_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const SUFFIX_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const VERSION_PATTERN = /^[A-Za-z0-9._+-]{1,64}$/;
const CLIENT_ID_PATTERN = /^[A-Za-z0-9]{1,128}$/;
const COGNITO_ISSUER_PATTERN =
  /^https:\/\/cognito-idp\.([a-z0-9-]+)\.amazonaws\.com\/(([a-z0-9-]+)_[A-Za-z0-9]+)$/;

function raw(env: Env, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value === '' ? undefined : value;
}

function required(env: Env, name: string): string {
  const value = raw(env, name);
  if (value === undefined) {
    throw new ConfigError(name);
  }
  return value;
}

function matching(env: Env, name: string, pattern: RegExp): string {
  const value = required(env, name);
  if (!pattern.test(value)) {
    throw new ConfigError(name);
  }
  return value;
}

function boolean(env: Env, name: string, fallback: boolean): boolean {
  const value = raw(env, name);
  if (value === undefined) {
    return fallback;
  }
  if (value !== 'true' && value !== 'false') {
    throw new ConfigError(name);
  }
  return value === 'true';
}

function integer(env: Env, name: string, fallback: number, min: number, max: number): number {
  const value = raw(env, name);
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!/^\d{1,9}$/.test(value) || parsed < min || parsed > max) {
    throw new ConfigError(name);
  }
  return parsed;
}

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function isIanaZone(zone: string): boolean {
  if (!ZONE_PATTERN.test(zone)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function baseUrl(env: Env, allowHttp: boolean): string {
  const value = required(env, 'PUBLIC_BASE_URL');
  const origin = parseUrl(value)?.origin ?? '';
  const schemeOk = origin.startsWith('https://') || (allowHttp && origin.startsWith('http://'));
  if (!schemeOk || (value !== origin && value !== `${origin}/`)) {
    throw new ConfigError('PUBLIC_BASE_URL');
  }
  return origin;
}

function passkitPath(env: Env): string {
  const value = raw(env, 'PASSKIT_WEB_SERVICE_PATH') ?? DEFAULT_PASSKIT_PATH;
  if (!PATH_PATTERN.test(value)) {
    throw new ConfigError('PASSKIT_WEB_SERVICE_PATH');
  }
  return value;
}

function timezone(env: Env): string {
  const value = required(env, 'EVENT_TIMEZONE');
  if (!isIanaZone(value)) {
    throw new ConfigError('EVENT_TIMEZONE');
  }
  return value;
}

function instant(env: Env, name: string): string {
  const value = matching(env, name, ISO_OFFSET_PATTERN);
  if (Number.isNaN(Date.parse(value))) {
    throw new ConfigError(name);
  }
  return value;
}

function eventWindow(env: Env, zone: string): EventWindow {
  const start = instant(env, 'EVENT_WINDOW_START');
  const end = instant(env, 'EVENT_WINDOW_END');
  if (Date.parse(end) <= Date.parse(start)) {
    throw new ConfigError('EVENT_WINDOW_END');
  }
  return { start, end, timezone: zone };
}

function verifierMode(env: Env): VerifierMode {
  const value = raw(env, 'ID_TOKEN_VERIFIER') ?? 'cognito';
  if (value !== 'cognito' && value !== 'oidc') {
    throw new ConfigError('ID_TOKEN_VERIFIER');
  }
  return value;
}

function cognitoPoolId(issuer: string): string | undefined {
  const match = COGNITO_ISSUER_PATTERN.exec(issuer);
  return match !== null && match[1] === match[3] ? match[2] : undefined;
}

function clientIdOf(env: Env): string {
  const clientId = raw(env, 'ID_TOKEN_CLIENT_ID') ?? DEFAULT_CLIENT_ID;
  if (!CLIENT_ID_PATTERN.test(clientId)) {
    throw new ConfigError('ID_TOKEN_CLIENT_ID');
  }
  return clientId;
}

function idToken(env: Env): IdTokenConfig {
  const mode = verifierMode(env);
  const issuer = required(env, 'ID_TOKEN_ISSUER');
  if (mode === 'cognito') {
    const userPoolId = cognitoPoolId(issuer);
    if (userPoolId === undefined) {
      throw new ConfigError('ID_TOKEN_ISSUER');
    }
    return { mode: 'cognito', issuer, clientId: clientIdOf(env), userPoolId };
  }
  const issuerUrl = parseUrl(issuer);
  if (issuerUrl?.protocol !== 'https:') {
    throw new ConfigError('ID_TOKEN_ISSUER');
  }
  const clientId = clientIdOf(env);
  const jwksUri = required(env, 'ID_TOKEN_JWKS_URI');
  const jwksUrl = parseUrl(jwksUri);
  // The JWKS must be served by the issuer's own host (security review L3).
  if (jwksUrl?.protocol !== 'https:' || jwksUrl.host !== issuerUrl.host) {
    throw new ConfigError('ID_TOKEN_JWKS_URI');
  }
  return { mode: 'oidc', issuer, clientId, jwksUri };
}

function apns(env: Env, allowAnyHost: boolean): ApiConfig['apns'] {
  const enabled = boolean(env, 'APNS_ENABLED', true);
  const host = raw(env, 'APNS_HOST') ?? DEFAULT_APNS_HOST;
  // An exact match against the allow-list, never a substring test.
  const allowed = allowAnyHost
    ? HOST_PATTERN.test(host)
    : APNS_HOSTS.some((candidate) => candidate === host);
  if (!allowed) {
    throw new ConfigError('APNS_HOST');
  }
  const pushType = raw(env, 'APNS_PUSH_TYPE');
  if (pushType !== undefined && pushType !== 'alert' && pushType !== 'background') {
    throw new ConfigError('APNS_PUSH_TYPE');
  }
  const timeoutMs = integer(env, 'APNS_TIMEOUT_MS', 2000, 100, 60000);
  const budgetMs = integer(env, 'APNS_BUDGET_MS', 4000, 100, 60000);
  return pushType === undefined
    ? { enabled, host, timeoutMs, budgetMs }
    : { enabled, host, pushType, timeoutMs, budgetMs };
}

/** Parse the Api_Lambda environment. Throws ConfigError naming the first invalid variable. */
export function parseApiConfig(env: Env, opts: ParseOptions = {}): ApiConfig {
  const tableName = matching(env, 'TABLE_NAME', NAME_PATTERN);
  const appSecretId = matching(env, 'APP_SECRET_ID', NAME_PATTERN);
  const originVerifySecretId = matching(env, 'ORIGIN_VERIFY_SECRET_ID', NAME_PATTERN);
  const appleSecretId = matching(env, 'APPLE_SECRET_ID', NAME_PATTERN);
  const googleEnabled = boolean(env, 'GOOGLE_WALLET_ENABLED', true);
  const googleSecretId = googleEnabled
    ? matching(env, 'GOOGLE_SECRET_ID', NAME_PATTERN)
    : undefined;
  const classSuffix = googleEnabled
    ? matching(env, 'GOOGLE_WALLET_CLASS_SUFFIX', SUFFIX_PATTERN)
    : undefined;
  const insertBudgetMs = googleEnabled
    ? integer(env, 'GOOGLE_INSERT_BUDGET_MS', 8000, 100, 12000)
    : 0;
  const publicBaseUrl = baseUrl(env, opts.allowHttpBaseUrl === true);
  const path = passkitPath(env);
  const zone = timezone(env);
  const window = eventWindow(env, zone);
  const token = idToken(env);
  const push = apns(env, opts.allowAnyApnsHost === true);
  const handoffCalendarEnabled = boolean(env, 'HANDOFF_CALENDAR_ENABLED', true);
  const secretsCacheSeconds = integer(env, 'SECRETS_CACHE_TTL_SECONDS', 300, 1, 3600);
  const serviceVersion = matching(env, 'SERVICE_VERSION', VERSION_PATTERN);
  return {
    tableName,
    appSecretId,
    originVerifySecretId,
    appleSecretId,
    ...(googleSecretId === undefined ? {} : { googleSecretId }),
    publicBaseUrl,
    passkitPath: path,
    idToken: token,
    eventWindow: window,
    apns: push,
    google:
      classSuffix === undefined
        ? { enabled: false }
        : { enabled: true, classSuffix, insertBudgetMs },
    handoffCalendarEnabled,
    secretsCacheSeconds,
    serviceVersion,
  };
}

/** Parse the Passkit_Lambda environment. Throws ConfigError naming the first invalid variable. */
export function parsePasskitConfig(env: Env, opts: ParseOptions = {}): PasskitConfig {
  return {
    tableName: matching(env, 'TABLE_NAME', NAME_PATTERN),
    appSecretId: matching(env, 'APP_SECRET_ID', NAME_PATTERN),
    originVerifySecretId: matching(env, 'ORIGIN_VERIFY_SECRET_ID', NAME_PATTERN),
    appleSecretId: matching(env, 'APPLE_SECRET_ID', NAME_PATTERN),
    publicBaseUrl: baseUrl(env, opts.allowHttpBaseUrl === true),
    passkitPath: passkitPath(env),
    eventTimezone: timezone(env),
    secretsCacheSeconds: integer(env, 'SECRETS_CACHE_TTL_SECONDS', 300, 1, 3600),
  };
}

/** The `webServiceURL` of every pass: the base URL and the PassKit path, one slash between. */
export function webServiceUrl(cfg: { publicBaseUrl: string; passkitPath: string }): string {
  return `${cfg.publicBaseUrl}${cfg.passkitPath}`;
}
