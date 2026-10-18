import fc from 'fast-check';
import { describe, expect, test, vi } from 'vitest';
import { DependencyError } from '../../src/http/problem.js';
import {
  createSecretsProvider,
  type SecretSource,
  type SecretsProvider,
} from '../../src/credentials/secrets-provider.js';
import { createFakeClock } from '../helpers/fake-clock.js';

const NEEDLE = 'NEEDLE-secret-value-0123456789';

const validJson = {
  app: JSON.stringify({
    pepper: `pepper-${NEEDLE}`,
    pepperId: 'p1',
  }),
  origin: JSON.stringify({ originVerify: `origin-${NEEDLE}-aaaa` }),
  apple: JSON.stringify({
    passTypeIdentifier: 'pass.test.example',
    teamIdentifier: 'TEAM123456',
    signerCertPem: `cert-${NEEDLE}`,
    signerKeyPem: `key-${NEEDLE}`,
    signerKeyPassphrase: `pass-${NEEDLE}`,
    wwdrPem: `wwdr-${NEEDLE}`,
  }),
  google: JSON.stringify({
    issuerId: '3388000000012345678',
    serviceAccount: {
      client_email: 'svc@example.test',
      private_key: `pk-${NEEDLE}`,
      extra: 'ignored',
    },
  }),
};

type Kind = keyof typeof validJson;
type FailureMode = 'throw' | 'badjson' | 'badshape';
const ids = { app: 'id-app', origin: 'id-origin', apple: 'id-apple', google: 'id-google' };
const kindOfId: Record<string, Kind> = {
  'id-app': 'app',
  'id-origin': 'origin',
  'id-apple': 'apple',
  'id-google': 'google',
};

interface Counting {
  source: SecretSource;
  calls: () => Record<Kind, number>;
  failNext: (kind: Kind, mode: FailureMode) => void;
}

function counting(): Counting {
  const counts: Record<Kind, number> = { app: 0, origin: 0, apple: 0, google: 0 };
  const failures = new Map<Kind, FailureMode>();
  return {
    source: {
      async get(id) {
        const kind = kindOfId[id] as Kind;
        counts[kind] += 1;
        await Promise.resolve();
        const failure = failures.get(kind);
        failures.delete(kind);
        if (failure === 'throw') {
          throw new Error(`network down ${NEEDLE}`);
        }
        if (failure === 'badjson') {
          return `{not json ${NEEDLE}`;
        }
        if (failure === 'badshape') {
          return JSON.stringify({ pepper: NEEDLE });
        }
        return validJson[kind];
      },
    },
    calls: () => ({ ...counts }),
    failNext: (kind, mode) => failures.set(kind, mode),
  };
}

const read = (provider: SecretsProvider, kind: Kind): Promise<unknown> => provider[kind]();

// Property tests do real work (signing, TLS, many records) and the machine may be busy.
vi.setConfig({ testTimeout: 120_000 });

describe('Feature: pass-service, secrets provider', () => {
  test('parsed values come back with only the documented keys', async () => {
    const { source } = counting();
    const provider = createSecretsProvider(source, ids, 300, createFakeClock());
    expect((await provider.app()).pepperId).toBe('p1');
    expect((await provider.origin()).originVerify).toContain('origin-');
    expect((await provider.apple()).teamIdentifier).toBe('TEAM123456');
    expect(await provider.google()).toEqual({
      issuerId: '3388000000012345678',
      serviceAccount: { client_email: 'svc@example.test', private_key: `pk-${NEEDLE}` },
    });
  });

  test('google without a configured secret id fails as a dependency error', async () => {
    const { source } = counting();
    const provider = createSecretsProvider(
      source,
      { app: 'id-app', origin: 'id-origin', apple: 'id-apple' },
      300,
      createFakeClock(),
    );
    await expect(provider.google()).rejects.toBeInstanceOf(DependencyError);
  });

  test('a failed fetch is not cached and carries no value', async () => {
    for (const mode of ['throw', 'badjson', 'badshape'] as const) {
      const c = counting();
      const provider = createSecretsProvider(c.source, ids, 300, createFakeClock());
      c.failNext('app', mode);
      const error = await provider.app().then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(DependencyError);
      expect((error as Error).message).not.toContain(NEEDLE);
      expect((error as Error).cause).toBeUndefined();
      expect((await provider.app()).pepperId).toBe('p1');
      expect(c.calls().app).toBe(2);
    }
  });

  // Feature: pass-service, Property 34: Secrets are fetched once per period and never leak
  test('Property 34: one fetch per secret per period, failures uncached, nothing leaks', async () => {
    const stepArb = fc.record({
      advanceMs: fc.integer({ min: 0, max: 700_000 }),
      kind: fc.constantFrom<Kind>('app', 'origin', 'apple', 'google'),
      callers: fc.integer({ min: 1, max: 5 }),
      failure: fc.constantFrom<undefined | FailureMode>(
        undefined,
        undefined,
        'throw',
        'badjson',
        'badshape',
      ),
    });
    await fc.assert(
      fc.asyncProperty(fc.array(stepArb, { minLength: 1, maxLength: 25 }), async (steps) => {
        const clock = createFakeClock();
        const c = counting();
        const provider = createSecretsProvider(c.source, ids, 300, clock);
        const fetchedAt = new Map<Kind, number>();
        let expected: Record<Kind, number> = { app: 0, origin: 0, apple: 0, google: 0 };
        for (const step of steps) {
          clock.advance(step.advanceMs);
          const last = fetchedAt.get(step.kind);
          const stale = last === undefined || clock.now() - last >= 300_000;
          if (stale) {
            expected = { ...expected, [step.kind]: expected[step.kind] + 1 };
            if (step.failure !== undefined) {
              c.failNext(step.kind, step.failure);
            }
          }
          const results = await Promise.allSettled(
            Array.from({ length: step.callers }, () => read(provider, step.kind)),
          );
          if (stale && step.failure === undefined) {
            fetchedAt.set(step.kind, clock.now());
          }
          for (const result of results) {
            if (stale && step.failure !== undefined) {
              expect(result.status).toBe('rejected');
              const reason = (result as PromiseRejectedResult).reason as Error;
              expect(reason).toBeInstanceOf(DependencyError);
              expect(reason.message).not.toContain(NEEDLE);
            } else {
              expect(result.status).toBe('fulfilled');
            }
          }
          expect(c.calls()).toEqual(expected);
        }
      }),
      { numRuns: 100 },
    );
  });
});
