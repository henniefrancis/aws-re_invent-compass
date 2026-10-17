// The dependency bags handed to the two Lambda apps. The base bag is what the pipeline
// itself needs; the API and PassKit bags add the domain seams. Production wiring builds
// them in src/wiring; tests build them from in-memory fakes.
import type { ApnsClient } from '../apns/apns-client.js';
import type { PassSigner } from '../apple/pass-signer.js';
import type { TokenVerifier } from '../auth/token-verifier.js';
import type { ApiConfig, PasskitConfig } from '../config/config.js';
import type { HandoffRepository } from '../data/handoff-repository.js';
import type { PassRepository } from '../data/pass-repository.js';
import type { RateLimiter } from '../data/rate-limiter.js';
import type { RegistrationRepository } from '../data/registration-repository.js';
import type { TableClient } from '../data/table-client.js';
import type { GoogleWalletClient } from '../google/google-wallet-client.js';
import type { ConsoleLike } from '../observability/console-guard.js';
import type { LogSink } from '../observability/request-logger.js';
import type { SecretsProvider } from '../secrets/secrets-provider.js';
import type { Clock, Random } from '../seams.js';

export interface BaseDeps {
  clock: Clock;
  random: Random;
  secrets: SecretsProvider;
  logSink: LogSink;
  console: ConsoleLike;
}

export interface ApiDeps extends BaseDeps {
  config: ApiConfig;
  verifier: TokenVerifier;
  limiter: RateLimiter;
  table: TableClient;
  passes: PassRepository;
  registrations: RegistrationRepository;
  handoffs: HandoffRepository;
  signer: PassSigner;
  apns: ApnsClient;
  /** Never called when `config.google.enabled` is false. */
  google: GoogleWalletClient;
}

export interface PasskitDeps extends BaseDeps {
  config: PasskitConfig;
  passes: PassRepository;
  registrations: RegistrationRepository;
  signer: PassSigner;
}
