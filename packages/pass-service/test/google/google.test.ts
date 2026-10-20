import { verify } from 'node:crypto';
import { JWT } from 'google-auth-library';
import fc from 'fast-check';
import { describe, expect, test, vi } from 'vitest';
import { formatEventDate, formatEventTime24 } from '../../src/apple/format-time.js';
import { PASS_COLOURS, boardingClosesAt, shortRoom } from '../../src/apple/pass-template.js';
import {
  GENERIC_OBJECT_URL,
  createGoogleWalletClient,
} from '../../src/google/google-wallet-client.js';
import {
  GOOGLE_BACKGROUND,
  buildGenericObject,
  googleObjectId,
} from '../../src/google/google-object.js';
import { SAVE_URL_PREFIX, saveLink, signSaveJwt } from '../../src/google/save-jwt.js';
import { WALLET_SCOPE, createGoogleTokenSource } from '../../src/google/token-source.js';
import { createFakeSecrets } from '../helpers/fake-secrets.js';
import { passFieldsArb, samplePassFields, TEST_WINDOW } from '../helpers/pass-fields.js';
import { throwawayPki } from '../helpers/throwaway-pki.js';

const TZ = TEST_WINDOW.timezone;
const OBJECT_ID_CHARS = /^[A-Za-z0-9._-]+$/;

function googleSecrets() {
  const pki = throwawayPki();
  return createFakeSecrets({
    google: {
      issuerId: '3388000000099999999',
      serviceAccount: {
        client_email: pki.google.clientEmail,
        private_key: pki.google.privateKeyPem,
      },
    },
  });
}

interface Call {
  url: string;
  method: string | undefined;
  authorization: string | undefined;
  body: unknown;
}

function fakeHttp(statuses: (number | Error)[]): { http: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  let index = 0;
  const http = ((url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method,
      authorization: (init.headers as Record<string, string>).authorization,
      body: JSON.parse(init.body as string) as unknown,
    });
    const next = statuses[Math.min(index, statuses.length - 1)] as number | Error;
    index += 1;
    return next instanceof Error
      ? Promise.reject(next)
      : Promise.resolve(new Response(null, { status: next }));
  }) as typeof fetch;
  return { http, calls };
}

const tokens = { accessToken: () => Promise.resolve('fake-access-token') };

// Property tests do real work (signing, TLS, many records) and the machine may be busy.
vi.setConfig({ testTimeout: 120_000 });

describe('Feature: pass-service, Google generic object', () => {
  // Feature: pass-service, Property 21: Google objects follow the fixed mapping
  test('Property 21: objects follow the fixed mapping', () => {
    fc.assert(
      fc.property(
        passFieldsArb,
        fc.stringMatching(/^[0-9]{10,19}$/),
        fc.stringMatching(/^[A-Za-z0-9._-]{1,30}$/),
        fc.constantFrom<'ACTIVE' | 'INACTIVE'>('ACTIVE', 'INACTIVE'),
        (fields, issuerId, classSuffix, state) => {
          const serial = '33333333-3333-4333-8333-333333333333';
          const obj = buildGenericObject(
            { serialNumber: serial, fields, state, timezone: TZ },
            { issuerId, classSuffix },
          );
          expect(obj.id).toBe(`${issuerId}.${serial}`);
          expect(obj.id).toBe(googleObjectId(issuerId, serial));
          expect(obj.id).toMatch(OBJECT_ID_CHARS);
          expect(obj.classId).toBe(`${issuerId}.${classSuffix}`);
          expect(obj.state).toBe(state);
          expect(obj.header.defaultValue.value).toBe(fields.title);
          expect(obj.subheader.defaultValue.value).toBe(fields.sessionCode);
          expect(obj.cardTitle.defaultValue.value).toBe('Compass boarding pass');
          // The same fields and formats as the final Apple pass (task 40).
          expect(obj.textModulesData.map((m) => m.header)).toEqual([
            'TERMINAL',
            'GATE',
            'DATE',
            'BOARDING CLOSES',
            ...(fields.room === '' ? [] : ['ROOM']),
            'NOTICE',
          ]);
          const bodies = Object.fromEntries(obj.textModulesData.map((m) => [m.id, m.body]));
          expect(bodies.terminal).toBe(fields.venue === '' ? 'Venue not published' : fields.venue);
          expect(bodies.gate).toBe(
            shortRoom(fields.room) === '' ? 'Room not published' : shortRoom(fields.room),
          );
          expect(bodies.date).toBe(
            `${formatEventDate(fields.startsAt, TZ)} | ${formatEventTime24(fields.startsAt, TZ)}-${formatEventTime24(fields.endsAt, TZ)}`,
          );
          expect(bodies.boardingCloses).toBe(
            formatEventTime24(boardingClosesAt(fields.startsAt), TZ),
          );
          expect(bodies.room).toBe(fields.room === '' ? undefined : fields.room);
          expect(bodies.notice).toBe('Unofficial. Your badge is your ticket.');
          expect(obj.hexBackgroundColor).toBe(GOOGLE_BACKGROUND);
          expect(obj.validTimeInterval).toEqual({ end: { date: fields.endsAt } });
          expect(JSON.stringify(obj)).not.toMatch(/barcode|logo/i);
        },
      ),
      { numRuns: 200 },
    );
  });
});

