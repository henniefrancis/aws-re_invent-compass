import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { createApnsClient } from '../../src/apns/apns-client.js';
import { createHttp2Connector } from '../../src/apns/http2-connector.js';
import { createTokenVerifier } from '../../src/auth/token-verifier.js';
import { bundleLambdas } from '../../src/bundling/bundle-lambdas.js';
import { ConfigError, parseApiConfig } from '../../src/config/config.js';
import { startApnsStandIn } from '../helpers/apns-stand-in.js';
import { appleSecretFromPki } from '../helpers/apple-secret.js';
import { BASE_ENV, createApiFixture, lastLog } from '../helpers/api-fixture.js';
import { createFakeClock } from '../helpers/fake-clock.js';
import { createFakeSecrets } from '../helpers/fake-secrets.js';
import {
  countingFetcher,
  idClaims,
  jwksOf,
  newTestCache,
  sharedKeys,
  signJwt,
} from '../helpers/jwt-factory.js';
import { samplePassFields } from '../helpers/pass-fields.js';
import { makePassRecord, serialOf } from '../helpers/pass-record.js';
import { readZip } from '../helpers/zip-reader.js';
import { throwawayPki } from '../helpers/throwaway-pki.js';

vi.setConfig({ testTimeout: 300_000 });

const SUB = '4'.repeat(64);
const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

describe('Feature: pass-service, hand-off view survives a Google failure (N4)', () => {
  test('a failing save link leaves google null, counts the failure and still answers 200', async () => {
    const fixture = createApiFixture();
    await fixture.deps.passes.create(
      makePassRecord(SUB, serialOf(1), { platforms: ['apple', 'google'], googleState: 'active' }),
    );
    const created = await fixture.call({
      method: 'POST',
      resource: '/api/v1/handoffs',
      token: SUB,
      body: {
        serialNumbers: [serialOf(1)],
        include: { apple: true, google: true, calendar: true },
      },
    });
    const { handoffId } = created.json as { handoffId: string };
    for (const failure of ['rejects', 'throws'] as const) {
      fixture.google.saveLinks = () => {
        if (failure === 'throws') {
          throw new Error('google unavailable');
        }
        return Promise.reject(new Error('google unavailable'));
      };
      const view = await fixture.call({
        method: 'GET',
        resource: '/api/v1/handoffs/{handoffId}',
        path: { handoffId },
      });
      expect(view.result.statusCode).toBe(200);
      const body = view.json as { google: unknown; apple: { bundlePaths: string[] } };
      expect(body.google).toBeNull();
      expect(body.apple.bundlePaths).toHaveLength(1);
      expect(lastLog(fixture.capture).GoogleWalletFailure).toBe(1);
    }
  });
});

describe('Feature: pass-service, a failed Google patch in forget_me is counted (N5)', () => {
  test('GoogleWalletFailure is emitted when the INACTIVE patch fails during erasure', async () => {
    const fixture = createApiFixture();
    await fixture.deps.passes.create(
      makePassRecord(SUB, serialOf(1), { platforms: ['apple', 'google'], googleState: 'active' }),
    );
    fixture.google.patchResult = () => 'failed';
    const reply = await fixture.call({ method: 'DELETE', resource: '/api/v1/me', token: SUB });
    expect(reply.result.statusCode).toBe(202);
    expect(fixture.google.patches).toHaveLength(1);
    expect(lastLog(fixture.capture).GoogleWalletFailure).toBe(1);
  });
});

describe('Feature: pass-service, no node-forge in the source (N6)', () => {
  test('no source file imports node-forge in any form', () => {
    const name = ['node', 'forge'].join('-');
    const offenders = walk(srcRoot)
      .filter((file) => file.endsWith('.ts'))
      .filter((file) => readFileSync(file, 'utf8').includes(name))
      .map((file) => path.relative(srcRoot, file));
    expect(offenders).toEqual([]);
  });
});

