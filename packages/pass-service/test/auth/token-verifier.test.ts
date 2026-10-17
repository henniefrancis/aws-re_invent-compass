import fc from 'fast-check';
import { describe, expect, test, vi } from 'vitest';
import { parseBearer } from '../../src/auth/bearer.js';
import {
  REBUILD_INTERVAL_MS,
  createTokenVerifier,
  type TokenVerifier,
} from '../../src/auth/token-verifier.js';
import type { IdTokenConfig } from '../../src/config/config.js';
import { DependencyError, ProblemError, problem } from '../../src/http/problem.js';
import { subHash } from '../../src/security/hashing.js';
import type { SecretsProvider } from '../../src/secrets/secrets-provider.js';
import { createFakeClock } from '../helpers/fake-clock.js';
import { createFakeSecrets } from '../helpers/fake-secrets.js';
import {
  countingFetcher,
  hs256Jwt,
  idClaims,
  jwksOf,
  newTestCache,
  sharedKeys,
  signJwt,
  tamperSignature,
  unsignedJwt,
  type Json,
} from '../helpers/jwt-factory.js';

const CLIENT_ID = '7vmom55m1qstvq8i71ph127bfq';
const COGNITO_ISSUER = 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_AbC123xyz';
const OIDC_ISSUER = 'https://idp.example.test/realm';

const MODES: Record<'cognito' | 'oidc', { cfg: IdTokenConfig; issuer: string }> = {
  cognito: {
    cfg: {
      mode: 'cognito',
      issuer: COGNITO_ISSUER,
      clientId: CLIENT_ID,
      userPoolId: 'us-east-1_AbC123xyz',
    },
    issuer: COGNITO_ISSUER,
  },
  oidc: {
    cfg: {
      mode: 'oidc',
      issuer: OIDC_ISSUER,
      clientId: CLIENT_ID,
      jwksUri: 'https://idp.example.test/realm/jwks.json',
    },
    issuer: OIDC_ISSUER,
  },
};

type Mode = keyof typeof MODES;

function setup(mode: Mode, waitSeconds = 10) {
  const { primary } = sharedKeys();
  const fetcher = countingFetcher(() => jwksOf(primary));
  const secrets = createFakeSecrets();
  const clock = createFakeClock();
  let caches = 0;
  const verifier = createTokenVerifier(MODES[mode].cfg, {
    newJwksCache: () => {
      caches += 1;
      return newTestCache(fetcher, waitSeconds);
    },
    secrets,
    clock,
  });
  return { verifier, fetcher, secrets, clock, caches: () => caches, issuer: MODES[mode].issuer };
}

function goodToken(issuer: string, overrides: Json = {}, sub = 'sub-0001'): string {
  const { primary } = sharedKeys();
  return signJwt(
    { alg: 'RS256', typ: 'JWT', kid: primary.kid },
    idClaims({ issuer, clientId: CLIENT_ID, sub, extra: overrides }),
    primary,
  );
}

async function reject(verifier: TokenVerifier, header: string | undefined): Promise<ProblemError> {
  const error = await verifier.verify(header).then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ProblemError);
  return error as ProblemError;
}

const UNAUTHORIZED_BODY = problem(401, 'unauthorized').body;

function bodyOf(error: ProblemError): string {
  return problem(error.status, error.code).body;
}

// Property tests do real work (signing, TLS, many records) and the machine may be busy.
vi.setConfig({ testTimeout: 120_000 });