test('the Google background is the Apple pass background in hex (task 40)', () => {
  const hex = PASS_COLOURS.background
    .match(/\d+/g)
    ?.map((channel) => Number(channel).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  expect(GOOGLE_BACKGROUND).toBe(`#${hex ?? ''}`);
});

describe('Feature: pass-service, Google REST client', () => {
  const obj = buildGenericObject(
    {
      serialNumber: '44444444-4444-4444-8444-444444444444',
      fields: samplePassFields(),
      state: 'ACTIVE',
      timezone: TZ,
    },
    { issuerId: '3388000000099999999', classSuffix: 'compass' },
  );

  // Feature: pass-service, Property 22: Google REST calls use the documented endpoints
  test('Property 22: documented endpoints, one patch after a 409, no other retry', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(200, 201, 204, 400, 401, 403, 404, 409, 429, 500, 503),
        fc.constantFrom(200, 404, 409, 500),
        async (insertStatus, patchStatus) => {
          const { http, calls } = fakeHttp([insertStatus, patchStatus]);
          const client = createGoogleWalletClient({ http, tokens, secrets: googleSecrets() });

          const inserted = await client.insert(obj);
          expect(calls[0]).toEqual({
            url: GENERIC_OBJECT_URL,
            method: 'POST',
            authorization: 'Bearer fake-access-token',
            body: obj,
          });
          if (insertStatus === 409) {
            expect(calls).toHaveLength(2);
            expect(calls[1]).toEqual({
              url: `${GENERIC_OBJECT_URL}/${encodeURIComponent(obj.id)}`,
              method: 'PATCH',
              authorization: 'Bearer fake-access-token',
              body: obj,
            });
            expect(inserted).toBe(patchStatus === 200 ? 'ok' : 'failed');
          } else {
            expect(calls).toHaveLength(1);
            expect(inserted).toBe(insertStatus >= 200 && insertStatus < 300 ? 'ok' : 'failed');
          }

          const patched = createFakeCallsPatch(patchStatus);
          expect(await patched.run()).toBe(patchStatus === 200 ? 'ok' : 'failed');
          expect(patched.calls).toHaveLength(1);
          expect(patched.calls[0]?.url).toBe(`${GENERIC_OBJECT_URL}/${encodeURIComponent(obj.id)}`);
          expect(patched.calls[0]?.method).toBe('PATCH');
          expect(patched.calls[0]?.body).toEqual({ state: 'INACTIVE' });
        },
      ),
      { numRuns: 100 },
    );

    function createFakeCallsPatch(status: number) {
      const fake = fakeHttp([status]);
      const client = createGoogleWalletClient({
        http: fake.http,
        tokens,
        secrets: googleSecrets(),
      });
      return { calls: fake.calls, run: () => client.patch(obj.id, { state: 'INACTIVE' }) };
    }
  });

  test('a network error, a token failure and a timeout are failures without a retry', async () => {
    const network = fakeHttp([new Error('connection reset to secret-host')]);
    const failing = createGoogleWalletClient({
      http: network.http,
      tokens,
      secrets: googleSecrets(),
    });
    expect(await failing.insert(obj)).toBe('failed');
    expect(network.calls).toHaveLength(1);

    const noToken = fakeHttp([200]);
    const client = createGoogleWalletClient({
      http: noToken.http,
      tokens: { accessToken: () => Promise.reject(new Error('no token')) },
      secrets: googleSecrets(),
    });
    expect(await client.patch(obj.id, { state: 'INACTIVE' })).toBe('failed');
    expect(noToken.calls).toHaveLength(0);

    const hang = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as unknown as typeof fetch;
    const slow = createGoogleWalletClient({
      http: hang,
      tokens,
      secrets: googleSecrets(),
      timeoutMs: 30,
    });
    expect(await slow.insert(obj)).toBe('failed');
  });
});

