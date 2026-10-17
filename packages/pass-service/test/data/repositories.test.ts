import { describe, expect, test, vi } from 'vitest';
import { createHandoffRepository } from '../../src/data/handoff-repository.js';
import { EXPIRY_GRACE_MS, ttlOf } from '../../src/data/keys.js';
import { createPassRepository } from '../../src/data/pass-repository.js';
import type { DeviceRegistration, HandoffRecord, PassRecord } from '../../src/data/records.js';
import {
  MAX_REGISTRATIONS_PER_PASS,
  createRegistrationRepository,
} from '../../src/data/registration-repository.js';
import { createMemoryTable } from '../../src/harness/memory-table.js';
import { DependencyError } from '../../src/http/problem.js';
import { passFieldsArb, passFieldsSchema, samplePassFields } from '../helpers/pass-fields.js';
import fc from 'fast-check';

const NOW = Date.parse('2026-12-02T12:00:00Z');

function passRecord(overrides: Partial<PassRecord> = {}): PassRecord {
  const fields = samplePassFields();
  const expiresAtMs = Date.parse(fields.endsAt) + EXPIRY_GRACE_MS;
  return {
    serialNumber: '11111111-1111-4111-8111-111111111111',
    subHash: 'sub-a',
    pepperId: 'p1',
    sessionCode: fields.sessionCode,
    fields,
    platforms: ['apple'],
    authTokenHash: 'hash',
    tokenSalt: 'salt',
    status: 'active',
    version: 1,
    lastUpdatedMs: NOW,
    updateTagMs: NOW,
    googleState: 'none',
    createdAtMs: NOW,
    expiresAtMs,
    ttl: ttlOf(expiresAtMs),
    ...overrides,
  };
}

function registration(overrides: Partial<DeviceRegistration> = {}): DeviceRegistration {
  return {
    deviceHash: 'dev-1',
    serialNumber: '11111111-1111-4111-8111-111111111111',
    passTypeIdentifier: 'pass.test.compass',
    pushToken: 'aabb',
    subHash: 'sub-a',
    pepperId: 'p1',
    expiresAtMs: NOW + 1000,
    ttl: ttlOf(NOW + 1000),
    ...overrides,
  };
}

// Property tests do real work (signing, TLS, many records) and the machine may be busy.
vi.setConfig({ testTimeout: 120_000 });

