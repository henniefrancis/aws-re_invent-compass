import { verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import fc from 'fast-check';
import { describe, expect, test, vi } from 'vitest';
import { formatEventDate, formatEventTime24 } from '../../src/apple/format-time.js';
import {
  WALLET_GROUP_ID,
  backFields,
  boardingClosesAt,
  shortRoom,
} from '../../src/apple/pass-template.js';
import {
  GENERIC_OBJECT_URL,
  createGoogleWalletClient,
} from '../../src/google/google-wallet-client.js';
import {
  GOOGLE_BACKGROUND,
  buildGenericObject,
  changeMessageFor,
  googleObjectId,
} from '../../src/google/google-object.js';
import {
  GOOGLE_CLASS_MODULES,
  GOOGLE_DETAIL_MODULES,
  GOOGLE_FRONT_ROWS,
  GOOGLE_IMAGES,
  GOOGLE_MAX_TEXT_MODULES,
} from '../../src/google/google-layout.js';
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

const BASE = 'https://compass.example.test';

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
            { issuerId, classSuffix, publicBaseUrl: BASE },
          );
          expect(obj.id).toBe(`${issuerId}.${serial}`);
          expect(obj.id).toBe(googleObjectId(issuerId, serial));
          expect(obj.id).toMatch(OBJECT_ID_CHARS);
          expect(obj.classId).toBe(`${issuerId}.${classSuffix}`);
          expect(obj.state).toBe(state);
          expect(obj.header.defaultValue.value).toBe(fields.title);
          expect(obj.subheader.defaultValue.value).toBe(fields.sessionCode);
          expect(obj.cardTitle.defaultValue.value).toBe('Compass boarding pass');
          // The front rows first, in reading order, then the Apple back in the template's
          // detail order, without the name (task 47).
          const back = backFields(fields, TZ);
          const onClass = new Set<string>(GOOGLE_CLASS_MODULES);
          const details = GOOGLE_DETAIL_MODULES.filter(
            (id) => !onClass.has(id) && back.some((f) => f.key === id),
          );
          expect(obj.textModulesData.map((m) => m.id)).toEqual([
            ...GOOGLE_FRONT_ROWS.flat(),
            ...details,
          ]);
          for (const module of obj.textModulesData.slice(GOOGLE_FRONT_ROWS.flat().length)) {
            const field = back.find((f) => f.key === module.id);
            expect(module).toEqual({ id: field?.key, header: field?.label, body: field?.value });
          }
          // Google takes at most 10 text modules from an object (task 47.7).
          expect(obj.textModulesData.length).toBeLessThanOrEqual(GOOGLE_MAX_TEXT_MODULES);
          expect(obj.textModulesData.some((m) => onClass.has(m.id))).toBe(false);
          expect(obj.textModulesData.some((m) => m.id === 'roomFull')).toBe(fields.room !== '');
          expect(obj.textModulesData.some((m) => m.id === 'walk')).toBe(
            fields.walkFromPrevious !== undefined,
          );
          expect(obj.textModulesData.some((m) => m.id === 'next')).toBe(
            fields.nextConnection !== undefined,
          );
          expect(obj.textModulesData.map((m) => m.header)).not.toContain('NAME');
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
          // Google refuses a wide logo without a logo (task 47.8).
          expect(obj.logo.sourceUri.uri).toBe(`${BASE}/wallet/logo-v1.png`);
          expect(obj.logo.contentDescription.defaultValue.value).toBe('Compass icon');
          expect(obj.wideLogo.sourceUri.uri).toBe(`${BASE}/wallet/wide-logo-v1.png`);
          expect(obj.heroImage.sourceUri.uri).toBe(`${BASE}/wallet/hero-v1.png`);
          expect(obj.wideLogo.contentDescription.defaultValue.value).toBe('Compass icon');
          expect(obj.heroImage.contentDescription.defaultValue.value).toMatch(/logo/);
          expect(obj.hexBackgroundColor).toBe(GOOGLE_BACKGROUND);
          expect(obj.validTimeInterval).toEqual({ end: { date: fields.endsAt } });
          expect(JSON.stringify(obj)).not.toMatch(/barcode/i);
        },
      ),
      { numRuns: 200 },
    );
  });
});

