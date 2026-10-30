import { createHash } from 'node:crypto';
import ICAL from 'ical.js';
import fc from 'fast-check';
import { describe, expect, test, vi } from 'vitest';
import { createApiFixture, lastLog, type ApiFixture, type Reply } from '../helpers/api-fixture.js';
import { makePassRecord, serialOf } from '../helpers/pass-record.js';
import { passFieldsArb, samplePassFields } from '../helpers/pass-fields.js';
import { VIEW_INSERT_BUDGET_MS } from '../../src/services/handoff-service.js';

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
const applePass = (fixture: ApiFixture, id: string, serial: string) =>
  fixture.call({
    method: 'GET',
    resource: '/api/v1/handoffs/{handoffId}/apple/pass/{serialNumber}',
    path: { handoffId: id, serialNumber: serial },
  });
const calendar = (fixture: ApiFixture, id: string) =>
  fixture.call({
    method: 'GET',
    resource: '/api/v1/handoffs/{handoffId}/calendar.ics',
    path: { handoffId: id },
  });

interface ViewBody {
  expiresAt: string;
  sessions: {
    serialNumber: string;
    sessionCode: string;
    title: string;
    startsAt: string;
    venue: string | null;
    applePath: string | null;
    googleSaveUrl: string | null;
  }[];
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
          // Eight sessions or fewer get the top actions only; more get the session actions only.
          const top = activeIdx.length <= 8;
          expect(body.apple.bundlePaths).toEqual(
            top
              ? Array.from(
                  { length: expectedBundles },
                  (_, i) => `/api/v1/handoffs/${id}/apple/${i}`,
                )
              : [],
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
          const sendsGoogle = include.google && googleEnabled;
          // A pass with Google chosen and no object yet is inserted when the view is read.
          const withObject = activeIdx.filter(
            (i) => specs[i]![2] === 'active' || (sendsGoogle && specs[i]![1].includes('google')),
          );
          // The top link needs every pass that wants Google to have an object, in one link.
          const wanting = activeIdx.filter((i) => specs[i]![1].includes('google'));
          const wantsGoogle = top && sendsGoogle && wanting.length > 0;
          if (wantsGoogle) {
            const first = serials[wanting[0]!];
            expect(body.google).toEqual({
              saveUrl: `https://pay.google.com/gp/v/save/fake-0-${wanting.length}-${first}`,
            });
          } else {
            expect(body.google).toBeNull();
          }
          expect(body.calendarPath).toBe(
            include.calendar ? `/api/v1/handoffs/${id}/calendar.ics` : null,
          );
          // Each session carries its own routes and link, only where the pass has them.
          for (const [n, i] of activeIdx.entries()) {
            const session = body.sessions[n]!;
            const serial = serials[i]!;
            expect(session.applePath).toBe(
              !top && include.apple && specs[i]![1].includes('apple')
                ? `/api/v1/handoffs/${id}/apple/pass/${serial}`
                : null,
            );
            expect(session.googleSaveUrl).toBe(
              !wantsGoogle && withObject.includes(i) && sendsGoogle
                ? `https://pay.google.com/gp/v/save/fake-0-1-${serial}`
                : null,
            );
          }
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

  test('reads are capped at 30 plus 2 for every pass in the hand-off, then the same 404', async () => {
    const fixture = createApiFixture();
    const id = await createOk(fixture, await seed(fixture, 1));
    for (let i = 0; i < 32; i += 1) {
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

  test('the view gives each session its venue, or null when the pass has none', async () => {
    const fixture = createApiFixture();
    const serials = await seed(fixture, 2, (n) => ({
      fields: samplePassFields({ venue: n === 0 ? 'The Venetian' : '', room: '' }),
    }));
    const id = await createOk(fixture, serials);
    const body = (await view(fixture, id)).json as ViewBody;
    expect(body.sessions.map((s) => s.venue)).toEqual(['The Venetian', null]);
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

describe('Feature: pass-service, Google links for each session and for all (tasks 48 and 50)', () => {
  const GOOGLE_ONLY = { apple: false, google: true, calendar: false };

  test('1 and 8 passes get only the top link; 9 and 12 get a link on every session and no top link', async () => {
    for (const [count, top] of [
      [1, true],
      [8, true],
      [9, false],
      [12, false],
    ] as const) {
      const fixture = createApiFixture();
      const serials = await seed(fixture, count, () => ({
        platforms: ['apple', 'google'],
        googleState: 'active',
      }));
      const id = await createOk(fixture, serials, GOOGLE_ONLY);
      const body = (await view(fixture, id)).json as ViewBody;
      const calls = fixture.google.saveUrls.map((c) => c.objects.length);
      if (top) {
        expect(body.google).toEqual({
          saveUrl: `https://pay.google.com/gp/v/save/fake-0-${count}-${serials[0]}`,
        });
        expect(body.sessions.every((s) => s.googleSaveUrl === null)).toBe(true);
        // Only the one token for the whole set is signed.
        expect(calls).toEqual([count]);
      } else {
        expect(body.google).toBeNull();
        expect(body.sessions.map((s) => s.googleSaveUrl)).toEqual(
          serials.map((serial) => `https://pay.google.com/gp/v/save/fake-0-1-${serial}`),
        );
        // The all-in-one token is never signed above 8 sessions.
        expect(calls).toEqual(serials.map(() => 1));
      }
      expect(lastLog(fixture.capture).GoogleSaveJwtOversize ?? 0).toBe(0);
    }
  });

  test('when Google cannot sign, no Google link is given at all and the failure is counted', async () => {
    const fixture = createApiFixture();
    const serials = await seed(fixture, 2, () => ({
      platforms: ['google'],
      googleState: 'active',
    }));
    const id = await createOk(fixture, serials, GOOGLE_ONLY);
    fixture.google.saveLinks = () => Promise.reject(new Error('no key'));
    const body = (await view(fixture, id)).json as ViewBody;
    expect(body.google).toBeNull();
    expect(body.sessions.map((s) => s.googleSaveUrl)).toEqual([null, null]);
    expect(lastLog(fixture.capture).GoogleWalletFailure).toBe(1);
  });

  test('GoogleSaveJwtOversize counts every session link that is still over', async () => {
    const fixture = createApiFixture();
    fixture.google.oversize = true;
    const serials = await seed(fixture, 9, () => ({
      platforms: ['google'],
      googleState: 'active',
    }));
    const id = await createOk(fixture, serials, GOOGLE_ONLY);
    await view(fixture, id);
    expect(lastLog(fixture.capture).GoogleSaveJwtOversize).toBe(9);
  });

  test('a session whose Google insert failed has no link of its own, the others do', async () => {
    const fixture = createApiFixture();
    const serials = await seed(fixture, 2, (i) => ({
      platforms: ['google'],
      googleState: i === 0 ? 'active' : 'none',
    }));
    fixture.google.insertResult = () => 'failed';
    const id = await createOk(fixture, serials, GOOGLE_ONLY);
    const body = (await view(fixture, id)).json as ViewBody;
    expect(body.sessions.map((s) => s.googleSaveUrl !== null)).toEqual([true, false]);
    // One pass that wants Google has no object, so there is no top link.
    expect(body.google).toBeNull();
  });
});

describe('Feature: pass-service, one Apple pass for each session (tasks 50 and 52)', () => {
  test('the view names the routes of each session and they download that session alone', async () => {
    const fixture = createApiFixture();
    const serials = await seed(fixture, 9, () => ({ platforms: ['apple'] }));
    const id = await createOk(fixture, serials);
    const body = (await view(fixture, id)).json as ViewBody;
    // More than eight sessions: no Apple bundle at the top, the week calendar stays.
    expect(body.apple.bundlePaths).toEqual([]);
    expect(body.calendarPath).toBe(`/api/v1/handoffs/${id}/calendar.ics`);
    expect(body.sessions.map((s) => s.applePath)).toEqual(
      serials.map((serial) => `/api/v1/handoffs/${id}/apple/pass/${serial}`),
    );
    expect(body.sessions.every((s) => !('calendarPath' in s))).toBe(true);
    expect(body.sessions.every((s) => s.googleSaveUrl === null)).toBe(true);
    const pass = await applePass(fixture, id, serials[1]!);
    expect(pass.result.statusCode).toBe(200);
    expect(pass.result.headers['content-type']).toBe('application/vnd.apple.pkpass');
    expect(pass.result.headers['content-disposition']).toBe(
      'attachment; filename="reinvent-pass.pkpass"',
    );
    expect(pass.result.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(Buffer.from(pass.result.body, 'base64').toString())).toMatchObject({
      serial: serials[1],
    });
  });

  test('a pass that is Apple only has no Google link and a pass without Apple has no pass route', async () => {
    const fixture = createApiFixture();
    const serials = await seed(fixture, 9, (i) => ({
      platforms: i === 0 ? ['apple'] : ['google'],
      googleState: i === 0 ? 'none' : 'active',
    }));
    const id = await createOk(fixture, serials);
    const body = (await view(fixture, id)).json as ViewBody;
    expect(body.sessions[0]!.applePath).not.toBeNull();
    expect(body.sessions[0]!.googleSaveUrl).toBeNull();
    expect(body.sessions[1]!.applePath).toBeNull();
    expect(body.sessions[1]!.googleSaveUrl).not.toBeNull();
    expect((await applePass(fixture, id, serials[1]!)).result.statusCode).toBe(404);
  });

  test('a foreign, unknown, inactive or malformed serial is the same 404 with no detail', async () => {
    const fixture = createApiFixture();
    const serials = await seed(fixture, 2, () => ({ platforms: ['apple'] }));
    const foreign = serialOf(77);
    await fixture.deps.passes.create(makePassRecord(SUB, foreign, { platforms: ['apple'] }));
    const id = await createOk(fixture, serials);
    const rec = await fixture.deps.passes.get(serials[1]!, fixture.clock.now());
    await fixture.deps.passes.save({ ...rec!, status: 'voided', version: 2 }, 1);
    const unknown = await applePass(fixture, id, serialOf(99));
    expect(unknown.result.statusCode).toBe(404);
    for (const serial of [foreign, serialOf(99), serials[1]!, '', 'x; DROP TABLE']) {
      const a = await applePass(fixture, id, serial);
      expect(a.result.statusCode).toBe(404);
      expect(a.result.body).toBe(unknown.result.body);
      expect(a.json).toEqual({
        type: 'about:blank',
        title: 'Not Found',
        status: 404,
        code: 'not_found',
      });
    }
    const noParams = await fixture.call({
      method: 'GET',
      resource: '/api/v1/handoffs/{handoffId}/apple/pass/{serialNumber}',
    });
    expect(noParams.result.statusCode).toBe(404);
    const noIdPass = await fixture.call({
      method: 'GET',
      resource: '/api/v1/handoffs/{handoffId}/apple/pass/{serialNumber}',
      path: { serialNumber: serials[0]! },
    });
    expect(noIdPass.result.statusCode).toBe(404);
    // The voided session left the view too.
    expect(((await view(fixture, id)).json as ViewBody).sessions).toHaveLength(1);
  });

  test('an expired hand-off, an unknown one and one made without the platform are 404', async () => {
    const fixture = createApiFixture();
    const serials = await seed(fixture, 1, () => ({ platforms: ['apple', 'google'] }));
    const noApple = await createOk(fixture, serials, {
      apple: false,
      google: true,
      calendar: true,
    });
    const live = await createOk(fixture, serials);
    expect((await applePass(fixture, noApple, serials[0]!)).result.statusCode).toBe(404);
    const withoutApple = (await view(fixture, noApple)).json as ViewBody;
    expect(withoutApple.sessions[0]!.applePath).toBeNull();
    expect(
      (await applePass(fixture, 'BBBBBBBBBBBBBBBBBBBBBB', serials[0]!)).result.statusCode,
    ).toBe(404);
    fixture.clock.advance(16 * MINUTE);
    expect((await applePass(fixture, live, serials[0]!)).result.statusCode).toBe(404);
  });

  test('with the calendar switched off the week calendar path goes away', async () => {
    const fixture = createApiFixture({ env: { HANDOFF_CALENDAR_ENABLED: 'false' } });
    const serials = await seed(fixture, 1);
    const id = await createOk(fixture, serials);
    expect(((await view(fixture, id)).json as ViewBody).calendarPath).toBeNull();
    expect((await calendar(fixture, id)).json).toMatchObject({ code: 'not_enabled' });
  });

  test('every route draws on the same read limit, 30 plus 2 for every pass', async () => {
    const fixture = createApiFixture();
    const serials = await seed(fixture, 2, () => ({ platforms: ['apple'] }));
    const id = await createOk(fixture, serials);
    const calls = [
      () => view(fixture, id),
      () => bundle(fixture, id, '0'),
      () => calendar(fixture, id),
      () => applePass(fixture, id, serials[0]!),
      () => applePass(fixture, id, serials[1]!),
    ];
    for (let i = 0; i < 34; i += 1) {
      expect((await calls[i % calls.length]!()).result.statusCode).toBe(200);
    }
    for (const call of calls) {
      expect((await call()).result.statusCode).toBe(404);
    }
  });
});

describe('Feature: pass-service, the view retries Google inserts that did not finish (task 49)', () => {
  const GOOGLE_ONLY = { apple: false, google: true, calendar: false };

  function pending(fixture: ApiFixture, count: number, platforms: ('apple' | 'google')[]) {
    return seed(fixture, count, () => ({ platforms, googleState: 'none' }));
  }

  test('a pass with no object is inserted on read, marked active and linked', async () => {
    const fixture = createApiFixture();
    const serials = await pending(fixture, 2, ['apple', 'google']);
    const id = await createOk(fixture, serials, GOOGLE_ONLY);
    const body = (await view(fixture, id)).json as ViewBody;
    expect(fixture.google.inserts).toHaveLength(2);
    expect(body.google).toEqual({
      saveUrl: `https://pay.google.com/gp/v/save/fake-0-2-${serials[0]}`,
    });
    expect(fixture.google.saveUrls.at(-1)!.objects).toHaveLength(2);
    for (const serial of serials) {
      expect((await fixture.deps.passes.get(serial, fixture.clock.now()))?.googleState).toBe(
        'active',
      );
    }
    // A second read finds the objects and does not insert again.
    await view(fixture, id);
    expect(fixture.google.inserts).toHaveLength(2);
    expect(lastLog(fixture.capture).GoogleWalletFailure ?? 0).toBe(0);
  });

  test('a failed insert is counted, leaves the pass without Google, and the view still answers', async () => {
    const fixture = createApiFixture();
    const serials = await pending(fixture, 3, ['apple', 'google']);
    fixture.google.insertResult = (obj) => (obj.id.endsWith(serials[1]!) ? 'failed' : 'ok');
    const id = await createOk(fixture, serials, { apple: true, google: true, calendar: false });
    const reply = await view(fixture, id);
    expect(reply.result.statusCode).toBe(200);
    const body = reply.json as ViewBody;
    expect(body.sessions).toHaveLength(3);
    expect(body.apple.bundlePaths).toHaveLength(1);
    expect(body.sessions.map((s) => s.googleSaveUrl !== null)).toEqual([true, false, true]);
    expect(body.google).toBeNull();
    expect(lastLog(fixture.capture).GoogleWalletFailure).toBe(1);
    expect((await fixture.deps.passes.get(serials[1]!, fixture.clock.now()))?.googleState).toBe(
      'none',
    );
  });

  test('when every insert fails there is no Google link and the view answers 200', async () => {
    const fixture = createApiFixture();
    const serials = await pending(fixture, 2, ['google']);
    fixture.google.insertResult = () => 'failed';
    const id = await createOk(fixture, serials, { apple: false, google: true, calendar: true });
    const reply = await view(fixture, id);
    expect(reply.result.statusCode).toBe(200);
    expect((reply.json as ViewBody).google).toBeNull();
    expect(lastLog(fixture.capture).GoogleWalletFailure).toBe(2);
  });

  test('Apple only passes, Google left out of the hand-off, and Google disabled are not inserted', async () => {
    const appleOnly = createApiFixture();
    const id1 = await createOk(appleOnly, await pending(appleOnly, 1, ['apple']), ALL);
    expect((await view(appleOnly, id1)).json).toMatchObject({ google: null });

    const notIncluded = createApiFixture();
    const id2 = await createOk(notIncluded, await pending(notIncluded, 1, ['apple', 'google']), {
      apple: true,
      google: false,
      calendar: false,
    });
    expect((await view(notIncluded, id2)).json).toMatchObject({ google: null });

    const disabled = createApiFixture({
      env: { GOOGLE_WALLET_ENABLED: 'false', GOOGLE_SECRET_ID: undefined },
    });
    const id3 = await createOk(disabled, await pending(disabled, 1, ['apple', 'google']), ALL);
    expect((await view(disabled, id3)).json).toMatchObject({ google: null });

    for (const fixture of [appleOnly, notIncluded, disabled]) {
      expect(fixture.google.inserts).toEqual([]);
    }
  });

  test('retries use the insert concurrency limit and the budget', async () => {
    const fixture = createApiFixture({ env: { GOOGLE_INSERT_BUDGET_MS: '150' } });
    const serials = await pending(fixture, 12, ['apple', 'google']);
    const insert = fixture.google.insert.bind(fixture.google);
    let inFlight = 0;
    let peak = 0;
    fixture.google.insert = async (obj) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
      inFlight -= 1;
      return insert(obj);
    };
    const id = await createOk(fixture, serials, GOOGLE_ONLY);
    const reply = await view(fixture, id);
    expect(reply.result.statusCode).toBe(200);
    expect((reply.json as ViewBody).google).toBeNull();
    expect(peak).toBe(5);
    expect(lastLog(fixture.capture).GoogleWalletFailure).toBe(12);
    // Only the five inserts already running finish; the rest were never started.
    await new Promise<void>((resolve) => setTimeout(resolve, 400));
    expect(fixture.google.inserts).toHaveLength(5);
    // A later read sees those five as active and retries only the other seven.
    fixture.google.insert = insert;
    const again = (await view(fixture, id)).json as ViewBody;
    expect(fixture.google.inserts).toHaveLength(12);
    // Twelve passes never fit one link: each session has its own and there is no top link.
    expect(again.google).toBeNull();
    expect(again.sessions.every((s) => s.googleSaveUrl !== null)).toBe(true);
  });

  test('the view waits at most VIEW_INSERT_BUDGET_MS for retries, whatever the configured budget', async () => {
    const fixture = createApiFixture({ env: { GOOGLE_INSERT_BUDGET_MS: '12000' } });
    const id = await createOk(fixture, await pending(fixture, 1, ['apple', 'google']), ALL);
    // Google never answers.
    fixture.google.insert = () => new Promise<never>(() => undefined);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      let done = false;
      const reply = view(fixture, id).then((r) => {
        done = true;
        return r;
      });
      await vi.advanceTimersByTimeAsync(VIEW_INSERT_BUDGET_MS - 1);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const answered = await reply;
      expect(answered.result.statusCode).toBe(200);
      expect((answered.json as ViewBody).google).toBeNull();
      expect((answered.json as ViewBody).apple.bundlePaths).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test('a record that cannot be marked active is counted and left out of the link', async () => {
    const fixture = createApiFixture({
      tweak: (deps) => {
        deps.passes = {
          ...deps.passes,
          activateGoogle: () => Promise.reject(new Error('table unavailable')),
        };
      },
    });
    const id = await createOk(fixture, await pending(fixture, 1, ['google']), GOOGLE_ONLY);
    const reply = await view(fixture, id);
    expect(reply.result.statusCode).toBe(200);
    expect((reply.json as ViewBody).google).toBeNull();
    expect(lastLog(fixture.capture).GoogleWalletFailure).toBe(1);
  });
});

describe('Feature: pass-service, review fixes of task 50.6', () => {
  const GOOGLE_ONLY = { apple: false, google: true, calendar: false };
  const pendingGoogle = (fixture: ApiFixture, count: number) =>
    seed(fixture, count, () => ({ platforms: ['google'], googleState: 'none' }));
  const stateOf = async (fixture: ApiFixture, serial: string) =>
    (await fixture.deps.passes.get(serial, fixture.clock.now()))!;

  function voidDuringInsert(fixture: ApiFixture, serial: string): void {
    const insert = fixture.google.insert.bind(fixture.google);
    fixture.google.insert = async (obj) => {
      // The void reads the record while it is still none, so it sends no INACTIVE patch.
      const rec = await stateOf(fixture, serial);
      await fixture.deps.passes.save(
        { ...rec, status: 'voided', version: rec.version + 1 },
        rec.version,
      );
      return insert(obj);
    };
  }

  test('a pass voided while its insert is in flight is not marked active, is set INACTIVE and is not linked', async () => {
    const fixture = createApiFixture();
    const serials = await pendingGoogle(fixture, 1);
    const id = await createOk(fixture, serials, GOOGLE_ONLY);
    voidDuringInsert(fixture, serials[0]!);
    const reply = await view(fixture, id);
    expect(reply.result.statusCode).toBe(200);
    const rec = await stateOf(fixture, serials[0]!);
    expect(rec.status).toBe('voided');
    expect(rec.googleState).toBe('inactive');
    expect(fixture.google.patches).toHaveLength(1);
    expect(fixture.google.patches[0]!.objectId).toContain(serials[0]!);
    expect(fixture.google.patches[0]!.body).toMatchObject({ state: 'INACTIVE' });
    expect(lastLog(fixture.capture).GoogleWalletFailure).toBe(1);
    expect((reply.json as ViewBody).google).toBeNull();
  });

  test('when the INACTIVE patch also fails the pass is left pending_inactive for the sweep', async () => {
    const fixture = createApiFixture();
    const serials = await pendingGoogle(fixture, 1);
    const id = await createOk(fixture, serials, GOOGLE_ONLY);
    voidDuringInsert(fixture, serials[0]!);
    fixture.google.patchResult = () => 'failed';
    await view(fixture, id);
    expect((await stateOf(fixture, serials[0]!)).googleState).toBe('pending_inactive');
  });

  test('a failed insert is not tried again by the view for 60 seconds', async () => {
    const fixture = createApiFixture();
    const serials = await pendingGoogle(fixture, 2);
    fixture.google.insertResult = (obj) => (obj.id.endsWith(serials[0]!) ? 'failed' : 'ok');
    const id = await createOk(fixture, serials, GOOGLE_ONLY);
    const first = fixture.clock.now();
    await view(fixture, id);
    expect(fixture.google.inserts).toHaveLength(2);
    expect((await stateOf(fixture, serials[0]!)).googleRetryAfterMs).toBe(first + 60_000);
    expect((await stateOf(fixture, serials[1]!)).googleRetryAfterMs).toBeUndefined();
    fixture.clock.advance(59_000);
    await view(fixture, id);
    expect(fixture.google.inserts).toHaveLength(2);
    fixture.clock.advance(1_000);
    await view(fixture, id);
    expect(fixture.google.inserts).toHaveLength(3);
  });

  test('a failure to store the cooldown never stops the view', async () => {
    const fixture = createApiFixture({
      tweak: (deps) => {
        deps.passes = {
          ...deps.passes,
          setGoogleRetryAfter: () => Promise.reject(new Error('table unavailable')),
        };
      },
    });
    const serials = await pendingGoogle(fixture, 1);
    fixture.google.insertResult = () => 'failed';
    const id = await createOk(fixture, serials, GOOGLE_ONLY);
    expect((await view(fixture, id)).result.statusCode).toBe(200);
  });

  test('the top link needs every Google pass to have an object; sessions that have one keep theirs', async () => {
    const fixture = createApiFixture();
    const serials = await pendingGoogle(fixture, 3);
    fixture.google.insertResult = (obj) => (obj.id.endsWith(serials[1]!) ? 'failed' : 'ok');
    const id = await createOk(fixture, serials, GOOGLE_ONLY);
    const body = (await view(fixture, id)).json as ViewBody;
    expect(body.google).toBeNull();
    expect(body.sessions.map((s) => s.googleSaveUrl !== null)).toEqual([true, false, true]);
    // Only the per-session tokens were signed.
    expect(fixture.google.saveUrls.map((c) => c.objects.length)).toEqual([1, 1]);
  });

  test('when the all-in-one token would split, there is no top link but every session keeps its own', async () => {
    const fixture = createApiFixture();
    fixture.google.perLink = 2;
    const serials = await seed(fixture, 3, () => ({
      platforms: ['google'],
      googleState: 'active',
    }));
    const id = await createOk(fixture, serials, GOOGLE_ONLY);
    const body = (await view(fixture, id)).json as ViewBody;
    expect(fixture.google.saveUrls.map((c) => c.objects.length)).toEqual([3, 1, 1, 1]);
    expect(body.google).toBeNull();
    expect(body.sessions.every((s) => s.googleSaveUrl !== null)).toBe(true);
  });

  test('an oversize top token that split is not counted on top of the per-session ones', async () => {
    const fixture = createApiFixture();
    fixture.google.perLink = 2;
    fixture.google.oversize = true;
    const serials = await seed(fixture, 3, () => ({
      platforms: ['google'],
      googleState: 'active',
    }));
    const id = await createOk(fixture, serials, GOOGLE_ONLY);
    await view(fixture, id);
    // Three session tokens are oversize; the split top token adds nothing.
    expect(lastLog(fixture.capture).GoogleSaveJwtOversize).toBe(3);
  });

  test('an oversize top token that is given is counted once', async () => {
    const fixture = createApiFixture();
    fixture.google.oversize = true;
    const serials = await seed(fixture, 2, () => ({
      platforms: ['google'],
      googleState: 'active',
    }));
    const id = await createOk(fixture, serials, GOOGLE_ONLY);
    const body = (await view(fixture, id)).json as ViewBody;
    expect(body.google).not.toBeNull();
    expect(lastLog(fixture.capture).GoogleSaveJwtOversize).toBe(1);
  });

  test('a pass that does not want Google does not hold back the top link', async () => {
    const fixture = createApiFixture();
    const serials = await seed(fixture, 3, (i) => ({
      platforms: i === 2 ? ['apple'] : ['google'],
      googleState: i === 2 ? 'none' : 'active',
    }));
    const id = await createOk(fixture, serials, { apple: true, google: true, calendar: false });
    const body = (await view(fixture, id)).json as ViewBody;
    expect(body.google).toEqual({
      saveUrl: `https://pay.google.com/gp/v/save/fake-0-2-${serials[0]}`,
    });
  });

  test('above 8 sessions the all-in-one token is not signed at all; at 8 only it is signed', async () => {
    for (const [count, whole] of [
      [8, true],
      [9, false],
      [12, false],
    ] as const) {
      const fixture = createApiFixture();
      const serials = await seed(fixture, count, () => ({
        platforms: ['google'],
        googleState: 'active',
      }));
      const id = await createOk(fixture, serials, GOOGLE_ONLY);
      const body = (await view(fixture, id)).json as ViewBody;
      const sizes = fixture.google.saveUrls.map((c) => c.objects.length);
      expect(sizes).toEqual(whole ? [count] : serials.map(() => 1));
      expect(body.google !== null).toBe(whole);
      expect(body.sessions.every((s) => s.googleSaveUrl !== null)).toBe(!whole);
    }
  });
});
