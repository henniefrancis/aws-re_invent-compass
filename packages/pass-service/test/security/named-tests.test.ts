import { describe, expect, test, vi } from 'vitest';
import { createApiFixture, type ApiFixture } from '../helpers/api-fixture.js';
import { samplePassFields } from '../helpers/pass-fields.js';

vi.setConfig({ testTimeout: 120_000 });

const SUB = '2'.repeat(64);
const TYPE = 'pass.test.compass';
const HOUR = 3_600_000;
const REG =
  '/api/passkit/v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}/{serialNumber}';
const LIST = '/api/passkit/v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}';
const LATEST = '/api/passkit/v1/passes/{passTypeIdentifier}/{serialNumber}';
const ISSUE = { method: 'POST', resource: '/api/v1/passes', token: SUB } as const;
const body = (from: number, count: number) => ({
  platforms: ['apple'],
  passes: Array.from({ length: count }, (_, i) =>
    samplePassFields({ sessionCode: `NAM${from + i}` }),
  ),
});

async function registered(fixture: ApiFixture) {
  const serial = await fixture.issue(SUB, samplePassFields(), ['apple', 'google']);
  const token = await fixture.authToken(serial);
  const path = { deviceLibraryIdentifier: 'lib-1', passTypeIdentifier: TYPE, serialNumber: serial };
  const headers = { authorization: `ApplePass ${token}` };
  return { serial, token, path, headers };
}

describe('Feature: pass-service, named PassKit responses', () => {
  test('200 for an update fetch, a re-registration, an unregister and the log', async () => {
    const fixture = createApiFixture();
    const { path, headers, serial } = await registered(fixture);
    await fixture.callPasskit({
      method: 'POST',
      resource: REG,
      path,
      headers,
      body: { pushToken: 'aa' },
    });
    expect(
      (
        await fixture.callPasskit({
          method: 'POST',
          resource: REG,
          path,
          headers,
          body: { pushToken: 'bb' },
        })
      ).result.statusCode,
    ).toBe(200);
    expect(
      (
        await fixture.callPasskit({
          method: 'GET',
          resource: LATEST,
          path: { passTypeIdentifier: TYPE, serialNumber: serial },
          headers,
        })
      ).result.statusCode,
    ).toBe(200);
    expect(
      (await fixture.callPasskit({ method: 'DELETE', resource: REG, path, headers })).result
        .statusCode,
    ).toBe(200);
    expect(
      (
        await fixture.callPasskit({
          method: 'POST',
          resource: '/api/passkit/v1/log',
          body: { logs: [] },
        })
      ).result.statusCode,
    ).toBe(200);
  });

  test('201 for the first registration', async () => {
    const fixture = createApiFixture();
    const { path, headers } = await registered(fixture);
    expect(
      (
        await fixture.callPasskit({
          method: 'POST',
          resource: REG,
          path,
          headers,
          body: { pushToken: 'aa' },
        })
      ).result.statusCode,
    ).toBe(201);
  });

  test('204 when nothing changed', async () => {
    const fixture = createApiFixture();
    const { path } = await registered(fixture);
    expect(
      (await fixture.callPasskit({ method: 'GET', resource: LIST, path })).result.statusCode,
    ).toBe(204);
  });

  test('304 when the pass has not been modified', async () => {
    const fixture = createApiFixture();
    const { serial, headers } = await registered(fixture);
    const reply = await fixture.callPasskit({
      method: 'GET',
      resource: LATEST,
      path: { passTypeIdentifier: TYPE, serialNumber: serial },
      headers: {
        ...headers,
        'if-modified-since': new Date(fixture.clock.now() + HOUR).toUTCString(),
      },
    });
    expect(reply.result.statusCode).toBe(304);
  });

  test('401 for a token that does not match', async () => {
    const fixture = createApiFixture();
    const { path } = await registered(fixture);
    const reply = await fixture.callPasskit({
      method: 'POST',
      resource: REG,
      path,
      headers: { authorization: `ApplePass ${'q'.repeat(43)}` },
      body: { pushToken: 'aa' },
    });
    expect(reply.result.statusCode).toBe(401);
  });
});

