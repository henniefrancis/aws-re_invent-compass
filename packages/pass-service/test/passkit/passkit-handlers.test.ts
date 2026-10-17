import fc from 'fast-check';
import { describe, expect, test, vi } from 'vitest';
import { createPassSigner } from '../../src/apple/pass-signer.js';
import { deriveAuthToken } from '../../src/security/auth-token.js';
import { deviceHash, sha256Hex } from '../../src/security/hashing.js';
import { appleSecretFromPki } from '../helpers/apple-secret.js';
import { createApiFixture, lastLog, type ApiFixture } from '../helpers/api-fixture.js';
import { makePassRecord, serialOf } from '../helpers/pass-record.js';
import { samplePassFields } from '../helpers/pass-fields.js';
import { zipMap } from '../helpers/zip-reader.js';

const SUB = '1'.repeat(64);
const TYPE = 'pass.test.compass';
const REG =
  '/api/passkit/v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}/{serialNumber}';
const LIST = '/api/passkit/v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}';
const LATEST = '/api/passkit/v1/passes/{passTypeIdentifier}/{serialNumber}';
const UNAUTHORIZED = {
  type: 'about:blank',
  title: 'Unauthorized',
  status: 401,
  code: 'unauthorized',
};

interface RegOptions {
  device?: string;
  type?: string;
  serial: string;
  token?: string;
  body?: unknown;
  method?: 'POST' | 'DELETE';
}

function reg(fixture: ApiFixture, o: RegOptions) {
  return fixture.callPasskit({
    method: o.method ?? 'POST',
    resource: REG,
    path: {
      deviceLibraryIdentifier: o.device ?? 'device-library-0001',
      passTypeIdentifier: o.type ?? TYPE,
      serialNumber: o.serial,
    },
    headers: o.token === undefined ? {} : { authorization: `ApplePass ${o.token}` },
    body: o.body ?? { pushToken: 'aabbccdd' },
  });
}

function list(fixture: ApiFixture, device: string, since?: string, type = TYPE) {
  return fixture.callPasskit({
    method: 'GET',
    resource: LIST,
    path: { deviceLibraryIdentifier: device, passTypeIdentifier: type },
    query: since === undefined ? undefined : { passesUpdatedSince: since },
  });
}

function latest(fixture: ApiFixture, serial: string, token?: string, ims?: string) {
  return fixture.callPasskit({
    method: 'GET',
    resource: LATEST,
    path: { passTypeIdentifier: TYPE, serialNumber: serial },
    headers: {
      ...(token === undefined ? {} : { authorization: `ApplePass ${token}` }),
      ...(ims === undefined ? {} : { 'if-modified-since': ims }),
    },
  });
}

function devItems(fixture: ApiFixture) {
  return fixture.table.snapshot().filter((item) => item.pk.startsWith('DEV#'));
}

// Property tests do real work (signing, TLS, many records) and the machine may be busy.
vi.setConfig({ testTimeout: 120_000 });

