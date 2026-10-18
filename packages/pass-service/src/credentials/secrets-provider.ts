// Reads the three secrets from Secrets Manager at runtime, parses each with its schema,
// caches the parsed value in memory and shares one in-flight fetch between concurrent
// callers. A failure is never cached. No error carries a secret value or the underlying
// parser message (a JSON parse error can quote the text).
import { GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import type { z } from 'zod';
import { DependencyError } from '../http/problem.js';
import type { Clock } from '../seams.js';
import {
  AppSecretSchema,
  AppleSecretSchema,
  GoogleSecretSchema,
  OriginSecretSchema,
  type AppSecret,
  type AppleSecret,
  type GoogleSecret,
  type OriginSecret,
} from './secret-shapes.js';

export type { AppSecret, AppleSecret, GoogleSecret, OriginSecret } from './secret-shapes.js';

export interface SecretSource {
  /** Returns the SecretString of the secret. */
  get(secretId: string): Promise<string>;
}

export interface SecretIds {
  app: string;
  origin: string;
  apple: string;
  google?: string;
}

export interface SecretsProvider {
  app(): Promise<AppSecret>;
  origin(): Promise<OriginSecret>;
  apple(): Promise<AppleSecret>;
  google(): Promise<GoogleSecret>;
}

interface Entry<T> {
  value: T;
  fetchedAtMs: number;
}

function cachedReader<T>(
  idOf: () => string | undefined,
  schema: z.ZodType<T>,
  source: SecretSource,
  ttlMs: number,
  clock: Clock,
): () => Promise<T> {
  let entry: Entry<T> | undefined;
  let inFlight: Promise<T> | undefined;

  async function fetchFresh(secretId: string): Promise<T> {
    let text: string;
    let parsed: T;
    try {
      text = await source.get(secretId);
      parsed = schema.parse(JSON.parse(text));
    } catch {
      throw new DependencyError('secret');
    }
    entry = { value: parsed, fetchedAtMs: clock.now() };
    return parsed;
  }

  return async () => {
    if (entry !== undefined && clock.now() - entry.fetchedAtMs < ttlMs) {
      return entry.value;
    }
    const secretId = idOf();
    if (secretId === undefined) {
      throw new DependencyError('secret');
    }
    inFlight ??= fetchFresh(secretId).finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };
}

export function createSecretsProvider(
  source: SecretSource,
  ids: SecretIds,
  ttlSeconds: number,
  clock: Clock,
): SecretsProvider {
  const ttlMs = ttlSeconds * 1000;
  return {
    app: cachedReader(() => ids.app, AppSecretSchema, source, ttlMs, clock),
    origin: cachedReader(() => ids.origin, OriginSecretSchema, source, ttlMs, clock),
    apple: cachedReader(() => ids.apple, AppleSecretSchema, source, ttlMs, clock),
    google: cachedReader(() => ids.google, GoogleSecretSchema, source, ttlMs, clock),
  };
}

/** The slice of SecretsManagerClient that the adapter uses, so tests can mock `send` only. */
export interface SecretsClientLike {
  send(command: GetSecretValueCommand): Promise<{ SecretString?: string }>;
}

export function awsSecretSource(client: SecretsClientLike): SecretSource {
  return {
    async get(secretId) {
      let text: string | undefined;
      try {
        const output = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
        text = output.SecretString;
      } catch {
        throw new DependencyError('secret');
      }
      if (text === undefined) {
        throw new DependencyError('secret');
      }
      return text;
    },
  };
}
