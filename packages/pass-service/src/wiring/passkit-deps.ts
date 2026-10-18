// Passkit_Lambda wiring. It builds no Google, JWKS or APNs piece and never names the
// google-wallet secret, and it imports none of those libraries, so they are not in the passkit
// bundle (review N10).
import { createPassSigner } from '../apple/pass-signer.js';
import type { PasskitDeps } from '../app/deps.js';
import { parsePasskitConfig } from '../config/config.js';
import { createPassRepository } from '../data/pass-repository.js';
import { createRegistrationRepository } from '../data/registration-repository.js';
import { systemClock, systemRandom } from '../seams.js';
import { productionSecrets, productionTable, stdoutSink } from './common.js';

export function productionPasskitDeps(env: NodeJS.ProcessEnv): PasskitDeps {
  const config = parsePasskitConfig(env);
  const secrets = productionSecrets(
    { app: config.appSecretId, origin: config.originVerifySecretId, apple: config.appleSecretId },
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
    passes: createPassRepository(table),
    registrations: createRegistrationRepository(table),
    signer: createPassSigner(secrets),
  };
}