describe('Feature: pass-service, PassKit statuses', () => {
  test('201 for the first registration, 200 when repeated, 200 for unregister, in every case', async () => {
    const fixture = createApiFixture();
    const serial = await fixture.issue(SUB);
    const token = await fixture.authToken(serial);
    expect((await reg(fixture, { serial, token })).result.statusCode).toBe(201);
    expect(lastLog(fixture.capture)).toMatchObject({ outcome: 'created' });
    const again = await reg(fixture, { serial, token, body: { pushToken: 'eeff' } });
    expect(again.result.statusCode).toBe(200);
    expect(devItems(fixture)[0]?.pushToken).toBe('eeff');
    expect((await reg(fixture, { serial, token, method: 'DELETE' })).result.statusCode).toBe(200);
    expect(devItems(fixture)).toHaveLength(0);
    expect((await reg(fixture, { serial, token, method: 'DELETE' })).result.statusCode).toBe(200);
  });

  test('401 for a bad token, a wrong type, an unknown serial, a bad device id and a bad push token', async () => {
    const fixture = createApiFixture();
    const serial = await fixture.issue(SUB);
    const token = await fixture.authToken(serial);
    const cases: RegOptions[] = [
      { serial },
      { serial, token: 'x'.repeat(43) },
      { serial, token, type: 'pass.other' },
      { serial: serialOf(99), token },
      { serial: 'nope', token },
      { serial, token, device: 'bad id!' },
      { serial, token, body: { pushToken: 'not hex' } },
      { serial, token, device: 'bad id!', method: 'DELETE' },
      { serial, token: 'short', method: 'DELETE' },
    ];
    for (const options of cases) {
      const reply = await reg(fixture, options);
      expect(reply.result.statusCode).toBe(401);
      expect(reply.json).toEqual(UNAUTHORIZED);
    }
    expect(devItems(fixture)).toHaveLength(0);
    const noParams = await fixture.callPasskit({ method: 'POST', resource: REG, body: {} });
    expect(noParams.result.statusCode).toBe(401);
  });

  test('204 for an unknown device, another pass type, and nothing updated', async () => {
    const fixture = createApiFixture();
    const serial = await fixture.issue(SUB);
    expect((await list(fixture, 'device-library-0001')).result.statusCode).toBe(204);
    await reg(fixture, { serial, token: await fixture.authToken(serial) });
    expect(
      (await list(fixture, 'device-library-0001', undefined, 'pass.other')).result.statusCode,
    ).toBe(204);
    expect((await list(fixture, 'bad id!')).result.statusCode).toBe(204);
    const all = await list(fixture, 'device-library-0001');
    expect(all.result.statusCode).toBe(200);
    const rec = await fixture.deps.passes.get(serial, fixture.clock.now());
    expect(all.json).toEqual({ serialNumbers: [serial], lastUpdated: String(rec?.updateTagMs) });
    // The pass at the tag itself is listed again (its fetch answers 304); one millisecond later
    // nothing has changed.
    expect(
      (await list(fixture, 'device-library-0001', String(rec?.updateTagMs))).result.statusCode,
    ).toBe(200);
    expect(
      (await list(fixture, 'device-library-0001', String((rec?.updateTagMs ?? 0) + 1))).result
        .statusCode,
    ).toBe(204);
    expect((await fixture.callPasskit({ method: 'GET', resource: LIST })).result.statusCode).toBe(
      204,
    );
  });

  test('304 when not modified, 200 with the pass and Last-Modified otherwise, 401 for a bad token', async () => {
    const fixture = createApiFixture();
    const serial = await fixture.issue(SUB);
    const token = await fixture.authToken(serial);
    const rec = await fixture.deps.passes.get(serial, fixture.clock.now());
    const modified = new Date(rec?.lastUpdatedMs ?? 0).toUTCString();
    const fresh = await latest(fixture, serial, token);
    expect(fresh.result.statusCode).toBe(200);
    expect(fresh.result.headers['last-modified']).toBe(modified);
    expect(fresh.result.headers['content-type']).toBe('application/vnd.apple.pkpass');
    const notModified = await latest(fixture, serial, token, modified);
    expect(notModified.result.statusCode).toBe(304);
    expect(notModified.result.body).toBe('');
    expect((await latest(fixture, serial, 'z'.repeat(43), modified)).result.statusCode).toBe(401);
    expect((await latest(fixture, serial)).json).toEqual(UNAUTHORIZED);
  });

  test('200 for log messages, counted and never stored', async () => {
    const fixture = createApiFixture();
    const reply = await fixture.callPasskit({
      method: 'POST',
      resource: '/api/passkit/v1/log',
      body: { logs: ['NEEDLE one', 'two', 'three'] },
    });
    expect(reply.result.statusCode).toBe(200);
    expect(lastLog(fixture.capture).PasskitLogMessages).toBe(3);
    expect(fixture.capture.lines.join('\n')).not.toContain('NEEDLE');
    expect(fixture.table.snapshot()).toEqual([]);
    const bad = await fixture.callPasskit({
      method: 'POST',
      resource: '/api/passkit/v1/log',
      body: 'not json',
    });
    expect(bad.result.statusCode).toBe(200);
    expect(lastLog(fixture.capture).PasskitLogMessages).toBeUndefined();
  });

  test('a signed pass carries the same Auth_Token the request presented', async () => {
    const fixture = createApiFixture({
      secrets: { apple: appleSecretFromPki() },
      signer: (secrets) =>
        createPassSigner(secrets, {
          log: () => undefined,
          info: () => undefined,
          warn: () => undefined,
          error: () => undefined,
          debug: () => undefined,
        }),
    });
    const serial = await fixture.issue(SUB);
    const token = await fixture.authToken(serial);
    const reply = await latest(fixture, serial, token);
    const files = zipMap(Buffer.from(reply.result.body, 'base64'));
    const json = JSON.parse(String(files.get('pass.json'))) as Record<string, unknown>;
    expect(json.authenticationToken).toBe(token);
    expect(json.webServiceURL).toBe('https://d111111abcdef8.cloudfront.net/api/passkit');
  });

  test('a voided pass is listed so the device fetches the voided version', async () => {
    const fixture = createApiFixture();
    const serial = await fixture.issue(SUB);
    const token = await fixture.authToken(serial);
    await reg(fixture, { serial, token });
    const before = await list(fixture, 'device-library-0001');
    fixture.clock.advance(5000);
    await fixture.call({
      method: 'POST',
      resource: '/api/v1/passes/{serialNumber}/void',
      path: { serialNumber: serial },
      token: SUB,
    });
    const after = await list(
      fixture,
      'device-library-0001',
      (before.json as { lastUpdated: string }).lastUpdated,
    );
    expect(after.result.statusCode).toBe(200);
    const pass = await latest(fixture, serial, token);
    expect(JSON.parse(Buffer.from(pass.result.body, 'base64').toString())).toMatchObject({
      status: 'voided',
    });
  });

  test('at most ten devices are kept per pass: the eleventh gets 200 and is not stored', async () => {
    const fixture = createApiFixture();
    const serial = await fixture.issue(SUB);
    const token = await fixture.authToken(serial);
    for (let i = 0; i < 10; i += 1) {
      expect(
        (
          await reg(fixture, {
            serial,
            token,
            device: `device-library-${String(i).padStart(4, '0')}`,
          })
        ).result.statusCode,
      ).toBe(201);
    }
    const eleventh = await reg(fixture, { serial, token, device: 'device-library-0010' });
    expect(eleventh.result.statusCode).toBe(200);
    expect(devItems(fixture)).toHaveLength(10);
    const refresh = await reg(fixture, {
      serial,
      token,
      device: 'device-library-0003',
      body: { pushToken: 'abab' },
    });
    expect(refresh.result.statusCode).toBe(200);
    expect(devItems(fixture).find((item) => item.pushToken === 'abab')).toBeDefined();
  });
});

