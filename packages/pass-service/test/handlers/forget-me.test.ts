import fc from 'fast-check';
import { describe, expect, test, vi } from 'vitest';
import { MAX_READ_ROUNDS } from '../../src/handlers/api/forget-me.js';
import type { Item } from '../../src/data/table-client.js';
import { createApiFixture, type ApiFixture } from '../helpers/api-fixture.js';
import { makePassRecord, serialOf } from '../helpers/pass-record.js';

const subOf = (n: number) => String(n).repeat(64);
const forget = (fixture: ApiFixture, sub: string | undefined) =>
  fixture.call({ method: 'DELETE', resource: '/api/v1/me', token: sub });

type PassState = 'active' | 'voided' | 'expired';

interface Seed {
  sub: number;
  state: PassState;
  google: boolean;
  registrations: number;
  expiredRegistration: boolean;
}

async function seedAll(fixture: ApiFixture, seeds: Seed[]) {
  const now = fixture.clock.now();
  let counter = 0;
  for (const seed of seeds) {
    counter += 1;
    const serial = serialOf(counter);
    const sub = subOf(seed.sub);
    const pass = makePassRecord(sub, serial, {
      status: seed.state === 'voided' ? 'voided' : 'active',
      googleState: seed.google ? 'active' : 'none',
      expiresAtMs: seed.state === 'expired' ? now - 1 : now + 3_600_000,
    });
    await fixture.deps.passes.create(pass);
    for (let i = 0; i < seed.registrations; i += 1) {
      await fixture.deps.registrations.upsert(
        {
          deviceHash: `device-${counter}-${i}`,
          serialNumber: serial,
          passTypeIdentifier: 'pass.test.compass',
          pushToken: `0${i}ab`,
          subHash: sub,
          pepperId: 'test-1',
          expiresAtMs: seed.expiredRegistration && i === 0 ? now - 1 : now + 3_600_000,
          ttl: 0,
        },
        now,
      );
    }
    await fixture.deps.handoffs.create({
      handoffHash: `hash-${counter}`.padEnd(64, '0'),
      subHash: sub,
      pepperId: 'test-1',
      serialNumbers: [serial],
      include: { apple: true, google: false, calendar: false },
      expiresAtMs: now + 600_000,
      ttl: 0,
    });
    await fixture.deps.limiter.record(sub, 'passWrites', 1, now);
  }
}

function itemsOf(fixture: ApiFixture, sub: string): Item[] {
  return fixture.table
    .snapshot()
    .filter((item) => item.subHash === sub || item.gsi2pk === `SUB#${sub}`);
}

function storedNonCounters(items: Item[]): Item[] {
  return items.filter((item) => !item.pk.startsWith('RATE#'));
}

// Property tests do real work (signing, TLS, many records) and the machine may be busy.
vi.setConfig({ testTimeout: 120_000 });

