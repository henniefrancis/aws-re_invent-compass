import { createHash } from 'node:crypto';
import ICAL from 'ical.js';
import fc from 'fast-check';
import { describe, expect, test, vi } from 'vitest';
import { createApiFixture, lastLog, type ApiFixture, type Reply } from '../helpers/api-fixture.js';
import { makePassRecord, serialOf } from '../helpers/pass-record.js';
import { passFieldsArb, samplePassFields } from '../helpers/pass-fields.js';

const SUB = 'e'.repeat(64);
const OTHER = 'f'.repeat(64);
const MINUTE = 60_000;
const HANDOFF_ID = /^[A-Za-z0-9_-]{22}$/;
const ALL = { apple: true, google: true, calendar: true };

const create = (fixture: ApiFixture, serialNumbers: string[], include = ALL, token = SUB) =>
  fixture.call({
    method: 'POST',
    resource: '/api/v1/handoffs',
    token,
    body: { serialNumbers, include },
  });
const view = (fixture: ApiFixture, id: string) =>
  fixture.call({
    method: 'GET',
    resource: '/api/v1/handoffs/{handoffId}',
    path: { handoffId: id },
  });
const bundle = (fixture: ApiFixture, id: string, index: string) =>
  fixture.call({
    method: 'GET',
    resource: '/api/v1/handoffs/{handoffId}/apple/{bundleIndex}',
    path: { handoffId: id, bundleIndex: index },
  });
const calendar = (fixture: ApiFixture, id: string) =>
  fixture.call({
    method: 'GET',
    resource: '/api/v1/handoffs/{handoffId}/calendar.ics',
    path: { handoffId: id },
  });

interface ViewBody {
  expiresAt: string;
  sessions: { serialNumber: string; sessionCode: string; title: string; startsAt: string }[];
  apple: { bundlePaths: string[] };
  google: { saveUrl: string } | null;
  calendarPath: string | null;
}

async function seed(
  fixture: ApiFixture,
  count: number,
  overrides: (i: number) => Parameters<typeof makePassRecord>[2] = () => ({}),
): Promise<string[]> {
  const serials: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const serial = serialOf(i + 1);
    await fixture.deps.passes.create(
      makePassRecord(SUB, serial, {
        fields: samplePassFields({ sessionCode: `SSS${String(100 + i)}`, title: `Talk ${i}` }),
        ...overrides(i),
      }),
    );
    serials.push(serial);
  }
  return serials;
}

async function createOk(fixture: ApiFixture, serials: string[], include = ALL): Promise<string> {
  const reply = await create(fixture, serials, include);
  expect(reply.result.statusCode).toBe(201);
  return (reply.json as { handoffId: string }).handoffId;
}

// Property tests do real work (signing, TLS, many records) and the machine may be busy.
vi.setConfig({ testTimeout: 120_000 });

