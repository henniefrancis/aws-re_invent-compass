import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import type { PushOutcome } from '../../src/apns/apns-client.js';
import { EXPIRY_GRACE_MS, ttlOf } from '../../src/data/keys.js';
import type { DeviceRegistration, PassRecord } from '../../src/data/records.js';
import { createMetrics } from '../../src/observability/metrics.js';
import { createPassLifecycle } from '../../src/services/pass-lifecycle.js';
import { createApiFixture, lastLog, type ApiFixture } from '../helpers/api-fixture.js';
import { passFieldsArb, samplePassFields } from '../helpers/pass-fields.js';

const SUB = 'c'.repeat(64);
const OTHER = 'd'.repeat(64);

const route = (method: string, suffix: string, serial: string, token = SUB) => ({
  method,
  resource: `/api/v1/passes/{serialNumber}${suffix}`,
  path: { serialNumber: serial },
  token,
});

async function register(fixture: ApiFixture, serial: string, count: number): Promise<void> {
  const rec = await fixture.deps.passes.get(serial, fixture.clock.now());
  for (let i = 0; i < count; i += 1) {
    await fixture.deps.registrations.upsert(
      {
        deviceHash: `device-${i}`,
        serialNumber: serial,
        passTypeIdentifier: 'pass.test.compass',
        pushToken: `0${i}ab`,
        subHash: SUB,
        pepperId: 'test-1',
        expiresAtMs: rec?.expiresAtMs ?? 0,
        ttl: 0,
      } satisfies DeviceRegistration,
      fixture.clock.now(),
    );
  }
}

const update = (
  fixture: ApiFixture,
  serial: string,
  fields = samplePassFields({ room: 'Room 9' }),
) => fixture.call({ ...route('PUT', '', serial), body: fields });

function items(fixture: ApiFixture, prefix: string) {
  return fixture.table.snapshot().filter((item) => item.pk.startsWith(prefix));
}

