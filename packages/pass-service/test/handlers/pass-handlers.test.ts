import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { createPassSigner } from '../../src/apple/pass-signer.js';
import { EXPIRY_GRACE_MS, ttlOf } from '../../src/data/keys.js';
import type { PassRecord } from '../../src/data/records.js';
import { deriveAuthToken } from '../../src/security/auth-token.js';
import { UUID_V4_PATTERN } from '../../src/security/handoff-id.js';
import { appleSecretFromPki } from '../helpers/apple-secret.js';
import {
  createApiFixture,
  lastLog,
  type ApiFixture,
  type CallOptions,
} from '../helpers/api-fixture.js';
import { passFieldsArb, samplePassFields } from '../helpers/pass-fields.js';
import { checkDetachedSignature } from '../helpers/pkcs7.js';
import { throwawayPki } from '../helpers/throwaway-pki.js';
import { zipMap } from '../helpers/zip-reader.js';

const HOUR = 3_600_000;
const SUB_A = 'a'.repeat(64);
const SUB_B = 'b'.repeat(64);
const UNKNOWN = '99999999-9999-4999-8999-999999999999';

const ISSUE = { method: 'POST', resource: '/api/v1/passes' } as const;

function numbered(passes: ReturnType<typeof samplePassFields>[]): Record<string, unknown>[] {
  return passes.map((pass, i) => ({ ...pass, sessionCode: `AAA${String(100 + i)}` }));
}

const serialRoute = (
  method: string,
  suffix: string,
  serial: string,
  token?: string,
): CallOptions => ({
  method,
  resource: `/api/v1/passes/{serialNumber}${suffix}`,
  path: { serialNumber: serial },
  token,
});

function passItems(fixture: ApiFixture) {
  return fixture.table.snapshot().filter((item) => item.pk.startsWith('PASS#'));
}

function record(sub: string, serial: string, overrides: Partial<PassRecord> = {}): PassRecord {
  const fields = samplePassFields();
  const expiresAtMs = Date.parse(fields.endsAt) + EXPIRY_GRACE_MS;
  return {
    serialNumber: serial,
    subHash: sub,
    pepperId: 'test-1',
    sessionCode: fields.sessionCode,
    fields,
    platforms: ['apple'],
    authTokenHash: 'x',
    tokenSalt: 'salt',
    status: 'active',
    version: 1,
    lastUpdatedMs: 0,
    googleState: 'none',
    createdAtMs: 0,
    expiresAtMs,
    ttl: ttlOf(expiresAtMs),
    ...overrides,
  };
}