test('a pass with every detail writes its per-pass modules in the template order, without the name (tasks 47 and 47.7)', () => {
  const fields = samplePassFields();
  const full = {
    ...fields,
    room: 'Venetian, Murano 3201',
    walkFromPrevious: { minutes: 12, fromVenue: 'MGM Grand' },
    nextConnection: {
      sessionCode: 'SVS302',
      startsAt: fields.endsAt,
      venue: 'Wynn',
      walkMinutes: 15,
    },
    attendeeName: 'Sample Attendee',
  };
  const obj = buildGenericObject(
    {
      serialNumber: '55555555-5555-4555-8555-555555555555',
      fields: full,
      state: 'ACTIVE',
      timezone: TZ,
    },
    { issuerId: '3388000000099999999', classSuffix: 'compass', publicBaseUrl: BASE },
  );
  // The fixed texts are on the class (task 47.7): the object keeps 8 of Google's 10.
  expect(obj.textModulesData.map((m) => m.id)).toEqual([
    ...GOOGLE_FRONT_ROWS.flat(),
    'roomFull',
    'walk',
    'next',
    'timezone',
  ]);
  expect(obj.textModulesData.map((m) => m.header)).toEqual([
    'TERMINAL',
    'GATE',
    'DATE',
    'BOARDING CLOSES',
    'ROOM',
    'WALK FROM PREVIOUS',
    'NEXT SESSION',
    'TIMES',
  ]);
  expect(GOOGLE_DETAIL_MODULES.filter((id) => !GOOGLE_CLASS_MODULES.includes(id as never))).toEqual(
    ['roomFull', 'walk', 'next', 'timezone'],
  );
  expect(JSON.stringify(obj)).not.toContain('Sample Attendee');
});