describe('Feature: pass-service, test data generators', () => {
  test('every generated PassFields passes the shared schema', () => {
    fc.assert(
      fc.property(passFieldsArb, (fields) => {
        expect(passFieldsSchema.safeParse(fields).success).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});

describe('Feature: pass-service, pass repository', () => {
  test('create stores a clean record with index keys and a ttl at or after expiry', async () => {
    const table = createMemoryTable();
    const repo = createPassRepository(table);
    const rec = passRecord({ ttl: 1 });
    await repo.create(rec);
    const stored = table.snapshot()[0]!;
    expect(stored).toMatchObject({
      pk: `PASS#${rec.serialNumber}`,
      sk: 'PASS',
      gsi2pk: 'SUB#sub-a',
      gsi2sk: `PASS#${rec.serialNumber}`,
    });
    expect(stored.ttl).toBe(ttlOf(rec.expiresAtMs));
    expect(await repo.get(rec.serialNumber, NOW)).toEqual({ ...rec, ttl: ttlOf(rec.expiresAtMs) });
    await expect(repo.create(rec)).rejects.toBeInstanceOf(DependencyError);
  });

  test('an item at or past its expiry reads as absent even though it is still stored', async () => {
    const table = createMemoryTable();
    const repo = createPassRepository(table);
    const rec = passRecord();
    await repo.create(rec);
    expect(await repo.get(rec.serialNumber, rec.expiresAtMs - 1)).toBeDefined();
    expect(await repo.get(rec.serialNumber, rec.expiresAtMs)).toBeUndefined();
    expect(await repo.listBySub('sub-a', rec.expiresAtMs)).toEqual([]);
    expect(table.snapshot()).toHaveLength(1);
    expect(await repo.get('00000000-0000-4000-8000-000000000000', NOW)).toBeUndefined();
  });

  test('listBySub returns only that sub, live passes', async () => {
    const repo = createPassRepository(createMemoryTable());
    await repo.create(passRecord());
    await repo.create(passRecord({ serialNumber: '22222222-2222-4222-8222-222222222222' }));
    await repo.create(
      passRecord({ serialNumber: '33333333-3333-4333-8333-333333333333', subHash: 'sub-b' }),
    );
    const a = await repo.listBySub('sub-a', NOW);
    expect(a.map((r) => r.serialNumber)).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ]);
  });

  test('save needs the expected version, keeps unchanged fields, and writes voidedAt only when set', async () => {
    const repo = createPassRepository(createMemoryTable());
    const rec = passRecord();
    await repo.create(rec);
    const changed = passRecord({
      version: 2,
      status: 'voided',
      voidedAt: '2026-12-02T12:00:00.000Z',
      lastUpdatedMs: NOW + 1000,
      updateTagMs: NOW + 1234,
      googleState: 'pending_inactive',
      fields: samplePassFields({ room: 'Room 202' }),
    });
    expect(await repo.save(changed, 5)).toBe('conflict');
    expect(await repo.save(changed, 1)).toBe('ok');
    const read = await repo.get(rec.serialNumber, NOW);
    expect(read).toMatchObject({
      version: 2,
      status: 'voided',
      voidedAt: '2026-12-02T12:00:00.000Z',
      googleState: 'pending_inactive',
      subHash: 'sub-a',
      tokenSalt: 'salt',
    });
    expect(read?.fields.room).toBe('Room 202');
    const plain = passRecord({ version: 3 });
    expect(await repo.save(plain, 2)).toBe('ok');
    expect((await repo.get(rec.serialNumber, NOW))?.version).toBe(3);
  });

  test('setGoogleState and delete', async () => {
    const repo = createPassRepository(createMemoryTable());
    const rec = passRecord();
    await repo.create(rec);
    await repo.setGoogleState(rec.serialNumber, 'active');
    expect((await repo.get(rec.serialNumber, NOW))?.googleState).toBe('active');
    expect(await repo.delete(rec.serialNumber)).toBe(true);
    expect(await repo.delete(rec.serialNumber)).toBe(false);
    await repo.setGoogleState(rec.serialNumber, 'inactive');
    expect(await repo.get(rec.serialNumber, NOW)).toBeUndefined();
  });
});

describe('Feature: pass-service, registration repository', () => {
  test('upsert reports created then updated, and an expired item counts as created', async () => {
    const table = createMemoryTable();
    const repo = createRegistrationRepository(table);
    expect(await repo.upsert(registration(), NOW)).toBe('created');
    expect(await repo.upsert(registration({ pushToken: 'ccdd' }), NOW)).toBe('updated');
    expect((await repo.get('dev-1', registration().serialNumber, NOW))?.pushToken).toBe('ccdd');
    expect(await repo.upsert(registration(), NOW + 5000)).toBe('created');
    const stored = table.snapshot()[0]!;
    expect(stored).toMatchObject({
      pk: 'DEV#dev-1',
      sk: `REG#${registration().serialNumber}`,
      gsi1pk: `PASS#${registration().serialNumber}`,
      gsi1sk: 'DEV#dev-1',
      gsi2pk: 'SUB#sub-a',
      gsi2sk: `REG#dev-1#${registration().serialNumber}`,
    });
  });

  test('get hides an expired registration and delete removes one', async () => {
    const repo = createRegistrationRepository(createMemoryTable());
    await repo.upsert(registration(), NOW);
    expect(await repo.get('dev-1', registration().serialNumber, NOW + 1000)).toBeUndefined();
    expect(await repo.get('dev-1', registration().serialNumber, NOW)).toBeDefined();
    expect(await repo.delete('dev-1', registration().serialNumber)).toBe(true);
    expect(await repo.delete('dev-1', registration().serialNumber)).toBe(false);
  });

  test('listByDevice filters by pass type and expiry', async () => {
    const repo = createRegistrationRepository(createMemoryTable());
    await repo.upsert(registration(), NOW);
    await repo.upsert(
      registration({ serialNumber: 'other-serial', passTypeIdentifier: 'pass.other' }),
      NOW,
    );
    await repo.upsert(registration({ serialNumber: 'old-serial', expiresAtMs: NOW - 1 }), NOW);
    const list = await repo.listByDevice('dev-1', 'pass.test.compass', NOW);
    expect(list.map((r) => r.serialNumber)).toEqual([registration().serialNumber]);
    expect(await repo.listByDevice('dev-2', 'pass.test.compass', NOW)).toEqual([]);
  });

  test('listByPass returns at most ten live registrations through GSI1', async () => {
    const repo = createRegistrationRepository(createMemoryTable());
    for (let i = 0; i < 14; i += 1) {
      await repo.upsert(registration({ deviceHash: `dev-${String(i).padStart(2, '0')}` }), NOW);
    }
    await repo.upsert(registration({ deviceHash: 'dev-expired', expiresAtMs: NOW - 1 }), NOW);
    const list = await repo.listByPass(registration().serialNumber, NOW);
    expect(list).toHaveLength(MAX_REGISTRATIONS_PER_PASS);
    expect(list.every((r) => r.expiresAtMs > NOW)).toBe(true);
  });

  test('extendExpiry moves expiry and ttl on live registrations', async () => {
    const table = createMemoryTable();
    const repo = createRegistrationRepository(table);
    await repo.upsert(registration(), NOW);
    await repo.extendExpiry(registration().serialNumber, NOW + 90_000, NOW);
    const read = await repo.get('dev-1', registration().serialNumber, NOW);
    expect(read?.expiresAtMs).toBe(NOW + 90_000);
    expect(read?.ttl).toBe(ttlOf(NOW + 90_000));
  });
});

describe('Feature: pass-service, handoff repository', () => {
  test('create and get apply expiry and keep only a hash key', async () => {
    const table = createMemoryTable();
    const repo = createHandoffRepository(table);
    const rec: HandoffRecord = {
      handoffHash: 'h'.repeat(64),
      subHash: 'sub-a',
      pepperId: 'p1',
      serialNumbers: ['11111111-1111-4111-8111-111111111111'],
      include: { apple: true, google: false, calendar: true },
      expiresAtMs: NOW + 900_000,
      ttl: 0,
    };
    await repo.create(rec);
    const stored = table.snapshot()[0]!;
    expect(stored).toMatchObject({
      pk: `HANDOFF#${'h'.repeat(64)}`,
      gsi2pk: 'SUB#sub-a',
      gsi2sk: `HANDOFF#${'h'.repeat(64)}`,
    });
    expect(stored.ttl).toBe(ttlOf(NOW + 900_000));
    expect(await repo.get(rec.handoffHash, NOW + 899_999)).toEqual({
      ...rec,
      ttl: ttlOf(rec.expiresAtMs),
    });
    expect(await repo.get(rec.handoffHash, NOW + 900_000)).toBeUndefined();
    expect(await repo.get('missing', NOW)).toBeUndefined();
  });
});
