// The dependency bags handed to the two Lambda apps. Later tasks add members (table,
// verifier, limiter, signer, APNs, Google, services); the base bag is what the pipeline
// itself needs.
import type { ApiConfig, PasskitConfig } from '../config/config.js';
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

export type ApiDeps = BaseDeps & { config: ApiConfig };

export type PasskitDeps = BaseDeps & { config: PasskitConfig };