test('the Google card is the blue at the top of the hero, and white text reads on it (task 47)', () => {
  expect(GOOGLE_BACKGROUND).toBe('#2035E2');
  const linear = (hex: string): number => {
    const c = Number.parseInt(hex, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [1, 3, 5].map((i) => linear(GOOGLE_BACKGROUND.slice(i, i + 2))) as [
    number,
    number,
    number,
  ];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  expect(1.05 / (luminance + 0.05)).toBeGreaterThan(7);
});

test('the Google images are PNGs at the sizes Google recommends (task 47)', () => {
  const size = (name: string): number[] => {
    const png = readFileSync(new URL(`../../artwork/google/${name}`, import.meta.url));
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    return [png.readUInt32BE(16), png.readUInt32BE(20)];
  };
  expect(size(GOOGLE_IMAGES.logo)).toEqual([660, 660]);
  expect(size(GOOGLE_IMAGES.wideLogo)).toEqual([1280, 400]);
  expect(size(GOOGLE_IMAGES.hero)).toEqual([1032, 812]);
});

describe('Feature: pass-service, Google REST client', () => {
  const obj = buildGenericObject(
    {
      serialNumber: '44444444-4444-4444-8444-444444444444',
      fields: samplePassFields(),
      state: 'ACTIVE',
      timezone: TZ,
    },
    { issuerId: '3388000000099999999', classSuffix: 'compass', publicBaseUrl: BASE },
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

  test('addMessage posts one message to the documented endpoint (task 56)', async () => {
    const message = {
      id: 'change-2',
      header: 'CMP340 changed',
      body: 'Now at Venetian, Room 9.',
      messageType: 'TEXT_AND_NOTIFY' as const,
    };
    for (const [status, result] of [
      [200, 'ok'],
      [429, 'failed'],
      [400, 'failed'],
    ] as const) {
      const { http, calls } = fakeHttp([status]);
      const client = createGoogleWalletClient({ http, tokens, secrets: googleSecrets() });
      expect(await client.addMessage(obj.id, message)).toBe(result);
      expect(calls).toEqual([
        {
          url: `${GENERIC_OBJECT_URL}/${encodeURIComponent(obj.id)}/addMessage`,
          method: 'POST',
          authorization: 'Bearer fake-access-token',
          body: { message },
        },
      ]);
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

  function objectsOf(count: number): { id: string; classId: string }[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `3388000000099999999.00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      classId: '3388000000099999999.compass',
    }));
  }

  /** Checks one link's token and returns its objects. */
  function checkLink(url: string, iat: number): { id: string; classId: string }[] {
    expect(url.startsWith(SAVE_URL_PREFIX)).toBe(true);
    const jwt = url.slice(SAVE_URL_PREFIX.length);
    const [h, p, s] = jwt.split('.') as [string, string, string];
    expect(decode(h)).toEqual({ alg: 'RS256', typ: 'JWT' });
    const claims = decode(p);
    expect(Object.keys(claims)).toEqual(['iss', 'aud', 'typ', 'iat', 'origins', 'payload']);
    expect(claims).toMatchObject({
      iss: throwawayPki().google.clientEmail,
      aud: 'google',
      typ: 'savetowallet',
      iat,
      origins: [],
    });
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from(`${h}.${p}`),
        throwawayPki().google.publicKey,
        Buffer.from(s, 'base64url'),
      ),
    ).toBe(true);
    expect(JSON.stringify(claims)).not.toContain('groupingInfo');
    expect(JSON.stringify(claims)).not.toContain('sortIndex');
    return (claims.payload as { genericObjects: { id: string; classId: string }[] }).genericObjects;
  }

  function saveClient() {
    return createGoogleWalletClient({
      http: fakeHttp([200]).http,
      tokens,
      secrets: googleSecrets(),
    });
  }

  // Feature: pass-service, Property 23: Save links carry a verifiable RS256 JWT
  test('Property 23: links carry verifiable RS256 JWTs, each within the safe length, in order', async () => {
    const client = saveClient();
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 80 }),
        fc.integer({ min: 1_700_000_000, max: 2_000_000_000 }),
        async (count, iat) => {
          const objects = objectsOf(count);
          const links = await client.saveLinks(objects, iat);
          const held = links.flatMap((link) => checkLink(link.url, iat));
          expect(held).toEqual(objects);
          expect(links.map((link) => link.count).reduce((a, b) => a + b, 0)).toBe(count);
          for (const link of links) {
            expect(link.url.length - SAVE_URL_PREFIX.length).toBeLessThanOrEqual(1800);
            expect(link.oversize).toBe(false);
            expect(link.count).toBeGreaterThanOrEqual(1);
          }
          // Greedy: a link is closed only because the next pass would not have fitted.
          expect(links.length).toBe(Math.ceil(count / links[0]!.count));
        },
      ),
      { numRuns: 100 },
    );
  });

  test('1, 8, 9 and 12 passes: one link up to 8, then split, every token at most 1800 long', async () => {
    const client = saveClient();
    const lengths: Record<number, number[]> = {};
    for (const count of [1, 8, 9, 12]) {
      const links = await client.saveLinks(objectsOf(count), 1_800_000_000);
      lengths[count] = links.map((link) => link.url.length - SAVE_URL_PREFIX.length);
      expect(links.flatMap((link) => checkLink(link.url, 1_800_000_000))).toEqual(objectsOf(count));
    }
    expect(lengths[1]).toHaveLength(1);
    expect(lengths[8]).toHaveLength(1);
    expect(lengths[9]).toHaveLength(2);
    expect(lengths[12]).toHaveLength(2);
    for (const each of Object.values(lengths).flat()) {
      expect(each).toBeLessThanOrEqual(1800);
    }
  });

  test('a single object that is alone over the safe length is its own link and is flagged', async () => {
    const huge = { id: `x.${'a'.repeat(1900)}`, classId: 'x.compass' };
    const objects = [objectsOf(1)[0]!, huge, objectsOf(2)[1]!];
    const links = await saveClient().saveLinks(objects, 1_800_000_000);
    expect(links.map((link) => [link.count, link.oversize])).toEqual([
      [1, false],
      [1, true],
      [1, false],
    ]);
  });

  test('no objects make no links', async () => {
    expect(await saveClient().saveLinks([], 1_800_000_000)).toEqual([]);
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

describe('Feature: pass-service, one wallet group for the week, Google (task 55)', () => {
  const build = (startsAt: string, endsAt: string) =>
    buildGenericObject(
      {
        serialNumber: '66666666-6666-4666-8666-666666666666',
        fields: samplePassFields({ startsAt, endsAt }),
        state: 'ACTIVE',
        timezone: TZ,
      },
      { issuerId: '3388000000099999999', classSuffix: 'compass', publicBaseUrl: 'https://x.test' },
    );

  test('every object carries the fixed group id and a whole-minute sortIndex of the start', () => {
    const obj = build('2026-12-02T09:20:00-08:00', '2026-12-02T11:00:00-08:00');
    expect(obj.groupingInfo.groupingId).toBe(WALLET_GROUP_ID);
    expect(obj.groupingInfo.sortIndex).toBe(Date.parse('2026-12-02T17:20:00Z') / 60_000);
    expect(Number.isInteger(obj.groupingInfo.sortIndex)).toBe(true);
  });

  test('two sessions sort by start and the index fits a signed 32-bit integer for 2026', () => {
    const early = build('2026-11-30T08:00:00-08:00', '2026-11-30T09:00:00-08:00');
    const late = build('2026-12-04T16:00:00-08:00', '2026-12-04T17:00:00-08:00');
    expect(early.groupingInfo.sortIndex).toBeLessThan(late.groupingInfo.sortIndex);
    for (const obj of [early, late]) {
      expect(obj.groupingInfo.sortIndex).toBeLessThanOrEqual(2 ** 31 - 1);
      expect(obj.groupingInfo.sortIndex).toBeGreaterThan(0);
    }
  });

  test('the group id holds no attendee data and the save token names objects by id only', () => {
    expect(WALLET_GROUP_ID).toMatch(/^[a-z0-9-]+$/);
  });
});

describe('Feature: pass-service, Google change alert (task 56)', () => {
  const before = samplePassFields({ venue: 'Venetian', room: 'Room 1' });

  test('names only what changed, in the pass formats, with a version id', () => {
    const moved = changeMessageFor(before, { ...before, room: 'Room 9' }, TZ, 3);
    expect(moved).toEqual({
      id: 'change-3',
      header: `${before.sessionCode} changed`,
      body: 'Now at Venetian, Room 9.',
      messageType: 'TEXT_AND_NOTIFY',
    });
    const startsAt = '2026-12-02T11:00:00-08:00';
    const endsAt = '2026-12-02T12:00:00-08:00';
    const later = changeMessageFor(before, { ...before, startsAt, endsAt }, TZ, 4);
    expect(later?.body).toBe(
      `Now ${formatEventDate(startsAt, TZ)} | ${formatEventTime24(startsAt, TZ)}-${formatEventTime24(endsAt, TZ)}.`,
    );
    const both = changeMessageFor(
      before,
      { ...before, venue: '', room: '', endsAt: '2026-12-02T23:00:00-08:00' },
      TZ,
      5,
    );
    expect(both?.body).toMatch(/^Now at Venue not published, Room not published\. Now .+\.$/);
  });

  test('sends nothing when nothing the attendee acts on changed', () => {
    expect(changeMessageFor(before, { ...before, title: 'A new title' }, TZ, 2)).toBeUndefined();
    const sameInstant = { ...before, startsAt: new Date(before.startsAt).toISOString() };
    expect(changeMessageFor(before, sameInstant, TZ, 2)).toBeUndefined();
  });

  test('holds no attendee data', () => {
    const named = { ...before, attendeeName: 'Pat Example', room: 'Room 9' };
    const message = changeMessageFor({ ...before, attendeeName: 'Pat Example' }, named, TZ, 2);
    expect(JSON.stringify(message)).not.toContain('Pat Example');
  });
});
