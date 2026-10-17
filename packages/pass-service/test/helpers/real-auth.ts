// A fixture that verifies real (throwaway) ID tokens instead of the SubHash stub, so the
// security tests exercise the whole path from a signed token to a stored record.
import { createTokenVerifier } from '../../src/auth/token-verifier.js';
import { createApiFixture, type ApiFixture, type FixtureOptions } from './api-fixture.js';
import {
  countingFetcher,
  idClaims,
  jwksOf,
  newTestCache,
  sharedKeys,
  signJwt,
  type Json,
} from './jwt-factory.js';

export interface RealAuthFixture {
  fixture: ApiFixture;
  /** A signed ID token for `sub`, with optional extra claims such as an email. */
  tokenFor: (sub: string, extra?: Json) => string;
}

export function createRealAuthFixture(options: FixtureOptions = {}): RealAuthFixture {
  const { primary } = sharedKeys();
  const fetcher = countingFetcher(() => jwksOf(primary));
  const fixture = createApiFixture({
    ...options,
    verifier: ({ config, secrets, clock }) =>
      createTokenVerifier(config.idToken, {
        newJwksCache: () => newTestCache(fetcher),
        secrets,
        clock,
      }),
  });
  return {
    fixture,
    tokenFor: (sub, extra = {}) =>
      signJwt(
        { alg: 'RS256', typ: 'JWT', kid: primary.kid },
        idClaims({
          issuer: fixture.config.idToken.issuer,
          clientId: fixture.config.idToken.clientId,
          sub,
          extra,
        }),
        primary,
      ),
  };
}