describe('Feature: pass-service, bearer parsing', () => {
  test('accepts Bearer plus three base64url segments and refuses everything else', () => {
    expect(parseBearer('Bearer aa.bb.cc')).toBe('aa.bb.cc');
    expect(parseBearer(undefined)).toBeUndefined();
    expect(parseBearer('bearer aa.bb.cc')).toBeUndefined();
    expect(parseBearer('Bearer aa.bb')).toBeUndefined();
    expect(parseBearer('Bearer aa.bb.')).toBeUndefined();
    expect(parseBearer('Bearer aa.bb.cc.dd')).toBeUndefined();
    expect(parseBearer('Bearer a a.bb.cc')).toBeUndefined();
    expect(parseBearer('Bearer ')).toBeUndefined();
    expect(parseBearer(`Bearer ${'a'.repeat(8186)}.b.c`)).toBeUndefined();
    expect(parseBearer(`Bearer ${'a'.repeat(8178)}.b.c`)).toBeDefined();
  });
});

describe.each(['cognito', 'oidc'] as const)(
  'Feature: pass-service, token verifier (%s)',
  (mode) => {
    test('a valid token yields only the keyed SubHash of its sub', async () => {
      const { verifier, secrets, issuer } = setup(mode);
      const token = goodToken(issuer, { email: 'someone@example.test' }, 'sub-xyz');
      const caller = await verifier.verify(`Bearer ${token}`);
      expect(caller).toEqual({ subHash: subHash(secrets.appSecret.pepper, 'sub-xyz') });
      expect(JSON.stringify(caller)).not.toContain('someone@example.test');
      expect(JSON.stringify(caller)).not.toContain('sub-xyz');
    });

    test('wrong aud is the standard 401', async () => {
      const { verifier, issuer } = setup(mode);
      const { primary } = sharedKeys();
      const token = signJwt(
        { alg: 'RS256', kid: primary.kid },
        idClaims({ issuer, clientId: 'some-other-client' }),
        primary,
      );
      expect(bodyOf(await reject(verifier, `Bearer ${token}`))).toBe(UNAUTHORIZED_BODY);
    });

    test('wrong iss is the standard 401', async () => {
      const { verifier } = setup(mode);
      const { primary } = sharedKeys();
      const token = signJwt(
        { alg: 'RS256', kid: primary.kid },
        idClaims({ issuer: 'https://evil.example.test/', clientId: CLIENT_ID }),
        primary,
      );
      expect(bodyOf(await reject(verifier, `Bearer ${token}`))).toBe(UNAUTHORIZED_BODY);
    });

    test('alg none is the standard 401', async () => {
      const { verifier, issuer } = setup(mode);
      const token = unsignedJwt(
        { alg: 'none', kid: sharedKeys().primary.kid },
        idClaims({ issuer, clientId: CLIENT_ID }),
      );
      expect(bodyOf(await reject(verifier, `Bearer ${token}`))).toBe(UNAUTHORIZED_BODY);
    });

    test('an HS256 token is the standard 401', async () => {
      const { verifier, issuer } = setup(mode);
      const token = hs256Jwt(
        { alg: 'HS256', kid: sharedKeys().primary.kid },
        idClaims({ issuer, clientId: CLIENT_ID }),
        'throwaway-hmac-secret',
      );
      expect(bodyOf(await reject(verifier, `Bearer ${token}`))).toBe(UNAUTHORIZED_BODY);
    });

    test('an expired token is the standard 401', async () => {
      const { verifier, issuer } = setup(mode);
      const { primary } = sharedKeys();
      const token = signJwt(
        { alg: 'RS256', kid: primary.kid },
        idClaims({ issuer, clientId: CLIENT_ID, expOffsetSeconds: -60 }),
        primary,
      );
      expect(bodyOf(await reject(verifier, `Bearer ${token}`))).toBe(UNAUTHORIZED_BODY);
    });

    test('an unknown kid is the standard 401', async () => {
      const { verifier, issuer } = setup(mode);
      const { other } = sharedKeys();
      const token = signJwt(
        { alg: 'RS256', kid: 'kid-not-in-jwks' },
        idClaims({ issuer, clientId: CLIENT_ID }),
        other,
      );
      expect(bodyOf(await reject(verifier, `Bearer ${token}`))).toBe(UNAUTHORIZED_BODY);
    });

    test('a bad signature is the standard 401', async () => {
      const { verifier, issuer } = setup(mode);
      const token = tamperSignature(goodToken(issuer));
      expect(bodyOf(await reject(verifier, `Bearer ${token}`))).toBe(UNAUTHORIZED_BODY);
    });

    test('a wrong token_use is the standard 401', async () => {
      const { verifier, issuer } = setup(mode);
      const token = goodToken(issuer, { token_use: 'access' });
      expect(bodyOf(await reject(verifier, `Bearer ${token}`))).toBe(UNAUTHORIZED_BODY);
    });

    test('a missing or empty sub is the standard 401', async () => {
      const { verifier, issuer } = setup(mode);
      const { primary } = sharedKeys();
      const claims = idClaims({ issuer, clientId: CLIENT_ID });
      delete claims.sub;
      const noSub = signJwt({ alg: 'RS256', kid: primary.kid }, claims, primary);
      expect(bodyOf(await reject(verifier, `Bearer ${noSub}`))).toBe(UNAUTHORIZED_BODY);
      const empty = goodToken(issuer, {}, '');
      expect(bodyOf(await reject(verifier, `Bearer ${empty}`))).toBe(UNAUTHORIZED_BODY);
    });

    test('a missing or malformed header is the standard 401', async () => {
      const { verifier } = setup(mode);
      for (const header of [
        undefined,
        '',
        'Bearer',
        'Basic abc',
        'Bearer not-a-jwt',
        'Bearer a.b.c',
      ]) {
        expect(bodyOf(await reject(verifier, header))).toBe(UNAUTHORIZED_BODY);
      }
    });

    test('a failing secret read is a dependency error, not a 401', async () => {
      const { primary } = sharedKeys();
      const failing: SecretsProvider = {
        app: () => Promise.reject(new DependencyError('secret')),
        origin: () => Promise.reject(new DependencyError('secret')),
        apple: () => Promise.reject(new DependencyError('secret')),
        google: () => Promise.reject(new DependencyError('secret')),
      };
      const verifier = createTokenVerifier(MODES[mode].cfg, {
        newJwksCache: () => newTestCache(countingFetcher(() => jwksOf(primary))),
        secrets: failing,
        clock: createFakeClock(),
      });
      await expect(
        verifier.verify(`Bearer ${goodToken(MODES[mode].issuer)}`),
      ).rejects.toBeInstanceOf(DependencyError);
    });

    test('the verifier and its JWKS cache are rebuilt every hour', async () => {
      const { verifier, clock, fetcher, caches, issuer } = setup(mode);
      const header = `Bearer ${goodToken(issuer)}`;
      await verifier.verify(header);
      await verifier.verify(header);
      expect(caches()).toBe(1);
      expect(fetcher.calls).toBe(1);
      clock.advance(REBUILD_INTERVAL_MS - 1);
      await verifier.verify(header);
      expect(caches()).toBe(1);
      clock.advance(1);
      await verifier.verify(header);
      expect(caches()).toBe(2);
      expect(fetcher.calls).toBe(2);
    });

    // Feature: pass-service, Property 4: A token is accepted exactly when every rule holds
    test('Property 4: accepted exactly when alg, kid, signature, iss, aud, token_use and exp all hold', async () => {
      const { primary, other } = sharedKeys();
      const caseArb = fc.record({
        alg: fc.constantFrom('RS256', 'none', 'HS256', 'RS384'),
        kid: fc.constantFrom('known', 'unknown'),
        signature: fc.constantFrom('valid', 'tampered'),
        iss: fc.constantFrom('right', 'wrong'),
        aud: fc.constantFrom('right', 'wrong'),
        use: fc.constantFrom('id', 'access'),
        exp: fc.constantFrom('future', 'past'),
      });
      await fc.assert(
        fc.asyncProperty(caseArb, async (c) => {
          const { verifier, issuer } = setup(mode);
          const claims = idClaims({
            issuer: c.iss === 'right' ? issuer : 'https://evil.example.test/',
            clientId: c.aud === 'right' ? CLIENT_ID : 'other-client',
            tokenUse: c.use,
            expOffsetSeconds: c.exp === 'future' ? 3600 : -120,
          });
          const header = {
            alg: c.alg,
            typ: 'JWT',
            kid: c.kid === 'known' ? primary.kid : 'kid-unknown',
          };
          let token: string;
          if (c.alg === 'none') {
            token = unsignedJwt(header, claims);
          } else if (c.alg === 'HS256') {
            token = hs256Jwt(header, claims, 'throwaway');
          } else {
            token = signJwt(header, claims, c.kid === 'known' ? primary : other);
          }
          if (c.signature === 'tampered') {
            token = tamperSignature(token);
          }
          const allCorrect =
            c.alg === 'RS256' &&
            c.kid === 'known' &&
            c.signature === 'valid' &&
            c.iss === 'right' &&
            c.aud === 'right' &&
            c.use === 'id' &&
            c.exp === 'future';
          if (allCorrect) {
            await expect(verifier.verify(`Bearer ${token}`)).resolves.toHaveProperty('subHash');
          } else {
            expect(bodyOf(await reject(verifier, `Bearer ${token}`))).toBe(UNAUTHORIZED_BODY);
          }
        }),
        { numRuns: 200 },
      );
    });

    // Feature: pass-service, Property 5: The JWKS is fetched at most once per kid, with one refetch for an unknown kid
    test('Property 5: known kids never refetch and an unknown kid refetches at most once', async () => {
      const { primary, other } = sharedKeys();
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.constantFrom('known', 'unknown-a', 'unknown-b'), {
            minLength: 1,
            maxLength: 12,
          }),
          async (kids) => {
            const { verifier, fetcher, issuer } = setup(mode);
            let empty = true;
            let penalised = false;
            for (const kid of kids) {
              const before = fetcher.calls;
              const claims = idClaims({ issuer, clientId: CLIENT_ID });
              if (kid === 'known') {
                await verifier.verify(
                  `Bearer ${signJwt({ alg: 'RS256', kid: primary.kid }, claims, primary)}`,
                );
                expect(fetcher.calls - before).toBe(empty ? 1 : 0);
              } else {
                const token = signJwt({ alg: 'RS256', kid }, claims, other);
                await reject(verifier, `Bearer ${token}`);
                expect(fetcher.calls - before).toBe(empty || !penalised ? 1 : 0);
                penalised = true;
              }
              empty = false;
            }
            expect(fetcher.calls).toBeLessThanOrEqual(2);
          },
        ),
        { numRuns: 60 },
      );
    });
  },
);

describe('Feature: pass-service, JWKS refetch on key rotation', () => {
  test('a new kid triggers exactly one more fetch once the back-off has ended', async () => {
    const { primary, other } = sharedKeys();
    let published = [primary];
    const fetcher = countingFetcher(() => jwksOf(...published));
    const verifier = createTokenVerifier(MODES.cognito.cfg, {
      newJwksCache: () => newTestCache(fetcher, 0.02),
      secrets: createFakeSecrets(),
      clock: createFakeClock(),
    });
    const claims = idClaims({ issuer: COGNITO_ISSUER, clientId: CLIENT_ID });
    await verifier.verify(`Bearer ${signJwt({ alg: 'RS256', kid: primary.kid }, claims, primary)}`);
    expect(fetcher.calls).toBe(1);
    const rotated = `Bearer ${signJwt({ alg: 'RS256', kid: other.kid }, claims, other)}`;
    await reject(verifier, rotated);
    expect(fetcher.calls).toBe(2);
    published = [primary, other];
    await reject(verifier, rotated);
    expect(fetcher.calls).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 60));
    await expect(verifier.verify(rotated)).resolves.toHaveProperty('subHash');
    expect(fetcher.calls).toBe(3);
  });
});
