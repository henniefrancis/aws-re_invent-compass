// Api_Lambda wiring: parses the environment and builds every client once, at module scope of
// the Lambda entry, so the clients, caches and the JWKS are reused across invocations. An
// invalid environment throws here, at init, and the function fails closed (Requirement 24.1).
import { SimpleJwksCache } from 'aws-jwt-verify/jwk';
import { createApnsClient } from '../apns/apns-client.js';
import { createHttp2Connector } from '../apns/http2-connector.js';
import { createPassSigner } from '../apple/pass-signer.js';
import type { ApiDeps } from '../app/deps.js';
import { createTokenVerifier } from '../auth/token-verifier.js';
import { parseApiConfig } from '../config/config.js';
import { createHandoffRepository } from '../data/handoff-repository.js';
import { createPassRepository } from '../data/pass-repository.js';
import { createRateLimiter } from '../data/rate-limiter.js';
import { createRegistrationRepository } from '../data/registration-repository.js';
import { createGoogleWalletClient } from '../google/google-wallet-client.js';
import { createGoogleTokenSource } from '../google/token-source.js';
import { systemClock, systemRandom } from '../seams.js';
import { productionSecrets, productionTable, stdoutSink } from './common.js';

/** The production JWKS cache: aws-jwt-verify defaults (10 second penalty box, 3 second fetch timeout). */
export function newJwksCache(): SimpleJwksCache {
  return new SimpleJwksCache();
}

export function productionApiDeps(env: NodeJS.ProcessEnv): ApiDeps {
  const config = parseApiConfig(env);
  const secrets = productionSecrets(
    {
      app: config.appSecretId,
      origin: config.originVerifySecretId,
      apple: config.appleSecretId,
      google: config.googleSecretId,
    },
    config.secretsCacheSeconds,
  );
  const table = productionTable(config.tableName);
  return {
    clock: systemClock,
    random: systemRandom,
    secrets,
    logSink: stdoutSink,
    console: globalThis.console,
    config,
    verifier: createTokenVerifier(config.idToken, {
      newJwksCache,
      secrets,
      clock: systemClock,
    }),
    limiter: createRateLimiter(table),
    table,
    passes: createPassRepository(table),
    registrations: createRegistrationRepository(table),
    handoffs: createHandoffRepository(table),
    signer: createPassSigner(secrets),
    apns: createApnsClient(config.apns, { connector: createHttp2Connector(), secrets }),
    google: createGoogleWalletClient({
      http: fetch,
      tokens: createGoogleTokenSource(secrets),
      secrets,
    }),
  };
}