describe('Feature: pass-service, aud must be a string in both verifier modes (N8)', () => {
  const issuer = 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_AbC123xyz';
  const clientId = '7vmom55m1qstvq8i71ph127bfq';

  test.each(['cognito', 'oidc'] as const)('an aud array is the standard 401 (%s)', async (mode) => {
    const { primary } = sharedKeys();
    const oidcIssuer = 'https://idp.example.test/realm';
    const verifier = createTokenVerifier(
      mode === 'cognito'
        ? { mode, issuer, clientId, userPoolId: 'us-east-1_AbC123xyz' }
        : { mode, issuer: oidcIssuer, clientId, jwksUri: 'https://idp.example.test/jwks.json' },
      {
        newJwksCache: () => newTestCache(countingFetcher(() => jwksOf(primary))),
        secrets: createFakeSecrets(),
        clock: createFakeClock(),
      },
    );
    const claims = idClaims({ issuer: mode === 'cognito' ? issuer : oidcIssuer, clientId });
    const good = signJwt({ alg: 'RS256', kid: primary.kid }, claims, primary);
    await expect(verifier.verify(`Bearer ${good}`)).resolves.toHaveProperty('subHash');
    const array = signJwt(
      { alg: 'RS256', kid: primary.kid },
      { ...claims, aud: [clientId] },
      primary,
    );
    await expect(verifier.verify(`Bearer ${array}`)).rejects.toMatchObject({ status: 401 });
  });
});

describe('Feature: pass-service, passkit bundle has no Google client (N10)', () => {
  const folders: string[] = [];
  afterAll(() => {
    for (const folder of folders) {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  test('google-auth-library and the Wallet endpoints are only in the api bundle', async () => {
    const out = mkdtempSync(path.join(tmpdir(), 'compass-n10-'));
    folders.push(out);
    await bundleLambdas({ outDir: out, esbuild });
    const code = (name: string) =>
      readZip(readFileSync(path.join(out, `${name}.zip`)))[0]?.data.toString('utf8') ?? '';
    for (const marker of [
      'walletobjects.googleapis.com',
      'wallet_object.issuer',
      'oauth2.googleapis.com',
    ]) {
      expect(code('api'), marker).toContain(marker);
      expect(code('passkit'), marker).not.toContain(marker);
    }
    expect(code('passkit')).not.toContain('jwks');
  });
});

describe('Feature: pass-service, the APNs host is allowlisted (N10)', () => {
  test('only the production and sandbox hosts are accepted, with a harness-only override', () => {
    for (const host of ['api.push.apple.com', 'api.sandbox.push.apple.com']) {
      expect(parseApiConfig({ ...BASE_ENV, APNS_HOST: host }).apns.host).toBe(host);
    }
    for (const host of ['evil.example.test', 'api.push.apple.com.evil.test', 'localhost']) {
      expect(() => parseApiConfig({ ...BASE_ENV, APNS_HOST: host })).toThrow(ConfigError);
    }
    expect(
      parseApiConfig({ ...BASE_ENV, APNS_HOST: 'localhost' }, { allowAnyApnsHost: true }).apns.host,
    ).toBe('localhost');
  });
});

describe('Feature: pass-service, the APNs reply body is capped (N10)', () => {
  test('a huge reply body is a failure and does not grow without bound', async () => {
    const server = await startApnsStandIn(() => ({
      status: 400,
      rawBody: 'x'.repeat(200_000),
    }));
    try {
      const client = createApnsClient(
        { enabled: true, host: 'localhost', timeoutMs: 5000, budgetMs: 8000 },
        {
          connector: createHttp2Connector({ port: server.port, ca: throwawayPki().wwdrPem }),
          secrets: createFakeSecrets({ apple: appleSecretFromPki() }),
        },
      );
      const outcome = await client.push([
        { deviceHash: 'd', serialNumber: samplePassFields().sessionCode, pushToken: 'aabb' },
      ]);
      expect(outcome).toEqual({ delivered: 0, invalid: [], failed: 1, skipped: false });
    } finally {
      await server.close();
    }
  });
});
