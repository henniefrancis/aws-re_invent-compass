// Throwaway ID token helpers: RSA key pairs and a JWKS made with node:crypto at test time,
// tokens with any header and claims, and a counting JWKS fetcher. Nothing here is a real
// key and nothing is written to disk.
import { createHmac, createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import type { Fetcher } from 'aws-jwt-verify/https';
import { SimpleJwksCache, SimplePenaltyBox } from 'aws-jwt-verify/jwk';

export interface TestKey {
  kid: string;
  privateKey: KeyObject;
  jwk: Record<string, string>;
}

export function makeKey(kid: string): TestKey {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const exported = publicKey.export({ format: 'jwk' });
  const jwk: Record<string, string> = {
    kty: String(exported.kty),
    n: String(exported.n),
    e: String(exported.e),
    kid,
    alg: 'RS256',
    use: 'sig',
  };
  return { kid, privateKey, jwk };
}

let shared: { primary: TestKey; other: TestKey } | undefined;

/** Two key pairs, generated once per test file run. */
export function sharedKeys(): { primary: TestKey; other: TestKey } {
  shared ??= { primary: makeKey('kid-primary'), other: makeKey('kid-other') };
  return shared;
}

export function jwksOf(...keys: TestKey[]): { keys: Record<string, string>[] } {
  return { keys: keys.map((key) => key.jwk) };
}

function b64(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export type Json = Record<string, unknown>;

/** A token signed RS256 with the key. The header is whatever the caller passes. */
export function signJwt(header: Json, payload: Json, key: TestKey): string {
  const data = `${b64(header)}.${b64(payload)}`;
  const signature = createSign('RSA-SHA256').update(data).sign(key.privateKey, 'base64url');
  return `${data}.${signature}`;
}

/** A token with an arbitrary, non-empty signature segment (for alg none and similar). */
export function unsignedJwt(header: Json, payload: Json, signature = 'c2lnbmF0dXJl'): string {
  return `${b64(header)}.${b64(payload)}.${signature}`;
}

/** An HS256 token signed with a throwaway secret. */
export function hs256Jwt(header: Json, payload: Json, secret: string): string {
  const data = `${b64(header)}.${b64(payload)}`;
  return `${data}.${createHmac('sha256', secret).update(data).digest('base64url')}`;
}

/** Change the first character of the signature so the signature no longer verifies. */
export function tamperSignature(token: string): string {
  const [h, p, s] = token.split('.') as [string, string, string];
  const first = s.startsWith('A') ? 'B' : 'A';
  return `${h}.${p}.${first}${s.slice(1)}`;
}

export interface ClaimsOptions {
  issuer: string;
  clientId: string;
  sub?: string;
  tokenUse?: string;
  expOffsetSeconds?: number;
  extra?: Json;
}

export function idClaims(options: ClaimsOptions): Json {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    sub: options.sub ?? 'sub-0001',
    iss: options.issuer,
    aud: options.clientId,
    token_use: options.tokenUse ?? 'id',
    iat: nowSeconds,
    exp: nowSeconds + (options.expOffsetSeconds ?? 3600),
    ...options.extra,
  };
}

export interface CountingFetcher extends Fetcher {
  calls: number;
}

/** A JWKS fetcher that counts calls and never touches the network. */
export function countingFetcher(getJwks: () => unknown): CountingFetcher {
  const fetcher: CountingFetcher = {
    calls: 0,
    fetch() {
      fetcher.calls += 1;
      const bytes = new TextEncoder().encode(JSON.stringify(getJwks()));
      return Promise.resolve(bytes.buffer.slice(0));
    },
  };
  return fetcher;
}

export function newTestCache(fetcher: Fetcher, waitSeconds = 10): SimpleJwksCache {
  return new SimpleJwksCache({ fetcher, penaltyBox: new SimplePenaltyBox({ waitSeconds }) });
}
