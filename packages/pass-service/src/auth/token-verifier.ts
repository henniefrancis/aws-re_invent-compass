// ID token verification on aws-jwt-verify (Requirement 4, design Component 7).
//
// Flow: parse the bearer, refuse any algorithm but RS256 before any key lookup, verify
// with the mode-specific verifier (grace 0), check token_use and a string aud in oidc
// mode, then reduce `sub` to a SubHash. Every token failure is the same 401. The email
// claim is never read. A failing secret read is a dependency error, not a 401.
//
// Sources: https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-verifying-a-jwt.html
// and https://github.com/awslabs/aws-jwt-verify
import { CognitoJwtVerifier, JwtVerifier } from 'aws-jwt-verify';
import { decomposeUnverifiedJwt } from 'aws-jwt-verify/jwt';
import type { JwksCache } from 'aws-jwt-verify/jwk';
import type { IdTokenConfig } from '../config/config.js';
import { ProblemError } from '../http/problem.js';
import { subHash } from '../security/hashing.js';
import type { SecretsProvider } from '../credentials/secrets-provider.js';
import type { Clock } from '../seams.js';
import { parseBearer } from './bearer.js';

export interface VerifiedCaller {
  subHash: string;
}

export interface TokenVerifier {
  /** Throws ProblemError(401) for every token failure. */
  verify(authorizationHeader: string | undefined): Promise<VerifiedCaller>;
}

export interface TokenVerifierDeps {
  /** Builds a fresh JWKS cache. Production passes `() => new SimpleJwksCache()`. */
  newJwksCache: () => JwksCache;
  secrets: SecretsProvider;
  clock: Clock;
}

/** The verifier and its JWKS cache are rebuilt every hour (review L1). */
export const REBUILD_INTERVAL_MS = 60 * 60 * 1000;

interface Claims {
  sub?: unknown;
  token_use?: unknown;
  aud?: unknown;
}

type ClaimsVerifier = (token: string) => Promise<Claims>;

function buildVerifier(cfg: IdTokenConfig, jwksCache: JwksCache): ClaimsVerifier {
  if (cfg.mode === 'cognito') {
    const verifier = CognitoJwtVerifier.create(
      { userPoolId: cfg.userPoolId, tokenUse: 'id', clientId: cfg.clientId, graceSeconds: 0 },
      { jwksCache },
    );
    return (token) => verifier.verify(token);
  }
  const verifier = JwtVerifier.create(
    { issuer: cfg.issuer, audience: cfg.clientId, jwksUri: cfg.jwksUri, graceSeconds: 0 },
    { jwksCache },
  );
  return (token) => verifier.verify(token);
}

function unauthorized(): ProblemError {
  return new ProblemError(401, 'unauthorized');
}

export function createTokenVerifier(cfg: IdTokenConfig, deps: TokenVerifierDeps): TokenVerifier {
  let built: { atMs: number; verify: ClaimsVerifier } | undefined;

  function current(): ClaimsVerifier {
    const now = deps.clock.now();
    if (built === undefined || now - built.atMs >= REBUILD_INTERVAL_MS) {
      built = { atMs: now, verify: buildVerifier(cfg, deps.newJwksCache()) };
    }
    return built.verify;
  }

  async function subOf(authorizationHeader: string | undefined): Promise<string> {
    try {
      const token = parseBearer(authorizationHeader);
      if (token === undefined || decomposeUnverifiedJwt(token).header.alg !== 'RS256') {
        throw unauthorized();
      }
      const claims = await current()(token);
      // aud must be a string in both modes; token_use is checked here in oidc mode (cognito mode
      // checks it in the library).
      const claimsOk =
        typeof claims.aud === 'string' && (cfg.mode === 'cognito' || claims.token_use === 'id');
      if (!claimsOk || typeof claims.sub !== 'string' || claims.sub === '') {
        throw unauthorized();
      }
      return claims.sub;
    } catch {
      throw unauthorized();
    }
  }

  return {
    async verify(authorizationHeader) {
      const sub = await subOf(authorizationHeader);
      const { pepper } = await deps.secrets.app();
      return { subHash: subHash(pepper, sub) };
    },
  };
}