describe('Feature: pass-service, forget me', () => {
  // Feature: pass-service, Property 33: forget_me removes exactly the caller's items
  test("Property 33: removes exactly the caller's items, voids each live active pass once", async () => {
    const seedArb = fc.record({
      sub: fc.integer({ min: 1, max: 3 }),
      state: fc.constantFrom<PassState>('active', 'voided', 'expired'),
      google: fc.boolean(),
      registrations: fc.integer({ min: 0, max: 3 }),
      expiredRegistration: fc.boolean(),
    });
    await fc.assert(
      fc.asyncProperty(fc.array(seedArb, { minLength: 0, maxLength: 9 }), async (seeds) => {
        const fixture = createApiFixture();
        await seedAll(fixture, seeds);
        const caller = subOf(1);
        const mine = seeds.filter((seed) => seed.sub === 1);
        const notMine = (item: Item) => item.subHash !== caller && item.gsi2pk !== `SUB#${caller}`;
        const othersBefore = JSON.stringify(fixture.table.snapshot().filter(notMine));
        const reply = await forget(fixture, caller);
        expect(reply.result.statusCode).toBe(202);
        const live = mine.filter((seed) => seed.state === 'active');
        const expectedDeleted =
          mine.length * 2 + mine.reduce((sum, seed) => sum + seed.registrations, 0);
        expect(reply.json).toEqual({ voided: live.length, deleted: expectedDeleted });
        expect(storedNonCounters(itemsOf(fixture, caller))).toEqual([]);
        expect(JSON.stringify(fixture.table.snapshot().filter(notMine))).toBe(othersBefore);
        const pushes = live.reduce(
          (sum, seed) =>
            sum +
            (seed.expiredRegistration && seed.registrations > 0
              ? seed.registrations - 1
              : seed.registrations),
          0,
        );
        expect(fixture.apns.calls.flat()).toHaveLength(pushes);
        expect(fixture.google.patches).toHaveLength(live.filter((seed) => seed.google).length);
        expect(
          fixture.google.patches.every(
            (patch) => (patch.body as { state?: string }).state === 'INACTIVE',
          ),
        ).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  test('a caller with no items gets 202 with zero counts', async () => {
    const fixture = createApiFixture();
    const reply = await forget(fixture, subOf(9));
    expect(reply.json).toEqual({ voided: 0, deleted: 0 });
    expect(fixture.apns.calls).toHaveLength(0);
  });

  test('rate counters are never deleted, and the call itself is counted', async () => {
    const fixture = createApiFixture();
    await seedAll(fixture, [
      { sub: 1, state: 'active', google: false, registrations: 1, expiredRegistration: false },
    ]);
    await forget(fixture, subOf(1));
    const counters = fixture.table.snapshot().filter((item) => item.pk.startsWith('RATE#'));
    expect(counters.map((c) => c.sk.split('#')[0]).sort()).toEqual(['forgetMe', 'passWrites']);
  });

  test('401 without a token', async () => {
    const fixture = createApiFixture();
    expect((await forget(fixture, undefined)).result.statusCode).toBe(401);
  });

  test('the data is gone before the fan-out starts', async () => {
    const fixture = createApiFixture();
    await seedAll(fixture, [
      { sub: 1, state: 'active', google: true, registrations: 2, expiredRegistration: false },
    ]);
    let seenAtPush = -1;
    fixture.apns.reply = (targets) => {
      seenAtPush = storedNonCounters(itemsOf(fixture, subOf(1))).length;
      return { delivered: targets.length, invalid: [], failed: 0, skipped: false };
    };
    await forget(fixture, subOf(1));
    expect(seenAtPush).toBe(0);
  });

  test('over the forgetMe limit the data is still erased but nothing is pushed or patched', async () => {
    const fixture = createApiFixture();
    for (let i = 0; i < 5; i += 1) {
      await forget(fixture, subOf(1));
    }
    await seedAll(fixture, [
      { sub: 1, state: 'active', google: true, registrations: 2, expiredRegistration: false },
    ]);
    const reply = await forget(fixture, subOf(1));
    expect(reply.result.statusCode).toBe(202);
    expect(reply.json).toEqual({ voided: 1, deleted: 4 });
    expect(storedNonCounters(itemsOf(fixture, subOf(1)))).toEqual([]);
    expect(fixture.apns.calls).toHaveLength(0);
    expect(fixture.google.patches).toHaveLength(0);
  });

  test('a fan-out that never finishes is cut at the budget and the answer is still 202', async () => {
    const fixture = createApiFixture({ env: { APNS_BUDGET_MS: '100' } });
    await seedAll(fixture, [
      { sub: 1, state: 'active', google: false, registrations: 1, expiredRegistration: false },
    ]);
    fixture.apns.push = () => new Promise(() => undefined);
    const started = Date.now();
    const reply = await forget(fixture, subOf(1));
    expect(reply.result.statusCode).toBe(202);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test('items that appear between reads are erased too, within three reads', async () => {
    let late = 0;
    const fixture = createApiFixture();
    const real = fixture.deps.table.batchDelete.bind(fixture.deps.table);
    fixture.deps.table.batchDelete = async (keys) => {
      await real(keys);
      if (late < MAX_READ_ROUNDS) {
        late += 1;
        await fixture.deps.passes.create(makePassRecord(subOf(1), serialOf(100 + late)));
      }
    };
    const reply = await forget(fixture, subOf(1));
    // Rounds one to three each found one pass; the third arrival is left for the next call.
    expect((reply.json as { deleted: number }).deleted).toBe(2);
    expect(late).toBe(MAX_READ_ROUNDS);
  });

  test('a hand-off, registrations and expired passes of the caller are erased as well', async () => {
    const fixture = createApiFixture();
    await seedAll(fixture, [
      { sub: 1, state: 'expired', google: false, registrations: 2, expiredRegistration: true },
      { sub: 1, state: 'voided', google: true, registrations: 1, expiredRegistration: false },
    ]);
    const reply = await forget(fixture, subOf(1));
    expect(reply.json).toEqual({ voided: 0, deleted: 7 });
    expect(fixture.apns.calls).toHaveLength(0);
  });
});

describe('Feature: pass-service, health', () => {
  test('answers 200 with status and version, without the hardening headers', async () => {
    let tableCalls = 0;
    const fixture = createApiFixture({
      interleave: () => {
        tableCalls += 1;
        return Promise.resolve();
      },
    });
    const reply = await fixture.call({ method: 'GET', resource: '/api/v1/health' });
    expect(reply.result.statusCode).toBe(200);
    expect(reply.json).toEqual({ status: 'ok', version: '1.2.3' });
    expect(reply.result.headers['cache-control']).toBeUndefined();
    expect(tableCalls).toBe(0);
    expect(fixture.secrets.reads).toEqual({ app: 0, origin: 1, apple: 0, google: 0 });
  });

  test('is still behind the origin guard', async () => {
    const fixture = createApiFixture();
    const reply = await fixture.call({ method: 'GET', resource: '/api/v1/health', origin: null });
    expect(reply.result.statusCode).toBe(403);
  });
});
