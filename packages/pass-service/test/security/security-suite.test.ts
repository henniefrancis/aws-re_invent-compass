import { ProblemSchema } from '@compass/contracts';
import fc from 'fast-check';
import { describe, expect, test, vi } from 'vitest';
import { deviceHash, subHash } from '../../src/security/hashing.js';
import {
  createApiFixture,
  type ApiFixture,
  type CallOptions,
  type Reply,
} from '../helpers/api-fixture.js';
import { contractOperations, loadContractTree } from '../helpers/openapi-reader.js';
import { samplePassFields } from '../helpers/pass-fields.js';
import { makePassRecord } from '../helpers/pass-record.js';
import { createRealAuthFixture } from '../helpers/real-auth.js';

// Security properties drive many requests through the whole app on a machine that may be busy.
vi.setConfig({ testTimeout: 300_000 });

const operations = contractOperations(loadContractTree());
const SUB = '3'.repeat(64);
const PASS_TYPE = 'pass.test.compass';
const REG =
  '/api/passkit/v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}/{serialNumber}';
const LIST = '/api/passkit/v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}';
const LATEST = '/api/passkit/v1/passes/{passTypeIdentifier}/{serialNumber}';

const ALLOWED_LOG_KEYS = new Set([
  'requestId',
  'route',
  'status',
  'latencyMs',
  'outcome',
  'Function',
  '_aws',
  'Latency',
  'ApnsFailure',
  'ApnsInvalidToken',
  'ApnsSkipped',
  'GoogleWalletFailure',
  'GoogleSaveJwtOversize',
  'PasskitLogMessages',
]);

function containsAny(texts: readonly string[], needles: readonly string[]): string | undefined {
  for (const needle of needles) {
    for (const text of texts) {
      if (text.includes(needle)) {
        return needle;
      }
    }
  }
  return undefined;
}

function replyText(reply: Reply): string {
  return `${reply.result.body}\n${JSON.stringify(reply.result.headers)}`;
}

const isPasskit = (path: string) => path.startsWith('/api/passkit/');

// Feature: pass-service, Property 1: Problem responses never echo input
describe('Feature: pass-service, Property 1', () => {
  test('error responses are fixed Problem bodies that never echo any input', async () => {
    const fixture = createApiFixture();
    const serial = await fixture.issue(SUB);
    const token = await fixture.authToken(serial);
    const where = fc.constantFrom('path', 'query', 'header', 'body', 'auth', 'all');
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...operations),
        where,
        fc.stringMatching(/^[a-z0-9]{10,20}$/),
        async (op, place, raw) => {
          const needle = `NDL${raw}`;
          const everywhere = place === 'all';
          const passkit = isPasskit(op.path);
          const path = (): Record<string, string> =>
            place === 'path' || everywhere
              ? {
                  serialNumber: needle,
                  handoffId: needle,
                  bundleIndex: needle,
                  deviceLibraryIdentifier: needle,
                  passTypeIdentifier: needle,
                }
              : {
                  serialNumber: serial,
                  handoffId: 'AAAAAAAAAAAAAAAAAAAAAA',
                  bundleIndex: '0',
                  deviceLibraryIdentifier: 'lib-1',
                  passTypeIdentifier: PASS_TYPE,
                };
          const headers: Record<string, string> = {};
          if (place === 'header' || everywhere) {
            headers['x-needle'] = needle;
            headers['if-modified-since'] = needle;
          }
          if (place === 'auth' || everywhere) {
            headers.authorization = passkit ? `ApplePass ${needle}` : `Bearer ${needle}`;
          } else if (passkit) {
            headers.authorization = `ApplePass ${token}`;
          }
          const options: CallOptions = {
            method: op.method.toUpperCase(),
            resource: op.path,
            path: path(),
            query:
              place === 'query' || everywhere
                ? { passesUpdatedSince: needle, extra: needle }
                : undefined,
            headers,
            token: passkit || place === 'auth' || everywhere ? undefined : SUB,
            body:
              place === 'body' || everywhere
                ? {
                    title: needle,
                    serialNumbers: [needle],
                    pushToken: needle,
                    logs: [needle],
                    extra: needle,
                  }
                : undefined,
          };
          const reply = await (passkit ? fixture.callPasskit(options) : fixture.call(options));
          if (reply.result.statusCode < 400) {
            return;
          }
          const problem = ProblemSchema.parse(JSON.parse(reply.result.body));
          expect(Object.keys(problem).sort()).toEqual(['code', 'status', 'title', 'type']);
          expect(problem.type).toBe('about:blank');
          expect(problem.status).toBe(reply.result.statusCode);
          expect(reply.result.headers['content-type']).toBe('application/problem+json');
          expect(containsAny([replyText(reply)], [needle])).toBeUndefined();
        },
      ),
      { numRuns: 200 },
    );
  });
});