describe('Feature: pass-service, PassKit properties', () => {
  // Feature: pass-service, Property 15: The Auth_Token is derived, verifiable and never stored
  test('Property 15: the ApplePass check accepts exactly the derived token, and only its hash is stored', async () => {
    const fixture = createApiFixture();
    const serialA = await fixture.issue(SUB);
    const serialB = await fixture.issue(SUB, samplePassFields({ sessionCode: 'OTH101' }));
    const tokenA = await fixture.authToken(serialA);
    const tokenB = await fixture.authToken(serialB);
    expect(tokenA).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenA).not.toBe(tokenB);
    for (const item of fixture.table.snapshot()) {
      expect(JSON.stringify(item)).not.toContain(tokenA);
      expect(JSON.stringify(item)).not.toContain(tokenB);
    }
    expect(
      fixture.table.snapshot().find((item) => item.pk === `PASS#${serialA}`)?.authTokenHash,
    ).toBe(sha256Hex(tokenA));
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.integer({ min: 0, max: 42 }).map((i) => ({ kind: 'flip' as const, i })),
          fc.integer({ min: 1, max: 42 }).map((i) => ({ kind: 'cut' as const, i })),
          fc.constant({ kind: 'extend' as const, i: 0 }),
          fc.constant({ kind: 'other' as const, i: 0 }),
          fc.constant({ kind: 'same' as const, i: 0 }),
        ),
        async (mutation) => {
          let token = tokenA;
          if (mutation.kind === 'flip') {
            token = `${tokenA.slice(0, mutation.i)}${tokenA[mutation.i] === 'A' ? 'B' : 'A'}${tokenA.slice(mutation.i + 1)}`;
          } else if (mutation.kind === 'cut') {
            token = tokenA.slice(0, mutation.i);
          } else if (mutation.kind === 'extend') {
            token = `${tokenA}A`;
          } else if (mutation.kind === 'other') {
            token = tokenB;
          }
          const reply = await latest(fixture, serialA, token);
          expect(reply.result.statusCode).toBe(mutation.kind === 'same' ? 200 : 401);
        },
      ),
      { numRuns: 100 },
    );
    expect(deriveAuthToken(fixture.secrets.appSecret.pepper, serialA, 'x')).toHaveLength(43);
  });

  // Feature: pass-service, Property 29: Registration follows Apple's state machine
  test("Property 29: registration follows Apple's state machine against a reference model", async () => {
    const opArb = fc.record({
      kind: fc.constantFrom('register', 'unregister'),
      device: fc.constantFrom('d1', 'd2', 'd3'),
      serial: fc.constantFrom('s1', 's2', 'ghost'),
      token: fc.constantFrom('good', 'good', 'good', 'wrong', 'missing'),
      type: fc.constantFrom('right', 'right', 'right', 'wrong'),
      push: fc.constantFrom('valid', 'valid', 'valid', 'bad'),
      deviceId: fc.constantFrom('normal', 'normal', 'normal', 'bad'),
      pushToken: fc.stringMatching(/^[0-9a-f]{8}$/),
    });
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 25 }), async (ops) => {
        const fixture = createApiFixture();
        const serials = {
          s1: await fixture.issue(SUB),
          s2: await fixture.issue(SUB, samplePassFields({ sessionCode: 'OTH101' })),
          ghost: serialOf(77),
        };
        const tokens = {
          s1: await fixture.authToken(serials.s1),
          s2: await fixture.authToken(serials.s2),
        };
        const model = new Map<string, string>();
        for (const op of ops) {
          const serial = serials[op.serial];
          const own = op.serial === 's2' ? tokens.s2 : tokens.s1;
          const other = op.serial === 's1' ? tokens.s2 : tokens.s1;
          const token = op.token === 'missing' ? undefined : op.token === 'good' ? own : other;
          const deviceId = op.deviceId === 'normal' ? `library-identifier-${op.device}` : 'bad id!';
          const valid =
            op.token === 'good' &&
            op.serial !== 'ghost' &&
            op.type === 'right' &&
            op.deviceId === 'normal' &&
            (op.kind === 'unregister' || op.push === 'valid');
          const reply = await reg(fixture, {
            serial,
            token,
            device: deviceId,
            type: op.type === 'right' ? TYPE : 'pass.other',
            method: op.kind === 'register' ? 'POST' : 'DELETE',
            body: { pushToken: op.push === 'valid' ? op.pushToken : 'not hex' },
          });
          const key = `${deviceId}|${serial}`;
          if (!valid) {
            expect(reply.result.statusCode).toBe(401);
            expect(reply.json).toEqual(UNAUTHORIZED);
          } else if (op.kind === 'register') {
            expect(reply.result.statusCode).toBe(model.has(key) ? 200 : 201);
            model.set(key, op.pushToken);
          } else {
            expect(reply.result.statusCode).toBe(200);
            model.delete(key);
          }
          const pepper = fixture.secrets.appSecret.pepper;
          const expected = [...model.entries()]
            .map(([k, push]) => {
              const [id, s] = k.split('|') as [string, string];
              return `${deviceHash(pepper, id)}|${s}|${push}`;
            })
            .sort();
          const stored = devItems(fixture)
            .map((item) => [item.deviceHash, item.serialNumber, item.pushToken].join('|'))
            .sort();
          expect(stored).toEqual(expected);
        }
        expect(JSON.stringify(fixture.table.snapshot())).not.toContain('lib-d');
      }),
      { numRuns: 60 },
    );
  });

  // Feature: pass-service, Property 30: The updatable list is exact
  test('Property 30: the updatable list is exact', async () => {
    const specArb = fc.record({
      lastSeconds: fc.integer({ min: 1, max: 1000 }),
      expired: fc.boolean(),
      registered: fc.boolean(),
      otherDevice: fc.boolean(),
      expiredRegistration: fc.boolean(),
      voided: fc.boolean(),
      otherType: fc.boolean(),
    });
    const sinceArb = fc.oneof(
      fc.constant(undefined),
      fc.constantFrom('', 'abc', '-5', '1.5', '12345678901234567', ' 5'),
      fc.integer({ min: 0, max: 1_100_000 }).map(String),
    );
    await fc.assert(
      fc.asyncProperty(fc.array(specArb, { maxLength: 8 }), sinceArb, async (specs, since) => {
        const fixture = createApiFixture();
        const now = fixture.clock.now();
        const pepper = fixture.secrets.appSecret.pepper;
        const expected: { serial: string; last: number }[] = [];
        for (const [i, spec] of specs.entries()) {
          const serial = serialOf(i + 1);
          const last = spec.lastSeconds * 1000;
          await fixture.deps.passes.create(
            makePassRecord(SUB, serial, {
              lastUpdatedMs: last,
              updateTagMs: last,
              status: spec.voided ? 'voided' : 'active',
              expiresAtMs: spec.expired ? now - 1 : now + 3_600_000,
            }),
          );
          if (spec.registered) {
            await fixture.deps.registrations.register(
              {
                deviceHash: deviceHash(
                  pepper,
                  spec.otherDevice ? 'other-library-000001' : 'library-0000000001',
                ),
                serialNumber: serial,
                passTypeIdentifier: spec.otherType ? 'pass.other' : TYPE,
                pushToken: 'aabb',
                subHash: SUB,
                pepperId: 'test-1',
                expiresAtMs: spec.expiredRegistration ? now - 1 : now + 3_600_000,
                ttl: 0,
              },
              now,
            );
          }
          const sinceMs = since !== undefined && /^\d{1,16}$/.test(since) ? Number(since) : 0;
          if (
            spec.registered &&
            !spec.otherDevice &&
            !spec.otherType &&
            !spec.expiredRegistration &&
            !spec.expired &&
            last >= sinceMs
          ) {
            expected.push({ serial, last });
          }
        }
        const reply = await list(fixture, 'library-0000000001', since);
        if (expected.length === 0) {
          expect(reply.result.statusCode).toBe(204);
          expect(reply.result.body).toBe('');
        } else {
          expect(reply.result.statusCode).toBe(200);
          const body = reply.json as { serialNumbers: string[]; lastUpdated: string };
          expect([...body.serialNumbers].sort()).toEqual(expected.map((e) => e.serial).sort());
          expect(body.lastUpdated).toBe(String(Math.max(...expected.map((e) => e.last))));
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: pass-service, Property 31: The latest pass honours If-Modified-Since
  test('Property 31: the latest pass honours If-Modified-Since at second precision', async () => {
    const imsArb = fc.oneof(
      fc.constant({ kind: 'absent' as const }),
      fc
        .constantFrom('', 'yesterday', '2026-99-99', 'Wed, 99 Foo 2026')
        .map((text) => ({ kind: 'text' as const, text })),
      fc.integer({ min: -4000, max: 4000 }).map((deltaMs) => ({ kind: 'delta' as const, deltaMs })),
    );
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1_000, max: 1_000_000 }).map((s) => s * 1000),
        imsArb,
        fc.boolean(),
        async (lastUpdatedMs, ims, authorised) => {
          const fixture = createApiFixture();
          const serial = await fixture.issue(SUB);
          const rec = await fixture.deps.passes.get(serial, fixture.clock.now());
          await fixture.table.set({ pk: `PASS#${serial}`, sk: 'PASS' }, { lastUpdatedMs });
          const token = await fixture.authToken(serial);
          const header =
            ims.kind === 'absent'
              ? undefined
              : ims.kind === 'text'
                ? ims.text
                : new Date(lastUpdatedMs + ims.deltaMs).toUTCString();
          const reply = await latest(fixture, serial, authorised ? token : 'y'.repeat(43), header);
          if (!authorised) {
            expect(reply.result.statusCode).toBe(401);
            return;
          }
          const parsed = header === undefined ? Number.NaN : Date.parse(header);
          const notModified =
            !Number.isNaN(parsed) && Math.floor(parsed / 1000) >= lastUpdatedMs / 1000;
          expect(reply.result.statusCode).toBe(notModified ? 304 : 200);
          if (notModified) {
            expect(reply.result.body).toBe('');
          } else {
            expect(reply.result.headers['last-modified']).toBe(
              new Date(lastUpdatedMs).toUTCString(),
            );
          }
          expect(rec).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Feature: pass-service, PassKit missing path values', () => {
  test('a registration without a device library identifier is the 401', async () => {
    const fixture = createApiFixture();
    const serial = await fixture.issue(SUB);
    const token = await fixture.authToken(serial);
    for (const method of ['POST', 'DELETE']) {
      const reply = await fixture.callPasskit({
        method,
        resource: REG,
        path: { passTypeIdentifier: TYPE, serialNumber: serial },
        headers: { authorization: `ApplePass ${token}` },
        body: { pushToken: 'aabb' },
      });
      expect(reply.result.statusCode).toBe(401);
    }
  });
});

describe('Feature: pass-service, update then list race', () => {
  async function twoRegistered() {
    const fixture = createApiFixture();
    const serials: string[] = [];
    for (const code of ['AAA101', 'BBB202']) {
      const serial = await fixture.issue(SUB, samplePassFields({ sessionCode: code }));
      const token = await fixture.authToken(serial);
      await reg(fixture, { serial, token });
      serials.push(serial);
    }
    return { fixture, serials };
  }

  const change = (fixture: ApiFixture, serial: string, code: string, room: string) =>
    fixture.call({
      method: 'PUT',
      resource: '/api/v1/passes/{serialNumber}',
      path: { serialNumber: serial },
      token: SUB,
      body: samplePassFields({ sessionCode: code, room }),
    });

  test('a second pass changed in the same second as the previous list is still listed', async () => {
    const { fixture, serials } = await twoRegistered();
    fixture.clock.advance(5000);
    await change(fixture, serials[0] as string, 'AAA101', 'Room 1');
    const first = await list(fixture, 'device-library-0001', '0');
    const tag = (first.json as { lastUpdated: string }).lastUpdated;
    await change(fixture, serials[1] as string, 'BBB202', 'Room 2');
    const second = await list(fixture, 'device-library-0001', tag);
    expect(second.result.statusCode).toBe(200);
    expect((second.json as { serialNumbers: string[] }).serialNumbers).toContain(serials[1]);
  });

  test('changes a millisecond apart inside one second are told apart by the tag', async () => {
    const { fixture, serials } = await twoRegistered();
    fixture.clock.advance(5000);
    await change(fixture, serials[0] as string, 'AAA101', 'Room 1');
    const tag = (await list(fixture, 'device-library-0001', '0')).json as { lastUpdated: string };
    fixture.clock.advance(1);
    await change(fixture, serials[1] as string, 'BBB202', 'Room 2');
    const second = await list(fixture, 'device-library-0001', String(Number(tag.lastUpdated) + 1));
    expect((second.json as { serialNumbers: string[] }).serialNumbers).toEqual([serials[1]]);
  });

  test('Last-Modified keeps second precision', async () => {
    const { fixture, serials } = await twoRegistered();
    fixture.clock.advance(5432);
    await change(fixture, serials[0] as string, 'AAA101', 'Room 1');
    const token = await fixture.authToken(serials[0] as string);
    const reply = await latest(fixture, serials[0] as string, token);
    const modified = reply.result.headers['last-modified'] ?? '';
    expect(Date.parse(modified) % 1000).toBe(0);
  });
});

describe('Feature: pass-service, device library identifier length', () => {
  test('an identifier shorter than 16 characters is refused with the 401', async () => {
    const fixture = createApiFixture();
    const serial = await fixture.issue(SUB);
    const token = await fixture.authToken(serial);
    for (const device of ['short', 'a'.repeat(15)]) {
      for (const method of ['POST', 'DELETE'] as const) {
        const reply = await reg(fixture, { serial, token, device, method });
        expect(reply.result.statusCode).toBe(401);
      }
    }
    expect((await reg(fixture, { serial, token, device: 'a'.repeat(16) })).result.statusCode).toBe(
      201,
    );
    expect((await reg(fixture, { serial, token, device: 'a'.repeat(129) })).result.statusCode).toBe(
      401,
    );
  });
});