describe('Feature: pass-service, hand-off creation', () => {
  // Feature: pass-service, Property 24: Hand-off creation stores only a hash and a 15-minute expiry
  test('Property 24: stores only a hash, the choices and a 15-minute expiry', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 12 }),
        fc
          .record({ apple: fc.boolean(), google: fc.boolean(), calendar: fc.boolean() })
          .filter((flags) => flags.apple || flags.google || flags.calendar),
        async (count, include) => {
          const fixture = createApiFixture();
          const serials = await seed(fixture, count);
          const now = fixture.clock.now();
          const reply = await create(fixture, serials, include);
          expect(reply.result.statusCode).toBe(201);
          const body = reply.json as { handoffId: string; boardUrl: string; expiresAt: string };
          expect(body.handoffId).toMatch(HANDOFF_ID);
          expect(body.boardUrl).toBe(
            `https://d111111abcdef8.cloudfront.net/board#h=${body.handoffId}`,
          );
          expect(body.expiresAt).toBe(new Date(now + 15 * MINUTE).toISOString());
          const hash = createHash('sha256').update(body.handoffId).digest('hex');
          const items = fixture.table.snapshot().filter((item) => item.pk.startsWith('HANDOFF#'));
          expect(items).toHaveLength(1);
          const item = items[0]!;
          expect(item.pk).toBe(`HANDOFF#${hash}`);
          expect(item).toMatchObject({
            serialNumbers: serials,
            include,
            subHash: SUB,
            expiresAtMs: now + 15 * MINUTE,
          });
          expect(Number(item.ttl)).toBeGreaterThanOrEqual((now + 15 * MINUTE) / 1000);
          expect(JSON.stringify(item)).not.toContain(body.handoffId);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: pass-service, Property 25: Hand-off creation refuses foreign serials uniformly
  test('Property 25: any foreign, unknown, expired or voided serial is the same 400 and consumes nothing', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('foreign', 'unknown', 'voided', 'expired'),
        fc.integer({ min: 0, max: 3 }),
        async (kind, position) => {
          const fixture = createApiFixture();
          const good = await seed(fixture, 4);
          const bad = serialOf(50);
          if (kind === 'foreign') {
            await fixture.deps.passes.create(makePassRecord(OTHER, bad));
          } else if (kind === 'voided') {
            await fixture.deps.passes.create(makePassRecord(SUB, bad, { status: 'voided' }));
          } else if (kind === 'expired') {
            await fixture.deps.passes.create(
              makePassRecord(SUB, bad, { expiresAtMs: fixture.clock.now() - 1 }),
            );
          }
          const serials = [...good];
          serials[position] = bad;
          const reply = await create(fixture, serials);
          expect(reply.result.statusCode).toBe(400);
          expect(reply.json).toEqual({
            type: 'about:blank',
            title: 'Bad Request',
            status: 400,
            code: 'invalid_request',
          });
          expect(fixture.table.snapshot().some((i) => i.pk.startsWith('HANDOFF#'))).toBe(false);
          expect(fixture.table.snapshot().some((i) => i.pk.startsWith('RATE#'))).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
    const fixture = createApiFixture();
    const serials = await seed(fixture, 1);
    const none = await create(fixture, serials, { apple: false, google: false, calendar: false });
    expect(none.result.statusCode).toBe(400);
    const anonymous = await fixture.call({
      method: 'POST',
      resource: '/api/v1/handoffs',
      body: { serialNumbers: serials, include: ALL },
    });
    expect(anonymous.result.statusCode).toBe(401);
  });

  test('the 11th hand-off in an hour is 429 with Retry-After', async () => {
    const fixture = createApiFixture();
    const serials = await seed(fixture, 1);
    for (let i = 0; i < 10; i += 1) {
      expect((await create(fixture, serials)).result.statusCode).toBe(201);
    }
    const refused = await create(fixture, serials);
    expect(refused.result.statusCode).toBe(429);
    expect(refused.json).toMatchObject({ code: 'rate_limited' });
    expect(Number(refused.result.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(fixture.table.snapshot().filter((i) => i.pk.startsWith('HANDOFF#'))).toHaveLength(10);
  });
});

describe('Feature: pass-service, hand-off view and downloads', () => {
  // Feature: pass-service, Property 26: The hand-off view lists exactly the active passes and their bundles
  test('Property 26: the view lists exactly the active passes, their bundles and the Google link', async () => {
    const stateArb = fc.constantFrom('active', 'voided', 'expired');
    const platformsArb = fc.constantFrom<('apple' | 'google')[]>(
      ['apple'],
      ['google'],
      ['apple', 'google'],
    );
    const googleArb = fc.constantFrom<'none' | 'active'>('none', 'active');
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(stateArb, platformsArb, googleArb), { minLength: 1, maxLength: 25 }),
        fc
          .record({ apple: fc.boolean(), google: fc.boolean(), calendar: fc.boolean() })
          .filter((flags) => flags.apple || flags.google || flags.calendar),
        fc.boolean(),
        async (specs, include, googleEnabled) => {
          const fixture = createApiFixture(
            googleEnabled
              ? {}
              : { env: { GOOGLE_WALLET_ENABLED: 'false', GOOGLE_SECRET_ID: undefined } },
          );
          const now = fixture.clock.now();
          const serials = await seed(fixture, specs.length, (i) => ({
            platforms: specs[i]![1],
            googleState: specs[i]![2],
            expiresAtMs: now + 10 * MINUTE,
          }));
          const id = await createOk(fixture, serials, include);
          // State changes after creation, inside the 15 minutes.
          for (const [i, [state]] of specs.entries()) {
            if (state === 'voided') {
              const rec = await fixture.deps.passes.get(serials[i]!, now);
              await fixture.deps.passes.save({ ...rec!, status: 'voided', version: 2 }, 1);
            }
          }
          const expiredAny = specs.some(([state]) => state === 'expired');
          if (expiredAny) {
            for (const [i, [state]] of specs.entries()) {
              if (state === 'expired') {
                await fixture.table.set(
                  { pk: `PASS#${serials[i]}`, sk: 'PASS' },
                  { expiresAtMs: now + 5 * MINUTE },
                );
              }
            }
            fixture.clock.advance(6 * MINUTE);
          }
          const reply = await view(fixture, id);
          expect(reply.result.statusCode).toBe(200);
          const body = reply.json as ViewBody;
          const activeIdx = specs.flatMap(([state], i) => (state === 'active' ? [i] : []));
          expect(body.sessions.map((s) => s.serialNumber)).toEqual(
            activeIdx.map((i) => serials[i]),
          );
          const appleIdx = activeIdx.filter((i) => specs[i]![1].includes('apple'));
          const expectedBundles = include.apple ? Math.ceil(appleIdx.length / 10) : 0;
          expect(body.apple.bundlePaths).toEqual(
            Array.from({ length: expectedBundles }, (_, i) => `/api/v1/handoffs/${id}/apple/${i}`),
          );
          const union: string[] = [];
          for (let i = 0; i < expectedBundles; i += 1) {
            const download = await bundle(fixture, id, String(i));
            expect(download.result.statusCode).toBe(200);
            expect(download.result.headers['content-type']).toBe('application/vnd.apple.pkpasses');
            const chunk = (
              JSON.parse(Buffer.from(download.result.body, 'base64').toString()) as {
                bundle: string[];
              }
            ).bundle;
            expect(chunk.length).toBeLessThanOrEqual(10);
            union.push(...chunk);
          }
          expect(union).toEqual(include.apple ? appleIdx.map((i) => serials[i]) : []);
          expect((await bundle(fixture, id, String(expectedBundles))).result.statusCode).toBe(404);
          const withObject = activeIdx.filter((i) => specs[i]![2] === 'active');
          const wantsGoogle = include.google && googleEnabled && withObject.length > 0;
          if (wantsGoogle) {
            expect(body.google).toEqual({
              saveUrl: `https://pay.google.com/gp/v/save/fake-${withObject.length}`,
            });
            const sent = fixture.google.saveUrls.at(-1)!.objects;
            expect(sent.map((o) => o.id.split('.')[1])).toEqual(withObject.map((i) => serials[i]));
          } else {
            expect(body.google).toBeNull();
          }
          expect(body.calendarPath).toBe(
            include.calendar ? `/api/v1/handoffs/${id}/calendar.ics` : null,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  test('an oversize save link is counted', async () => {
    const fixture = createApiFixture();
    const serials = await seed(fixture, 1, () => ({
      platforms: ['google'],
      googleState: 'active',
    }));
    fixture.google.oversize = true;
    const id = await createOk(fixture, serials);
    await view(fixture, id);
    expect(lastLog(fixture.capture).GoogleSaveJwtOversize).toBe(1);
  });

  test('a bundle index that is not a number is the same 404', async () => {
    const fixture = createApiFixture();
    const id = await createOk(fixture, await seed(fixture, 1));
    for (const index of ['x', '-1', '1.5', '', '1234567', '00', '01', '007']) {
      expect((await bundle(fixture, id, index)).result.statusCode).toBe(404);
    }
    const noParams = await fixture.call({
      method: 'GET',
      resource: '/api/v1/handoffs/{handoffId}/apple/{bundleIndex}',
    });
    expect(noParams.result.statusCode).toBe(404);
    const noId = await fixture.call({
      method: 'GET',
      resource: '/api/v1/handoffs/{handoffId}/apple/{bundleIndex}',
      path: { bundleIndex: '0' },
    });
    expect(noId.result.statusCode).toBe(404);
    expect(
      (await fixture.call({ method: 'GET', resource: '/api/v1/handoffs/{handoffId}' })).result
        .statusCode,
    ).toBe(404);
    expect(
      (await fixture.call({ method: 'GET', resource: '/api/v1/handoffs/{handoffId}/calendar.ics' }))
        .result.statusCode,
    ).toBe(404);
  });

  test('a bundle needs Apple to have been included', async () => {
    const fixture = createApiFixture();
    const id = await createOk(fixture, await seed(fixture, 1), {
      apple: false,
      google: false,
      calendar: true,
    });
    expect((await bundle(fixture, id, '0')).result.statusCode).toBe(404);
  });

  test('reads are capped at 30 per hand-off, then the same 404', async () => {
    const fixture = createApiFixture();
    const id = await createOk(fixture, await seed(fixture, 1));
    for (let i = 0; i < 30; i += 1) {
      expect((await view(fixture, id)).result.statusCode).toBe(200);
    }
    expect((await view(fixture, id)).result.statusCode).toBe(404);
    expect((await bundle(fixture, id, '0')).result.statusCode).toBe(404);
  });

  // Feature: pass-service, Property 27: Unknown and expired hand-offs look the same
  test('Property 27: unknown, malformed and expired ids are one byte-identical 404', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.constant('live'),
          fc.constant('unknown'),
          fc.string({ maxLength: 30 }),
          fc.stringMatching(/^[A-Za-z0-9_-]{22}$/),
        ),
        fc.integer({ min: -2, max: 3 }),
        fc.integer({ min: 0, max: 5 }),
        async (kind, offsetMinutes, index) => {
          const fixture = createApiFixture();
          const live = await createOk(fixture, await seed(fixture, 2));
          const reference = await view(fixture, 'AAAAAAAAAAAAAAAAAAAAAA');
          expect(reference.result.statusCode).toBe(404);
          const id = kind === 'live' ? live : kind === 'unknown' ? 'BBBBBBBBBBBBBBBBBBBBBB' : kind;
          fixture.clock.advance(14 * MINUTE + 59_000 + offsetMinutes * MINUTE);
          const stillLive = kind === 'live' && offsetMinutes <= 0;
          const replies: Reply[] = [
            await view(fixture, id),
            await bundle(fixture, id, String(index)),
            await calendar(fixture, id),
          ];
          for (const reply of replies) {
            if (stillLive && reply.result.statusCode === 200) {
              continue;
            }
            expect(reply.result).toEqual(reference.result);
          }
          if (stillLive) {
            expect(replies[0]?.result.statusCode).toBe(200);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  test('a hand-off read at 14 minutes 59 seconds works and at exactly 15 minutes is the unknown-id 404', async () => {
    const fixture = createApiFixture();
    const id = await createOk(fixture, await seed(fixture, 1));
    fixture.clock.advance(14 * MINUTE + 59_000);
    expect((await view(fixture, id)).result.statusCode).toBe(200);
    fixture.clock.advance(1000);
    const expired = await view(fixture, id);
    expect(expired.result).toEqual((await view(fixture, 'CCCCCCCCCCCCCCCCCCCCCC')).result);
    expect(fixture.table.snapshot().some((i) => i.pk.startsWith('HANDOFF#'))).toBe(true);
  });
});

describe('Feature: pass-service, hand-off response headers', () => {
  test('every hand-off response is no-store, and the downloads are attachments with fixed names', async () => {
    const fixture = createApiFixture();
    const id = await createOk(fixture, await seed(fixture, 1));
    const json = await view(fixture, id);
    const zip = await bundle(fixture, id, '0');
    const ics = await calendar(fixture, id);
    for (const reply of [json, zip, ics]) {
      expect(reply.result.statusCode).toBe(200);
      expect(reply.result.headers['cache-control']).toBe('no-store');
      expect(reply.result.headers['x-content-type-options']).toBe('nosniff');
      expect(reply.result.headers['referrer-policy']).toBe('no-referrer');
    }
    expect(json.result.headers['content-disposition']).toBeUndefined();
    expect(zip.result.headers['content-disposition']).toBe(
      'attachment; filename="reinvent-passes-1.pkpasses"',
    );
    expect(ics.result.headers['content-disposition']).toBe('attachment; filename="reinvent.ics"');
    const missing = await view(fixture, 'AAAAAAAAAAAAAAAAAAAAAA');
    expect(missing.result.headers['cache-control']).toBe('no-store');
  });
});

describe('Feature: pass-service, hand-off calendar', () => {
  // Feature: pass-service, Property 28: The hand-off calendar is valid RFC 5545
  test('Property 28: the calendar parses and holds one event per active pass with an alarm', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(passFieldsArb, { minLength: 1, maxLength: 8 }), async (list) => {
        const fixture = createApiFixture();
        const serials = await seed(fixture, list.length, (i) => ({
          fields: { ...list[i]!, sessionCode: `SSS${String(100 + i)}` },
        }));
        const id = await createOk(fixture, serials);
        const reply = await calendar(fixture, id);
        expect(reply.result.statusCode).toBe(200);
        expect(reply.result.headers['content-type']).toBe('text/calendar');
        expect(reply.result.isBase64Encoded).toBe(true);
        const text = Buffer.from(reply.result.body, 'base64').toString('utf8');
        const events = new ICAL.Component(ICAL.parse(text) as never).getAllSubcomponents('vevent');
        expect(events).toHaveLength(list.length);
        events.forEach((event, i) => {
          const vevent = new ICAL.Event(event);
          const fields = list[i]!;
          expect(vevent.uid).toBe(serials[i]);
          expect(vevent.startDate.toJSDate().getTime()).toBe(Date.parse(fields.startsAt));
          expect(vevent.endDate.toJSDate().getTime()).toBe(Date.parse(fields.endsAt));
          expect(String(event.getFirstPropertyValue('dtstart'))).toMatch(/Z$/);
          const alarm = event.getFirstSubcomponent('valarm');
          expect(alarm?.getFirstPropertyValue('action')).toBe('DISPLAY');
          expect(String(alarm?.getFirstPropertyValue('trigger'))).toBe('-PT10M');
          expect(String(event.getFirstPropertyValue('description'))).toContain(
            'Unofficial. Your badge is your ticket.',
          );
        });
      }),
      { numRuns: 100 },
    );
  });

  test('DTSTAMP comes from the injected clock, so the file is the same every time', async () => {
    const fixture = createApiFixture();
    const id = await createOk(fixture, await seed(fixture, 1));
    const read = async () =>
      Buffer.from((await calendar(fixture, id)).result.body, 'base64').toString('utf8');
    const first = await read();
    expect(first).toContain('DTSTAMP:20261129T000000Z');
    expect(await read()).toBe(first);
    fixture.clock.advance(5000);
    expect(await read()).toContain('DTSTAMP:20261129T000005Z');
  });

  test('with the calendar disabled the path is null and the route is 404 not_enabled', async () => {
    const fixture = createApiFixture({ env: { HANDOFF_CALENDAR_ENABLED: 'false' } });
    const id = await createOk(fixture, await seed(fixture, 1));
    expect(((await view(fixture, id)).json as ViewBody).calendarPath).toBeNull();
    const reply = await calendar(fixture, id);
    expect(reply.result.statusCode).toBe(404);
    expect(reply.json).toMatchObject({ code: 'not_enabled' });
    expect((await calendar(fixture, 'DDDDDDDDDDDDDDDDDDDDDD')).json).toMatchObject({
      code: 'not_found',
    });
  });

  test('a hand-off made without the calendar answers the same 404 as an unknown one', async () => {
    const fixture = createApiFixture();
    const id = await createOk(fixture, await seed(fixture, 1), {
      apple: true,
      google: false,
      calendar: false,
    });
    const reply = await calendar(fixture, id);
    expect(reply.json).toMatchObject({ code: 'not_found' });
  });

  test('empty venue and room read well in the location', async () => {
    const fixture = createApiFixture();
    const serials = await seed(fixture, 1, () => ({
      fields: samplePassFields({ venue: '', room: '' }),
    }));
    const id = await createOk(fixture, serials);
    const text = Buffer.from((await calendar(fixture, id)).result.body, 'base64').toString();
    expect(text).toContain('LOCATION:Venue not published');
  });
});