describe('Feature: pass-service, named hand-off and limit tests', () => {
  test('a hand-off read at 14:59 works and at 15:00 is the unknown-id 404', async () => {
    const fixture = createApiFixture();
    const serial = await fixture.issue(SUB);
    const created = await fixture.call({
      method: 'POST',
      resource: '/api/v1/handoffs',
      token: SUB,
      body: { serialNumbers: [serial], include: { apple: true, google: false, calendar: false } },
    });
    const { handoffId } = created.json as { handoffId: string };
    const read = () =>
      fixture.call({
        method: 'GET',
        resource: '/api/v1/handoffs/{handoffId}',
        path: { handoffId },
      });
    fixture.clock.advance(14 * 60_000 + 59_000);
    expect((await read()).result.statusCode).toBe(200);
    fixture.clock.advance(1000);
    const gone = await read();
    const unknown = await fixture.call({
      method: 'GET',
      resource: '/api/v1/handoffs/{handoffId}',
      path: { handoffId: 'AAAAAAAAAAAAAAAAAAAAAA' },
    });
    expect(gone.result).toEqual(unknown.result);
  });

  test('429 after 60 pass writes, after 10 hand-offs, and on the 81st active pass', async () => {
    const fixture = createApiFixture();
    for (const [from, count] of [
      [100, 25],
      [200, 25],
      [300, 10],
    ] as const) {
      expect((await fixture.call({ ...ISSUE, body: body(from, count) })).result.statusCode).toBe(
        201,
      );
    }
    const limited = await fixture.call({ ...ISSUE, body: body(400, 1) });
    expect(limited.result.statusCode).toBe(429);
    expect(Number(limited.result.headers['retry-after'])).toBeGreaterThan(0);

    const handoffs = createApiFixture();
    const serial = await handoffs.issue(SUB);
    const request = {
      method: 'POST',
      resource: '/api/v1/handoffs',
      token: SUB,
      body: { serialNumbers: [serial], include: { apple: true, google: false, calendar: false } },
    };
    for (let i = 0; i < 10; i += 1) {
      await handoffs.call(request);
    }
    const eleventh = await handoffs.call(request);
    expect(eleventh.result.statusCode).toBe(429);
    expect(Number(eleventh.result.headers['retry-after'])).toBeGreaterThan(0);

    const capped = createApiFixture();
    for (const [from, count] of [
      [100, 25],
      [200, 25],
      [300, 25],
      [400, 5],
    ] as const) {
      await capped.call({ ...ISSUE, body: body(from, count) });
      capped.clock.advance(HOUR);
    }
    const eightyFirst = await capped.call({ ...ISSUE, body: body(500, 1) });
    expect(eightyFirst.json).toMatchObject({ code: 'active_pass_limit' });
  });

  test('PassFields rejection: a URL, a bare domain, U+202E, a control character, a date outside the window, an 81 character title', async () => {
    const fixture = createApiFixture();
    const bad = [
      { title: 'Go to https://example.test' },
      { title: 'Visit example.com' },
      { title: `Safe${String.fromCharCode(0x202e)}text` },
      { room: `Room${String.fromCharCode(7)}1` },
      { startsAt: '2027-05-01T10:00:00-08:00', endsAt: '2027-05-01T11:00:00-08:00' },
      { title: 'x'.repeat(81) },
    ];
    for (const change of bad) {
      const reply = await fixture.call({
        ...ISSUE,
        body: { platforms: ['apple'], passes: [samplePassFields(change)] },
      });
      expect(reply.result.statusCode).toBe(400);
    }
    expect(fixture.table.snapshot()).toEqual([]);
  });

  test('a void leads to an APNs push and a Google INACTIVE patch', async () => {
    const fixture = createApiFixture();
    const { serial, path, headers } = await registered(fixture);
    await fixture.callPasskit({
      method: 'POST',
      resource: REG,
      path,
      headers,
      body: { pushToken: 'aabb' },
    });
    await fixture.call({
      method: 'POST',
      resource: '/api/v1/passes/{serialNumber}/void',
      path: { serialNumber: serial },
      token: SUB,
    });
    expect(fixture.apns.calls.flat().map((t) => t.pushToken)).toEqual(['aabb']);
    expect(fixture.google.patches).toHaveLength(1);
    expect(fixture.google.patches[0]?.body).toEqual({ state: 'INACTIVE' });
  });

  test('every stored item carries a ttl at or after its expiry', async () => {
    const fixture = createApiFixture();
    const { path, headers, serial } = await registered(fixture);
    await fixture.callPasskit({
      method: 'POST',
      resource: REG,
      path,
      headers,
      body: { pushToken: 'aabb' },
    });
    await fixture.call({
      method: 'POST',
      resource: '/api/v1/handoffs',
      token: SUB,
      body: { serialNumbers: [serial], include: { apple: true, google: false, calendar: false } },
    });
    const items = fixture.table.snapshot();
    const kinds = new Set(items.map((item) => item.pk.split('#')[0]));
    expect([...kinds].sort()).toEqual(['DEV', 'HANDOFF', 'PASS', 'RATE']);
    for (const item of items) {
      expect(Number(item.ttl)).toBeGreaterThanOrEqual(Number(item.expiresAtMs) / 1000);
    }
  });
});
