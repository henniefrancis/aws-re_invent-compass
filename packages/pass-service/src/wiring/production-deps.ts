// Production wiring: parses the environment and builds every client once, at module scope
// of the Lambda entry, so the clients, caches and the JWKS are reused across invocations. An
// invalid environment throws here, at init, and the function fails closed (Requirement 24.1).
// The passkit wiring builds no Google piece and never names the google-wallet secret.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SimpleJwksCache } from 'aws-jwt-verify/jwk';
import { createApnsClient } from '../apns/apns-client.js';
import { createHttp2Connector } from '../apns/http2-connector.js';
import { createPassSigner } from '../apple/pass-signer.js';
import type { ApiDeps, PasskitDeps } from '../app/deps.js';
import { createTokenVerifier } from '../auth/token-verifier.js';
import { parseApiConfig, parsePasskitConfig } from '../config/config.js';
import { createDynamoTableClient } from '../data/dynamo-table-client.js';
import { createHandoffRepository } from '../data/handoff-repository.js';
import { createPassRepository } from '../data/pass-repository.js';
import { createRateLimiter } from '../data/rate-limiter.js';
import { createRegistrationRepository } from '../data/registration-repository.js';
import { createGoogleWalletClient } from '../google/google-wallet-client.js';
import { createGoogleTokenSource } from '../google/token-source.js';
import { createSecretsProvider, awsSecretSource } from '../credentials/secrets-provider.js';
import { systemClock, systemRandom } from '../seams.js';

/** The production JWKS cache: aws-jwt-verify defaults (10 second penalty box, 3 second fetch timeout). */
export function newJwksCache(): SimpleJwksCache {
  return new SimpleJwksCache();
}

function stdoutSink(line: string): void {
  process.stdout.write(`${line}\n`);
}

function documentClient(): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
}

export function productionApiDeps(env: NodeJS.ProcessEnv): ApiDeps {
  const config = parseApiConfig(env);
  const secrets = createSecretsProvider(
    awsSecretSource(new SecretsManagerClient({})),
    {
      app: config.appSecretId,
      origin: config.originVerifySecretId,
      apple: config.appleSecretId,
      google: config.googleSecretId,
    },
    config.secretsCacheSeconds,
    systemClock,
  );
  const table = createDynamoTableClient(documentClient(), config.tableName);
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

export function productionPasskitDeps(env: NodeJS.ProcessEnv): PasskitDeps {
  const config = parsePasskitConfig(env);
  const secrets = createSecretsProvider(
    awsSecretSource(new SecretsManagerClient({})),
    { app: config.appSecretId, origin: config.originVerifySecretId, apple: config.appleSecretId },
    config.secretsCacheSeconds,
    systemClock,
  );
  const table = createDynamoTableClient(documentClient(), config.tableName);
  return {
    clock: systemClock,
    random: systemRandom,
    secrets,
    logSink: stdoutSink,
    console: globalThis.console,
    config,
    passes: createPassRepository(table),
    registrations: createRegistrationRepository(table),
    signer: createPassSigner(secrets),
  };
}