function serialOf(i: number): string {
  return `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
}

describe('Feature: pass-service, issuePasses', () => {
  test('issues a pass: 201 body, hardening headers, a clean stored record', async () => {
    const fixture = createApiFixture();
    const reply = await fixture.call({
      ...ISSUE,
      token: SUB_A,
      body: { platforms: ['apple'], passes: [samplePassFields()] },
    });
    expect(reply.result.statusCode).toBe(201);
    expect(reply.result.headers['content-type']).toBe('application/json');
    expect(reply.result.headers['cache-control']).toBe('no-store');
    const body = reply.json as {
      passes: { serialNumber: string; sessionCode: string; platforms: string[] }[];
    };
    expect(body.passes).toHaveLength(1);
    expect(body.passes[0]).toMatchObject({ sessionCode: 'DAT302-R', platforms: ['apple'] });
    expect(lastLog(fixture.capture)).toMatchObject({
      route: 'POST /api/v1/passes',
      outcome: 'created',
    });
  });

  test('401 without a token, 400 for a bad body, and neither consumes budget', async () => {
    const fixture = createApiFixture();
    const noToken = await fixture.call({
      ...ISSUE,
      body: { platforms: ['apple'], passes: [samplePassFields()] },
    });
    expect(noToken.result.statusCode).toBe(401);
    const bad = await fixture.call({ ...ISSUE, token: SUB_A, body: { platforms: [], passes: [] } });
    expect(bad.result.statusCode).toBe(400);
    expect(fixture.table.snapshot()).toEqual([]);
  });

  test('429 rate_limited after 60 pass writes, with Retry-After, and nothing is created', async () => {
    const fixture = createApiFixture();
    const batch = (from: number, count: number) => ({
      platforms: ['apple'],
      passes: Array.from({ length: count }, (_, i) =>
        samplePassFields({ sessionCode: `BBB${String(from + i)}` }),
      ),
    });
    expect(
      (await fixture.call({ ...ISSUE, token: SUB_A, body: batch(100, 25) })).result.statusCode,
    ).toBe(201);
    expect(
      (await fixture.call({ ...ISSUE, token: SUB_A, body: batch(200, 25) })).result.statusCode,
    ).toBe(201);
    expect(
      (await fixture.call({ ...ISSUE, token: SUB_A, body: batch(300, 10) })).result.statusCode,
    ).toBe(201);
    const before = passItems(fixture).length;
    const refused = await fixture.call({ ...ISSUE, token: SUB_A, body: batch(400, 1) });
    expect(refused.result.statusCode).toBe(429);
    expect(refused.json).toMatchObject({ code: 'rate_limited' });
    const retry = Number(refused.result.headers['retry-after']);
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(3600);
    expect(passItems(fixture)).toHaveLength(before);
  });

  test('the 81st active pass is refused with active_pass_limit and no Retry-After', async () => {
    const fixture = createApiFixture();
    const batch = (from: number, count: number) => ({
      platforms: ['apple'],
      passes: Array.from({ length: count }, (_, i) =>
        samplePassFields({ sessionCode: `CCC${String(from + i)}` }),
      ),
    });
    for (const [from, count] of [
      [100, 25],
      [200, 25],
      [300, 25],
      [400, 5],
    ] as const) {
      expect(
        (await fixture.call({ ...ISSUE, token: SUB_A, body: batch(from, count) })).result
          .statusCode,
      ).toBe(201);
      fixture.clock.advance(HOUR);
    }
    const refused = await fixture.call({ ...ISSUE, token: SUB_A, body: batch(500, 1) });
    expect(refused.result.statusCode).toBe(429);
    expect(refused.json).toMatchObject({ code: 'active_pass_limit' });
    expect(refused.result.headers['retry-after']).toBeUndefined();
    expect(passItems(fixture)).toHaveLength(80);
  });

  // Feature: pass-service, Property 11: Issue creates exactly the right records
  test('Property 11: issue creates exactly the right records', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(passFieldsArb, { minLength: 1, maxLength: 25 }), async (passes) => {
        const fixture = createApiFixture();
        const list = numbered(passes);
        const reply = await fixture.call({
          ...ISSUE,
          token: SUB_A,
          body: { platforms: ['apple'], passes: list },
        });
        expect(reply.result.statusCode).toBe(201);
        const body = reply.json as { passes: { serialNumber: string; sessionCode: string }[] };
        expect(body.passes.map((p) => p.sessionCode)).toEqual(list.map((p) => p.sessionCode));
        const items = passItems(fixture);
        expect(items).toHaveLength(list.length);
        const serials = body.passes.map((p) => p.serialNumber);
        expect(new Set(serials).size).toBe(serials.length);
        const pepper = fixture.secrets.appSecret.pepper;
        for (const [i, serial] of serials.entries()) {
          expect(UUID_V4_PATTERN.test(serial)).toBe(true);
          const item = items.find((candidate) => candidate.pk === `PASS#${serial}`);
          expect(item).toMatchObject({
            subHash: SUB_A,
            version: 1,
            status: 'active',
            fields: list[i],
            expiresAtMs:
              Date.parse(String((list[i] as { endsAt: string }).endsAt)) + EXPIRY_GRACE_MS,
          });
          const token = deriveAuthToken(pepper, serial, String(item?.tokenSalt));
          expect(item?.authTokenHash).toBe(createHash('sha256').update(token).digest('hex'));
          expect(item?.ttl).toBe(Math.ceil(Number(item?.expiresAtMs) / 1000));
          expect(JSON.stringify(item)).not.toContain(token);
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: pass-service, Property 12: A Google failure or a disabled Google degrades only the platform list
  test('Property 12: a Google failure degrades only the platform list, and disabled Google makes no call', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.boolean(), { minLength: 1, maxLength: 6 }),
        fc.boolean(),
        async (mask, withApple) => {
          const fixture = createApiFixture();
          fixture.google.insertResult = (obj) => {
            const index = Number(obj.subheader.defaultValue.value.slice(3)) - 100;
            return mask[index] === true ? 'ok' : 'failed';
          };
          const platforms = withApple ? ['apple', 'google'] : ['google'];
          const passes = numbered(mask.map(() => samplePassFields()));
          const reply = await fixture.call({ ...ISSUE, token: SUB_A, body: { platforms, passes } });
          expect(reply.result.statusCode).toBe(201);
          expect(passItems(fixture)).toHaveLength(mask.length);
          const listed = (reply.json as { passes: { platforms: string[] }[] }).passes;
          mask.forEach((ok, i) => {
            expect(listed[i]?.platforms).toEqual([
              ...(withApple ? ['apple'] : []),
              ...(ok ? ['google'] : []),
            ]);
          });
          const failures = mask.filter((ok) => !ok).length;
          expect(lastLog(fixture.capture).GoogleWalletFailure).toBe(
            failures === 0 ? undefined : failures,
          );

          const disabled = createApiFixture({
            env: { GOOGLE_WALLET_ENABLED: 'false', GOOGLE_SECRET_ID: undefined },
          });
          const off = await disabled.call({ ...ISSUE, token: SUB_A, body: { platforms, passes } });
          expect(off.result.statusCode).toBe(201);
          expect(disabled.google.inserts).toHaveLength(0);
          expect(
            (off.json as { passes: { platforms: string[] }[] }).passes.every(
              (p) => !p.platforms.includes('google'),
            ),
          ).toBe(true);
          expect(passItems(disabled)).toHaveLength(mask.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: pass-service, Property 9: The active-pass cap refuses issue only, and update and void are never refused
  test('Property 9: the cap refuses issue only above 80, and update and void are never refused', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 85 }),
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: 1, max: 25 }),
        async (active, voided, n) => {
          const fixture = createApiFixture();
          for (let i = 0; i < active + voided; i += 1) {
            await fixture.deps.passes.create(
              record(SUB_A, serialOf(i), { status: i < active ? 'active' : 'voided' }),
            );
          }
          const reply = await fixture.call({
            ...ISSUE,
            token: SUB_A,
            body: {
              platforms: ['apple'],
              passes: numbered(Array.from({ length: n }, () => samplePassFields())),
            },
          });
          if (active + n > 80) {
            expect(reply.result.statusCode).toBe(429);
            expect(reply.json).toMatchObject({ code: 'active_pass_limit' });
            expect(reply.result.headers['retry-after']).toBeUndefined();
            expect(passItems(fixture)).toHaveLength(active + voided);
          } else {
            expect(reply.result.statusCode).toBe(201);
            expect(passItems(fixture)).toHaveLength(active + voided + n);
          }
        },
      ),
      { numRuns: 100 },
    );

    const fixture = createApiFixture();
    const serial = await fixture.issue(SUB_A);
    const now = fixture.clock.now();
    for (const [kind, scope] of [['passWrites'], ['updates'], ['passUpdate', serial]] as const) {
      await fixture.deps.limiter.record(SUB_A, kind, 5000, now, scope);
    }
    const update = await fixture.call({
      ...serialRoute('PUT', '', serial, SUB_A),
      body: samplePassFields({ room: 'Room 9' }),
    });
    expect(update.result.statusCode).toBe(200);
    const voided = await fixture.call(serialRoute('POST', '/void', serial, SUB_A));
    expect(voided.result.statusCode).toBe(200);
  });
});