describe('Feature: pass-service, Save to Google Wallet link', () => {
  function decode(part: string): Record<string, unknown> {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
  }

  // Feature: pass-service, Property 23: Save links carry a verifiable RS256 JWT
  test('Property 23: links carry a verifiable RS256 JWT with exactly the documented claims', async () => {
    const secrets = googleSecrets();
    const client = createGoogleWalletClient({
      http: fakeHttp([200]).http,
      tokens,
      secrets,
    });
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 80 }),
        fc.integer({ min: 1_700_000_000, max: 2_000_000_000 }),
        async (count, iat) => {
          const objects = Array.from({ length: count }, (_, i) => ({
            id: `3388000000099999999.00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
            classId: '3388000000099999999.compass',
          }));
          const { url, oversize } = await client.saveUrl(objects, iat);
          expect(url.startsWith(SAVE_URL_PREFIX)).toBe(true);
          const jwt = url.slice(SAVE_URL_PREFIX.length);
          const [h, p, s] = jwt.split('.') as [string, string, string];
          expect(decode(h)).toEqual({ alg: 'RS256', typ: 'JWT' });
          expect(decode(p)).toEqual({
            iss: throwawayPki().google.clientEmail,
            aud: 'google',
            typ: 'savetowallet',
            iat,
            origins: [],
            payload: { genericObjects: objects },
          });
          expect(Object.keys(decode(p))).toEqual([
            'iss',
            'aud',
            'typ',
            'iat',
            'origins',
            'payload',
          ]);
          expect(
            verify(
              'RSA-SHA256',
              Buffer.from(`${h}.${p}`),
              throwawayPki().google.publicKey,
              Buffer.from(s, 'base64url'),
            ),
          ).toBe(true);
          expect(oversize).toBe(jwt.length > 1800);
        },
      ),
      { numRuns: 100 },
    );
  });

  test('the oversize flag turns on above 1800 characters and the link is still returned', () => {
    expect(saveLink('a'.repeat(1800)).oversize).toBe(false);
    const big = saveLink('a'.repeat(1801));
    expect(big.oversize).toBe(true);
    expect(big.url).toBe(`${SAVE_URL_PREFIX}${'a'.repeat(1801)}`);
    expect(
      signSaveJwt(
        {
          iss: 'x',
          aud: 'google',
          typ: 'savetowallet',
          iat: 1,
          origins: [],
          payload: { genericObjects: [] },
        },
        throwawayPki().google.privateKeyPem,
      ).split('.'),
    ).toHaveLength(3);
  });
});

describe('Feature: pass-service, Google token source', () => {
  test('builds the JWT client with the Wallet scope, reuses it, and rebuilds when the secret changes', async () => {
    const seen: { email: string | undefined; scopes: unknown; key: string | undefined }[] = [];
    const spy = vi.spyOn(JWT.prototype, 'getAccessToken').mockImplementation(function (this: JWT) {
      seen.push({ email: this.email, scopes: this.scopes, key: this.key });
      return Promise.resolve({ token: 'fake-token' }) as never;
    });
    try {
      const secrets = googleSecrets();
      const source = createGoogleTokenSource(secrets);
      expect(await source.accessToken()).toBe('fake-token');
      expect(await source.accessToken()).toBe('fake-token');
      expect(seen).toHaveLength(2);
      expect(seen[0]).toEqual({
        email: throwawayPki().google.clientEmail,
        scopes: [WALLET_SCOPE],
        key: throwawayPki().google.privateKeyPem,
      });
    } finally {
      spy.mockRestore();
    }
  });

  test('a changed secret builds a new client, and a missing token is an error', async () => {
    const built: string[] = [];
    let current = googleSecrets();
    const source = createGoogleTokenSource(
      { ...current, google: () => current.google() },
      (email) => {
        built.push(email);
        return {
          getAccessToken: () => Promise.resolve({ token: built.length === 3 ? null : 't' }),
        };
      },
    );
    await source.accessToken();
    await source.accessToken();
    expect(built).toHaveLength(1);
    current = createFakeSecrets({
      google: { serviceAccount: { client_email: 'other@example.test', private_key: 'k' } },
    });
    await source.accessToken();
    expect(built).toEqual([throwawayPki().google.clientEmail, 'other@example.test']);
    current = createFakeSecrets();
    await expect(source.accessToken()).rejects.toThrow('no access token');
  });
});
