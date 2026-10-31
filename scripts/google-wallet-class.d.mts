// Type declarations for google-wallet-class.mjs, so the unit test that imports the
// script is type-safe without disabling any lint rule.

export interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface FetchInit {
  signal?: AbortSignal;
  method?: string;
  headers?: Record<string, string>;
  body?: string | URLSearchParams;
}

export interface Deps {
  fetch(url: string, init: FetchInit): Promise<FetchResponse>;
  readFile(path: string, encoding: 'utf8'): string;
  now(): number;
  stdout(text: string): unknown;
  stderr(text: string): unknown;
  env: Record<string, string | undefined>;
}

export interface Difference {
  path: string;
  found: string;
}

export interface ParsedArgs {
  serviceAccountPath: string;
  issuerId: string;
  suffix: string;
  issuerName: string;
}

export declare const DESIRED_CLASS_FIELDS: Readonly<Record<string, unknown>>;
export declare function firstDifference(
  desired: unknown,
  current: unknown,
  path?: string,
): Difference | null;
export declare function matchesDesired(desired: unknown, current: unknown): boolean;
export declare function parseArgs(
  argv: string[],
  env?: Record<string, string | undefined>,
): ParsedArgs;
export declare function signJwt(claims: Record<string, unknown>, privateKeyPem: string): string;
export declare function defaultDeps(): Deps;
export declare function runCli(argv: string[], deps: Deps): Promise<number>;
export declare function main(): Promise<void>;
export declare function runIfDirect<T>(
  entryPath: string | undefined,
  moduleUrl: string,
  run: () => T,
): T | undefined;