// Feature: pass-service, Property 6: Identity reduces to a keyed hash
describe('Feature: pass-service, Property 6', () => {
  test('hashes are 64 hex characters, keyed by the pepper, and never contain the input', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[g-z][A-Za-z0-9_-]{7,30}$/),
        fc.string({ minLength: 16, maxLength: 40 }),
        fc.string({ minLength: 16, maxLength: 40 }),
        (value, pepperA, pepperB) => {
          for (const hash of [subHash, deviceHash]) {
            const h = hash(pepperA, value);
            expect(h).toMatch(/^[0-9a-f]{64}$/);
            expect(h).toBe(hash(pepperA, value));
            expect(h).not.toContain(value);
            if (pepperA !== pepperB) {
              expect(hash(pepperB, value)).not.toBe(h);
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  test('no stored item, response, log line or console output holds the sub, email, token or device id', async () => {
    await fc.assert(
      fc.asyncProperty(fc.stringMatching(/^[g-z]{12}$/), async (raw) => {
        const sub = `sub-${raw}`;
        const email = `${raw}@mail.example.test`;
        const deviceId = `lib-${raw}`;
        const pushToken = 'ab12cd34ef56';
        const { fixture, tokenFor } = createRealAuthFixture();
        const jwt = tokenFor(sub, { email });
        const secrets: string[] = [sub, email, jwt, deviceId, pushToken];
        const replies: Reply[] = [];
        const send = async (options: CallOptions, passkit = false) => {
          const reply = await (passkit ? fixture.callPasskit(options) : fixture.call(options));
          replies.push(reply);
          return reply;
        };
        const issued = await send({
          method: 'POST',
          resource: '/api/v1/passes',
          token: jwt,
          body: { platforms: ['apple', 'google'], passes: [samplePassFields()] },
        });
        expect(issued.result.statusCode).toBe(201);
        const serial = (issued.json as { passes: { serialNumber: string }[] }).passes[0]!
          .serialNumber;
        const authToken = await fixture.authToken(serial);
        const header = { authorization: `ApplePass ${authToken}` };
        await send(
          {
            method: 'POST',
            resource: REG,
            path: {
              deviceLibraryIdentifier: deviceId,
              passTypeIdentifier: PASS_TYPE,
              serialNumber: serial,
            },
            headers: header,
            body: { pushToken },
          },
          true,
        );
        await send(
          {
            method: 'GET',
            resource: LIST,
            path: { deviceLibraryIdentifier: deviceId, passTypeIdentifier: PASS_TYPE },
          },
          true,
        );
        await send(
          {
            method: 'GET',
            resource: LATEST,
            path: { passTypeIdentifier: PASS_TYPE, serialNumber: serial },
            headers: header,
          },
          true,
        );
        await send({
          method: 'PUT',
          resource: '/api/v1/passes/{serialNumber}',
          path: { serialNumber: serial },
          token: jwt,
          body: samplePassFields({ room: 'R2' }),
        });
        const handoff = await send({
          method: 'POST',
          resource: '/api/v1/handoffs',
          token: jwt,
          body: { serialNumbers: [serial], include: { apple: true, google: true, calendar: true } },
        });
        const handoffId = (handoff.json as { handoffId: string }).handoffId;
        await send({
          method: 'GET',
          resource: '/api/v1/handoffs/{handoffId}',
          path: { handoffId },
        });
        await send({
          method: 'GET',
          resource: '/api/v1/passes/{serialNumber}/apple',
          path: { serialNumber: serial },
          token: jwt,
        });
        await send({
          method: 'POST',
          resource: '/api/v1/passes/{serialNumber}/void',
          path: { serialNumber: serial },
          token: jwt,
        });
        // The table is read before forget_me deletes everything.
        const table = JSON.stringify(fixture.table.snapshot());
        expect(
          containsAny([table], [sub, email, jwt, deviceId, handoffId, authToken]),
        ).toBeUndefined();
        await send({ method: 'DELETE', resource: '/api/v1/me', token: jwt });
        const everything = [
          ...replies.map(replyText),
          ...fixture.capture.lines,
          ...fixture.capture.consoleCalls,
        ];
        expect(containsAny(everything, secrets)).toBeUndefined();
        expect(fixture.capture.consoleCalls).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: pass-service, Property 32: Expiry is enforced on every read
describe('Feature: pass-service, Property 32', () => {
  const offsetArb = fc.constantFrom(-60_000, -1, 0, 1, 60_000, 86_400_000);

  function ttlsHold(fixture: ApiFixture): void {
    for (const item of fixture.table.snapshot()) {
      if (typeof item.expiresAtMs === 'number') {
        expect(Number(item.ttl)).toBeGreaterThanOrEqual(item.expiresAtMs / 1000);
      }
    }
  }

  test('a pass at or past its expiry behaves as absent, though it is still stored', async () => {
    await fc.assert(
      fc.asyncProperty(offsetArb, async (offset) => {
        const fixture = createApiFixture();
        const serial = await fixture.issue(SUB, samplePassFields(), ['apple', 'google']);
        const token = await fixture.authToken(serial);
        const stored = await fixture.deps.passes.get(serial, fixture.clock.now());
        const expiresAtMs = stored?.expiresAtMs ?? 0;
        fixture.clock.set(expiresAtMs + offset);
        const live = offset < 0;
        const apple = await fixture.call({
          method: 'GET',
          resource: '/api/v1/passes/{serialNumber}/apple',
          path: { serialNumber: serial },
          token: SUB,
        });
        const latest = await fixture.callPasskit({
          method: 'GET',
          resource: LATEST,
          path: { passTypeIdentifier: PASS_TYPE, serialNumber: serial },
          headers: { authorization: `ApplePass ${token}` },
        });
        const handoff = await fixture.call({
          method: 'POST',
          resource: '/api/v1/handoffs',
          token: SUB,
          body: {
            serialNumbers: [serial],
            include: { apple: true, google: false, calendar: false },
          },
        });
        const update = await fixture.call({
          method: 'PUT',
          resource: '/api/v1/passes/{serialNumber}',
          path: { serialNumber: serial },
          token: SUB,
          body: samplePassFields(),
        });
        const voided = await fixture.call({
          method: 'POST',
          resource: '/api/v1/passes/{serialNumber}/void',
          path: { serialNumber: serial },
          token: SUB,
        });
        expect([apple, handoff, update, voided].map((r) => r.result.statusCode)).toEqual(
          live ? [200, 201, 200, 200] : [404, 400, 404, 404],
        );
        expect(latest.result.statusCode).toBe(live ? 200 : 401);
        expect(fixture.table.snapshot().some((item) => item.pk === `PASS#${serial}`)).toBe(true);
        ttlsHold(fixture);
      }),
      { numRuns: 60 },
    );
  });

  test('a registration at or past its expiry is not listed and not pushed', async () => {
    await fixture_registration();
  });

  async function fixture_registration(): Promise<void> {
    await fc.assert(
      fc.asyncProperty(offsetArb, async (offset) => {
        const fixture = createApiFixture();
        const serial = await fixture.issue(SUB);
        const token = await fixture.authToken(serial);
        await fixture.callPasskit({
          method: 'POST',
          resource: REG,
          path: {
            deviceLibraryIdentifier: 'lib-1',
            passTypeIdentifier: PASS_TYPE,
            serialNumber: serial,
          },
          headers: { authorization: `ApplePass ${token}` },
          body: { pushToken: 'aabb' },
        });
        const registrationExpiry = fixture.clock.now() + 600_000;
        const item = fixture.table.snapshot().find((i) => i.pk.startsWith('DEV#'));
        await fixture.table.set(
          { pk: String(item?.pk), sk: String(item?.sk) },
          { expiresAtMs: registrationExpiry },
        );
        fixture.clock.set(registrationExpiry + offset);
        const live = offset < 0;
        const listed = await fixture.callPasskit({
          method: 'GET',
          resource: LIST,
          path: { deviceLibraryIdentifier: 'lib-1', passTypeIdentifier: PASS_TYPE },
        });
        expect(listed.result.statusCode).toBe(live ? 200 : 204);
        await fixture.call({
          method: 'PUT',
          resource: '/api/v1/passes/{serialNumber}',
          path: { serialNumber: serial },
          token: SUB,
          body: samplePassFields({ room: 'R3' }),
        });
        expect(fixture.apns.calls.flat()).toHaveLength(live ? 1 : 0);
        const again = await fixture.callPasskit({
          method: 'POST',
          resource: REG,
          path: {
            deviceLibraryIdentifier: 'lib-1',
            passTypeIdentifier: PASS_TYPE,
            serialNumber: serial,
          },
          headers: { authorization: `ApplePass ${token}` },
          body: { pushToken: 'ccdd' },
        });
        expect(again.result.statusCode).toBe(live ? 200 : 201);
        expect(fixture.table.snapshot().some((i) => i.pk.startsWith('DEV#'))).toBe(true);
        ttlsHold(fixture);
      }),
      { numRuns: 60 },
    );
  }

  test('a hand-off at or past its expiry is absent, and a counter window ends with its window', async () => {
    await fc.assert(
      fc.asyncProperty(offsetArb, async (offset) => {
        const fixture = createApiFixture();
        const serial = await fixture.issue(SUB);
        const created = await fixture.call({
          method: 'POST',
          resource: '/api/v1/handoffs',
          token: SUB,
          body: {
            serialNumbers: [serial],
            include: { apple: true, google: false, calendar: false },
          },
        });
        const { handoffId, expiresAt } = created.json as { handoffId: string; expiresAt: string };
        fixture.clock.set(Date.parse(expiresAt) + offset);
        const reply = await fixture.call({
          method: 'GET',
          resource: '/api/v1/handoffs/{handoffId}',
          path: { handoffId },
        });
        expect(reply.result.statusCode).toBe(offset < 0 ? 200 : 404);
        expect(fixture.table.snapshot().some((i) => i.pk.startsWith('HANDOFF#'))).toBe(true);
        ttlsHold(fixture);
        const counters = fixture.table.snapshot().filter((i) => i.pk.startsWith('RATE#'));
        const next = Math.max(...counters.map((c) => Number(c.expiresAtMs)));
        expect(next).toBeGreaterThan(0);
        fixture.clock.set(next);
        const decision = await fixture.deps.limiter.consume(SUB, 'handoffs', 10, next);
        expect(decision.allowed).toBe(true);
      }),
      { numRuns: 60 },
    );
  });
});

// Feature: pass-service, Property 35: Log lines hold only allowlisted fields
describe('Feature: pass-service, Property 35', () => {
  const routeKeys = new Set(operations.map((op) => `${op.method.toUpperCase()} ${op.path}`));

  test('every operation logs one allowlisted line and no identifier, even when a handler throws', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.stringMatching(/^[g-z]{12}$/),
        fc.integer({ min: 100, max: 999 }),
        fc.boolean(),
        async (raw, number, throwing) => {
          const sub = `sub-${raw}`;
          const email = `${raw}@mail.example.test`;
          const deviceId = `lib-${raw}`;
          const pushToken = 'ab12cd34ef56ab12';
          const sessionCode = `NDL${number}`;
          const title = `Title ${raw}`;
          const { fixture, tokenFor } = createRealAuthFixture({
            tweak: (deps) => {
              const noisy = (): void => {
                deps.console.log(`noise ${sub} ${email} ${deviceId} ${pushToken} ${title}`);
                deps.console.error(new Error(`noise ${sessionCode}`));
              };
              deps.google.insert = () => {
                noisy();
                return Promise.resolve('ok');
              };
              deps.apns.push = (targets) => {
                noisy();
                return Promise.resolve({
                  delivered: targets.length,
                  invalid: [],
                  failed: 0,
                  skipped: false,
                });
              };
              if (throwing) {
                deps.limiter = {
                  ...deps.limiter,
                  consume: () => {
                    noisy();
                    throw new Error(`limiter failed for ${sub} ${email} ${sessionCode}`);
                  },
                };
              }
            },
          });
          const jwt = tokenFor(sub, { email });
          const pepper = fixture.secrets.appSecret.pepper;
          const fields = samplePassFields({ sessionCode, title });
          const serial = '44444444-4444-4444-8444-444444444444';
          await fixture.deps.passes.create(
            makePassRecord(subHash(pepper, sub), serial, {
              fields,
              platforms: ['apple', 'google'],
              googleState: 'active',
            }),
          );
          const authToken = await fixture.authToken(serial);
          const header = { authorization: `ApplePass ${authToken}` };
          const bearer = { token: jwt };
          const seeded = { path: { serialNumber: serial } };
          const requests: CallOptions[] = [
            { method: 'GET', resource: '/api/v1/health' },
            {
              method: 'POST',
              resource: '/api/v1/passes',
              ...bearer,
              body: { platforms: ['apple', 'google'], passes: [fields] },
            },
            {
              method: 'GET',
              resource: '/api/v1/passes/{serialNumber}/apple',
              ...seeded,
              ...bearer,
            },
            {
              method: 'PUT',
              resource: '/api/v1/passes/{serialNumber}',
              ...seeded,
              ...bearer,
              body: fields,
            },
            {
              method: 'POST',
              resource: '/api/v1/handoffs',
              ...bearer,
              body: {
                serialNumbers: [serial],
                include: { apple: true, google: true, calendar: true },
              },
            },
            {
              method: 'GET',
              resource: '/api/v1/handoffs/{handoffId}',
              path: { handoffId: `H${raw}AAAAAAAAAA`.slice(0, 22) },
            },
            {
              method: 'GET',
              resource: '/api/v1/handoffs/{handoffId}/apple/{bundleIndex}',
              path: { handoffId: raw, bundleIndex: raw },
            },
            {
              method: 'GET',
              resource: '/api/v1/handoffs/{handoffId}/calendar.ics',
              path: { handoffId: raw },
            },
            {
              method: 'POST',
              resource: '/api/v1/passes/{serialNumber}/void',
              ...seeded,
              ...bearer,
            },
            {
              method: 'POST',
              resource: '/api/v1/passes',
              token: raw,
              body: { title, sessionCode },
            },
            { method: 'GET', resource: `/secret/${raw}/path`, ...bearer },
            { method: 'GET', resource: '/api/v1/health', origin: raw },
            { method: 'DELETE', resource: '/api/v1/me', ...bearer },
          ];
          const passkit: CallOptions[] = [
            {
              method: 'POST',
              resource: REG,
              path: {
                deviceLibraryIdentifier: deviceId,
                passTypeIdentifier: PASS_TYPE,
                serialNumber: serial,
              },
              headers: header,
              body: { pushToken },
            },
            {
              method: 'GET',
              resource: LIST,
              path: { deviceLibraryIdentifier: deviceId, passTypeIdentifier: PASS_TYPE },
            },
            {
              method: 'GET',
              resource: LATEST,
              path: { passTypeIdentifier: PASS_TYPE, serialNumber: serial },
              headers: header,
            },
            {
              method: 'DELETE',
              resource: REG,
              path: {
                deviceLibraryIdentifier: deviceId,
                passTypeIdentifier: PASS_TYPE,
                serialNumber: serial,
              },
              headers: header,
            },
            {
              method: 'POST',
              resource: '/api/passkit/v1/log',
              body: { logs: [title, sub, email] },
            },
            {
              method: 'POST',
              resource: REG,
              path: {
                deviceLibraryIdentifier: deviceId,
                passTypeIdentifier: PASS_TYPE,
                serialNumber: serial,
              },
              headers: { authorization: `ApplePass ${raw}${raw}` },
              body: { pushToken },
            },
          ];
          const replies: Reply[] = [];
          for (const [index, request] of [...requests, ...passkit].entries()) {
            const before = fixture.capture.lines.length;
            const reply = await (index < requests.length
              ? fixture.call(request)
              : fixture.callPasskit(request));
            replies.push(reply);
            expect(fixture.capture.lines.length - before).toBe(1);
            const line = JSON.parse(String(fixture.capture.lines[before])) as Record<
              string,
              unknown
            >;
            expect(Object.keys(line).every((key) => ALLOWED_LOG_KEYS.has(key))).toBe(true);
            expect(
              line.route === 'UNMATCHED' || routeKeys.has(String(line.route)),
              String(line.route),
            ).toBe(true);
            expect(line.status).toBe(reply.result.statusCode);
          }
          const needles = [
            sub,
            email,
            jwt,
            deviceId,
            pushToken,
            sessionCode,
            title,
            serial,
            authToken,
            raw,
          ];
          expect(
            containsAny([...fixture.capture.lines, ...fixture.capture.consoleCalls], needles),
          ).toBeUndefined();
          expect(fixture.capture.consoleCalls).toEqual([]);
          expect(
            containsAny(replies.map(replyText), [sub, email, jwt, deviceId, pushToken]),
          ).toBeUndefined();
          if (throwing) {
            expect(replies[1]?.result.statusCode).toBe(500);
            expect(fixture.capture.lines.join('\n')).toContain('"outcome":"internal_error"');
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