describe('Feature: pass-service, update', () => {
  // Feature: pass-service, Property 17: Update replaces content, bumps once and pushes once per device
  test('Property 17: update replaces content, bumps once, moves expiry and pushes once per device', async () => {
    await fc.assert(
      fc.asyncProperty(
        passFieldsArb,
        fc.integer({ min: 0, max: 5 }),
        fc.boolean(),
        fc.integer({ min: 0, max: 400 }),
        async (changed, regs, google, delayMinutes) => {
          const fixture = createApiFixture();
          const first = samplePassFields();
          const serial = await fixture.issue(SUB, first, google ? ['apple', 'google'] : ['apple']);
          await register(fixture, serial, regs);
          const before = await fixture.deps.passes.get(serial, fixture.clock.now());
          fixture.clock.advance(delayMinutes * 60_000);
          const fields = { ...changed, sessionCode: first.sessionCode };
          const reply = await update(fixture, serial, fields);
          expect(reply.result.statusCode).toBe(200);
          expect(reply.json).toEqual({ serialNumber: serial, version: 2 });
          const after = await fixture.deps.passes.get(serial, fixture.clock.now());
          const expiry = Date.parse(fields.endsAt) + EXPIRY_GRACE_MS;
          expect(after).toMatchObject({
            fields,
            version: 2,
            expiresAtMs: expiry,
            ttl: ttlOf(expiry),
          });
          expect(after?.lastUpdatedMs).toBeGreaterThan(before?.lastUpdatedMs ?? 0);
          for (const item of items(fixture, 'DEV#')) {
            expect(item.expiresAtMs).toBe(expiry);
            expect(item.ttl).toBe(ttlOf(expiry));
          }
          expect(fixture.apns.calls.flat()).toHaveLength(regs);
          expect(fixture.apns.calls).toHaveLength(regs === 0 ? 0 : 1);
          expect(fixture.google.patches).toHaveLength(google ? 1 : 0);
          if (google) {
            expect(fixture.google.patches[0]?.body).toMatchObject({
              state: 'ACTIVE',
              validTimeInterval: { end: { date: fields.endsAt } },
            });
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  test('a voided pass answers 404 and changes nothing', async () => {
    const fixture = createApiFixture();
    const serial = await fixture.issue(SUB);
    await fixture.call(route('POST', '/void', serial));
    const before = JSON.stringify(fixture.table.snapshot());
    const reply = await update(fixture, serial);
    expect(reply.result.statusCode).toBe(404);
    expect(JSON.stringify(fixture.table.snapshot())).toBe(before);
  });

  test('over the per-pass limit the update is stored but nothing is pushed; void still fans out', async () => {
    const fixture = createApiFixture();
    const serial = await fixture.issue(SUB, samplePassFields(), ['apple', 'google']);
    await register(fixture, serial, 2);
    for (let i = 0; i < 20; i += 1) {
      expect(
        (await update(fixture, serial, samplePassFields({ room: `R${i}` }))).result.statusCode,
      ).toBe(200);
    }
    expect(fixture.apns.calls).toHaveLength(20);
    expect(fixture.google.patches).toHaveLength(20);
    const over = await update(fixture, serial, samplePassFields({ room: 'Over' }));
    expect(over.json).toEqual({ serialNumber: serial, version: 22 });
    expect(fixture.apns.calls).toHaveLength(20);
    expect(fixture.google.patches).toHaveLength(20);
    const stored = await fixture.deps.passes.get(serial, fixture.clock.now());
    expect(stored?.fields.room).toBe('Over');
    await fixture.call(route('POST', '/void', serial));
    expect(fixture.apns.calls).toHaveLength(21);
    expect(fixture.google.patches).toHaveLength(21);
  });

  test('over the per-attendee limit of 120 updates the fan-out is skipped', async () => {
    const fixture = createApiFixture();
    const serials: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      serials.push(await fixture.issue(SUB, samplePassFields({ sessionCode: `PPP${100 + i}` })));
      await register(fixture, serials[i] as string, 1);
    }
    let sent = 0;
    for (let i = 0; i < 125; i += 1) {
      await update(
        fixture,
        serials[i % 7] as string,
        samplePassFields({ sessionCode: `PPP${100 + (i % 7)}`, room: `R${i}` }),
      );
      if (fixture.apns.calls.length > sent) {
        sent = fixture.apns.calls.length;
      }
    }
    expect(fixture.apns.calls).toHaveLength(120);
  });

  test('push outcomes become metrics: invalid tokens are deleted, failures and skips are counted', async () => {
    const fixture = createApiFixture();
    const serial = await fixture.issue(SUB);
    await register(fixture, serial, 3);
    fixture.apns.reply = (targets): PushOutcome => ({
      delivered: 0,
      invalid: [targets[0]!],
      failed: 2,
      skipped: false,
    });
    await update(fixture, serial);
    expect(lastLog(fixture.capture)).toMatchObject({ ApnsInvalidToken: 1, ApnsFailure: 2 });
    expect(items(fixture, 'DEV#')).toHaveLength(2);

    fixture.apns.reply = () => ({ delivered: 0, invalid: [], failed: 0, skipped: true });
    await update(fixture, serial, samplePassFields({ room: 'A' }));
    expect(lastLog(fixture.capture).ApnsSkipped).toBe(1);

    fixture.apns.push = () => Promise.reject(new Error('secret unavailable'));
    const reply = await update(fixture, serial, samplePassFields({ room: 'B' }));
    expect(reply.result.statusCode).toBe(200);
    expect(lastLog(fixture.capture).ApnsFailure).toBe(2);
  });

  test('Google patch failures are counted and never change the result', async () => {
    const fixture = createApiFixture();
    const serial = await fixture.issue(SUB, samplePassFields(), ['apple', 'google']);
    fixture.google.patchResult = () => 'failed';
    const reply = await update(fixture, serial);
    expect(reply.result.statusCode).toBe(200);
    expect(lastLog(fixture.capture).GoogleWalletFailure).toBe(1);
    fixture.google.patch = () => Promise.reject(new Error('boom'));
    expect((await update(fixture, serial, samplePassFields({ room: 'Z' }))).result.statusCode).toBe(
      200,
    );
    expect(lastLog(fixture.capture).GoogleWalletFailure).toBe(1);
  });

  test('a pass with Google disabled by configuration is never patched', async () => {
    const fixture = createApiFixture();
    const serial = await fixture.issue(SUB, samplePassFields(), ['apple', 'google']);
    const off = createApiFixture({
      env: { GOOGLE_WALLET_ENABLED: 'false', GOOGLE_SECRET_ID: undefined },
    });
    const lifecycle = createPassLifecycle({ ...fixture.deps, config: off.config });
    const rec = await fixture.deps.passes.get(serial, fixture.clock.now());
    await lifecycle.update({ subHash: SUB }, serial, samplePassFields({ room: 'Q' }), {
      now: fixture.clock.now(),
      metrics: createMetrics(),
    });
    await lifecycle.voidRecord(rec as PassRecord, {
      now: fixture.clock.now(),
      metrics: createMetrics(),
    });
    expect(fixture.google.patches).toHaveLength(0);
  });
});

describe('Feature: pass-service, void', () => {
  // Feature: pass-service, Property 18: Void is idempotent
  test('Property 18: void is idempotent and retries Google only while it is pending', async () => {
    await fixture_property();
  });

  async function fixture_property(): Promise<void> {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 0, max: 4 }),
        fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
        async (calls, regs, patchOk) => {
          const fixture = createApiFixture();
          const serial = await fixture.issue(SUB, samplePassFields(), ['apple', 'google']);
          await register(fixture, serial, regs);
          const before = await fixture.deps.passes.get(serial, fixture.clock.now());
          let attempt = 0;
          fixture.google.patchResult = () => (patchOk[attempt++] === true ? 'ok' : 'failed');
          for (let i = 0; i < calls; i += 1) {
            fixture.clock.advance(5000);
            const reply = await fixture.call(route('POST', '/void', serial));
            expect(reply.result.statusCode).toBe(200);
            expect(reply.json).toEqual({ serialNumber: serial, status: 'voided' });
          }
          const after = await fixture.deps.passes.get(serial, fixture.clock.now());
          expect(after?.status).toBe('voided');
          expect(after?.version).toBe((before?.version ?? 0) + 1);
          expect(after?.lastUpdatedMs).toBeGreaterThan(before?.lastUpdatedMs ?? 0);
          expect(fixture.apns.calls.flat()).toHaveLength(regs);
          // The first call patches; each later call patches again only while the earlier one failed.
          let expectedAttempts = 1;
          let state = patchOk[0] === true;
          for (let i = 1; i < calls && !state; i += 1) {
            expectedAttempts += 1;
            state = patchOk[i] === true;
          }
          expect(fixture.google.patches).toHaveLength(expectedAttempts);
          expect(after?.googleState).toBe(state ? 'inactive' : 'pending_inactive');
          expect(
            fixture.google.patches.every(
              (p) => (p.body as { state?: string }).state === 'INACTIVE',
            ),
          ).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  }

  test('a failed Google patch is counted and recorded as pending', async () => {
    const fixture = createApiFixture();
    const serial = await fixture.issue(SUB, samplePassFields(), ['apple', 'google']);
    fixture.google.patchResult = () => 'failed';
    await fixture.call(route('POST', '/void', serial));
    expect(lastLog(fixture.capture).GoogleWalletFailure).toBe(1);
    const stored = await fixture.deps.passes.get(serial, fixture.clock.now());
    expect(stored?.googleState).toBe('pending_inactive');
    expect(stored?.voidedAt).toBe(new Date(fixture.clock.now()).toISOString());
  });

  test('another attendee cannot void a pass', async () => {
    const fixture = createApiFixture();
    const serial = await fixture.issue(SUB);
    const reply = await fixture.call(route('POST', '/void', serial, OTHER));
    expect(reply.result.statusCode).toBe(404);
    expect((await fixture.deps.passes.get(serial, fixture.clock.now()))?.status).toBe('active');
  });
});

describe('Feature: pass-service, version conflicts', () => {
  async function setup() {
    const fixture = createApiFixture();
    const serial = await fixture.issue(SUB);
    const metrics = createMetrics();
    const op = { now: fixture.clock.now(), metrics };
    return { fixture, serial, op };
  }

  function withSave(
    fixture: ApiFixture,
    saves: ('conflict' | 'ok')[],
    between?: () => Promise<void>,
  ) {
    const real = fixture.deps.passes;
    let index = 0;
    return createPassLifecycle({
      ...fixture.deps,
      passes: {
        ...real,
        async save(rec, expected) {
          const outcome = saves[index] ?? 'ok';
          index += 1;
          if (outcome === 'conflict') {
            await between?.();
            return 'conflict';
          }
          return real.save(rec, expected);
        },
      },
    });
  }

  test('one conflict re-reads and retries once', async () => {
    const { fixture, serial, op } = await setup();
    const lifecycle = withSave(fixture, ['conflict']);
    const result = await lifecycle.update(
      { subHash: SUB },
      serial,
      samplePassFields({ room: 'R' }),
      op,
    );
    expect(result.version).toBe(2);
  });

  test('a second conflict is an error, never a silent overwrite', async () => {
    const { fixture, serial, op } = await setup();
    const lifecycle = withSave(fixture, ['conflict', 'conflict']);
    await expect(
      lifecycle.update({ subHash: SUB }, serial, samplePassFields({ room: 'R' }), op),
    ).rejects.toThrow('version conflict');
    expect((await fixture.deps.passes.get(serial, op.now))?.version).toBe(1);
  });

  test('a pass voided meanwhile: update is 404 and void is already done', async () => {
    const { fixture, serial, op } = await setup();
    const voidIt = async () => {
      const rec = (await fixture.deps.passes.get(serial, op.now)) as PassRecord;
      await fixture.deps.passes.save({ ...rec, status: 'voided', version: 2, voidedAt: 'x' }, 1);
    };
    const updating = withSave(fixture, ['conflict'], voidIt);
    await expect(
      updating.update({ subHash: SUB }, serial, samplePassFields({ room: 'R' }), op),
    ).rejects.toMatchObject({ status: 404 });
    const fresh = await setup();
    const voidFirst = async () => {
      const rec = (await fresh.fixture.deps.passes.get(fresh.serial, fresh.op.now)) as PassRecord;
      await fresh.fixture.deps.passes.save(
        { ...rec, status: 'voided', version: 2, voidedAt: 'x' },
        1,
      );
    };
    const voiding = withSave(fresh.fixture, ['conflict'], voidFirst);
    const rec = (await fresh.fixture.deps.passes.get(fresh.serial, fresh.op.now)) as PassRecord;
    expect(await voiding.voidRecord(rec, fresh.op)).toBe('already');
    expect(fresh.fixture.apns.calls).toHaveLength(0);
  });

  test('a pass deleted meanwhile: update is 404 and void is already done', async () => {
    const { fixture, serial, op } = await setup();
    const remove = async () => {
      await fixture.deps.passes.delete(serial);
    };
    const updating = withSave(fixture, ['conflict'], remove);
    await expect(
      updating.update({ subHash: SUB }, serial, samplePassFields({ room: 'R' }), op),
    ).rejects.toMatchObject({ status: 404 });
    const fresh = await setup();
    const rec = (await fresh.fixture.deps.passes.get(fresh.serial, fresh.op.now)) as PassRecord;
    const voiding = withSave(fresh.fixture, ['conflict'], async () => {
      await fresh.fixture.deps.passes.delete(fresh.serial);
    });
    expect(await voiding.voidRecord(rec, fresh.op)).toBe('already');
  });
});

describe('Feature: pass-service, issue', () => {
  test('two issues of the same session code in separate requests are fine', async () => {
    const fixture = createApiFixture();
    await fixture.issue(SUB);
    await fixture.issue(SUB);
    expect(items(fixture, 'PASS#')).toHaveLength(2);
  });
});

describe('Feature: pass-service, fan-out without persistence', () => {
  test('fanOutVoid with persist false patches Google and leaves the stored state alone', async () => {
    const fixture = createApiFixture();
    const serial = await fixture.issue(SUB, samplePassFields(), ['apple', 'google']);
    const rec = (await fixture.deps.passes.get(serial, fixture.clock.now())) as PassRecord;
    const lifecycle = createPassLifecycle(fixture.deps);
    await lifecycle.fanOutVoid(
      rec,
      [],
      { now: fixture.clock.now(), metrics: createMetrics() },
      false,
    );
    expect(fixture.google.patches).toHaveLength(1);
    expect((await fixture.deps.passes.get(serial, fixture.clock.now()))?.googleState).toBe(
      'active',
    );
  });
});