describe('Feature: pass-service, getApplePass', () => {
  test('returns the signed pass for the owner with the pkpass type', async () => {
    const fixture = createApiFixture({
      secrets: { apple: appleSecretFromPki() },
      signer: (secrets) => createPassSigner(secrets, createApiFixtureConsole()),
    });
    const serial = await fixture.issue(SUB_A);
    const reply = await fixture.call(serialRoute('GET', '/apple', serial, SUB_A));
    expect(reply.result.statusCode).toBe(200);
    expect(reply.result.headers['content-type']).toBe('application/vnd.apple.pkpass');
    expect(reply.result.isBase64Encoded).toBe(true);
    const files = zipMap(Buffer.from(reply.result.body, 'base64'));
    const check = checkDetachedSignature(
      files.get('signature') as Buffer,
      files.get('manifest.json') as Buffer,
      throwawayPki().signerCertPem,
    );
    expect(check.signatureValid).toBe(true);
    const json = JSON.parse(String(files.get('pass.json'))) as Record<string, unknown>;
    expect(json.serialNumber).toBe(serial);
    expect(json.webServiceURL).toBe('https://d111111abcdef8.cloudfront.net/api/passkit');
    expect(String(json.authenticationToken)).toHaveLength(43);
    expect(json.voided).toBeUndefined();
  });

  test('a voided pass is still downloadable and carries voided true', async () => {
    const fixture = createApiFixture();
    const serial = await fixture.issue(SUB_A);
    await fixture.call(serialRoute('POST', '/void', serial, SUB_A));
    const reply = await fixture.call(serialRoute('GET', '/apple', serial, SUB_A));
    expect(JSON.parse(Buffer.from(reply.result.body, 'base64').toString())).toEqual({
      serial,
      status: 'voided',
    });
  });

  test('401 without a token and 404 when the path value is missing', async () => {
    const fixture = createApiFixture();
    expect(
      (await fixture.call({ method: 'GET', resource: '/api/v1/passes/{serialNumber}/apple' }))
        .result.statusCode,
    ).toBe(401);
    const missing = await fixture.call({
      method: 'GET',
      resource: '/api/v1/passes/{serialNumber}/apple',
      token: SUB_A,
    });
    expect(missing.result.statusCode).toBe(404);
  });
});

function createApiFixtureConsole() {
  return {
    log: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  };
}

describe('Feature: pass-service, update and void handlers', () => {
  test('update returns the new version, void returns voided, and bad input is refused', async () => {
    const fixture = createApiFixture();
    const serial = await fixture.issue(SUB_A);
    const updated = await fixture.call({
      ...serialRoute('PUT', '', serial, SUB_A),
      body: samplePassFields({ room: 'Room 2' }),
    });
    expect(updated.json).toEqual({ serialNumber: serial, version: 2 });
    const wrongCode = await fixture.call({
      ...serialRoute('PUT', '', serial, SUB_A),
      body: samplePassFields({ sessionCode: 'OTHER1' }),
    });
    expect(wrongCode.result.statusCode).toBe(400);
    const badBody = await fixture.call({
      ...serialRoute('PUT', '', serial, SUB_A),
      body: { nope: true },
    });
    expect(badBody.result.statusCode).toBe(400);
    expect(
      (await fixture.call({ ...serialRoute('PUT', '', serial), body: samplePassFields() })).result
        .statusCode,
    ).toBe(401);
    const voided = await fixture.call(serialRoute('POST', '/void', serial, SUB_A));
    expect(voided.json).toEqual({ serialNumber: serial, status: 'voided' });
    const afterVoid = await fixture.call({
      ...serialRoute('PUT', '', serial, SUB_A),
      body: samplePassFields(),
    });
    expect(afterVoid.result.statusCode).toBe(404);
    expect((await fixture.call(serialRoute('POST', '/void', serial))).result.statusCode).toBe(401);
    const noPath = await fixture.call({
      method: 'POST',
      resource: '/api/v1/passes/{serialNumber}/void',
      token: SUB_A,
    });
    expect(noPath.result.statusCode).toBe(404);
    const noPathPut = await fixture.call({
      method: 'PUT',
      resource: '/api/v1/passes/{serialNumber}',
      token: SUB_A,
      body: samplePassFields(),
    });
    expect(noPathPut.result.statusCode).toBe(404);
  });

  // Feature: pass-service, Property 7: A non-owner is indistinguishable from an unknown serial
  test('Property 7: a non-owner looks exactly like an unknown, expired or malformed serial', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom('apple', 'update', 'void'), async (operation) => {
        const fixture = createApiFixture();
        const serialA = await fixture.issue(SUB_A);
        await fixture.deps.passes.create(
          record(SUB_B, serialOf(7), { expiresAtMs: fixture.clock.now() - 1 }),
        );
        const request = (serial: string, sub: string): CallOptions => {
          if (operation === 'apple') {
            return serialRoute('GET', '/apple', serial, sub);
          }
          if (operation === 'void') {
            return serialRoute('POST', '/void', serial, sub);
          }
          return { ...serialRoute('PUT', '', serial, sub), body: samplePassFields() };
        };
        const before = JSON.stringify(fixture.table.snapshot());
        const unknown = await fixture.call(request(UNKNOWN, SUB_B));
        expect(unknown.result.statusCode).toBe(404);
        for (const serial of [serialA, serialOf(7), 'not-a-uuid', '', serialA.toUpperCase()]) {
          const forms = await fixture.call(request(serial, SUB_B));
          expect(forms.result).toEqual(unknown.result);
        }
        expect(JSON.stringify(fixture.table.snapshot())).toBe(before);
      }),
      { numRuns: 30 },
    );
  });
});
