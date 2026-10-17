// Pass_Record storage. Every read applies isLive(): an expired item is absent whether or
// not DynamoDB TTL has deleted it (Requirement 19.2).
import { DependencyError } from '../http/problem.js';
import { PASS_PREFIX, isLive, passKey, subIndexKey, ttlOf } from './keys.js';
import type { GoogleState, PassRecord } from './records.js';
import type { Item, TableClient } from './table-client.js';

export interface PassRepository {
  /** Writes with a condition that no item with the key exists. */
  create(rec: PassRecord): Promise<void>;
  /** Undefined when absent or expired. */
  get(serial: string, now: number): Promise<PassRecord | undefined>;
  listBySub(subHash: string, now: number): Promise<PassRecord[]>;
  /** Replaces the mutable fields when the stored version equals the expected one. */
  save(rec: PassRecord, expectedVersion: number): Promise<'ok' | 'conflict'>;
  setGoogleState(serial: string, state: GoogleState): Promise<void>;
  delete(serial: string): Promise<boolean>;
}

const INDEX_ATTRIBUTES = ['pk', 'sk', 'gsi2pk', 'gsi2sk'];

function toItem(rec: PassRecord): Item {
  return {
    ...rec,
    ...passKey(rec.serialNumber),
    ttl: ttlOf(rec.expiresAtMs),
    gsi2pk: subIndexKey(rec.subHash),
    gsi2sk: `${PASS_PREFIX}${rec.serialNumber}`,
  };
}

function fromItem(item: Item): PassRecord {
  const plain: Record<string, unknown> = { ...item };
  for (const attribute of INDEX_ATTRIBUTES) {
    delete plain[attribute];
  }
  return plain as unknown as PassRecord;
}

export function createPassRepository(table: TableClient): PassRepository {
  return {
    async create(rec) {
      if ((await table.putIfAbsent(toItem(rec))) === 'exists') {
        throw new DependencyError('dynamodb');
      }
    },

    async get(serial, now) {
      const item = await table.get(passKey(serial));
      return item !== undefined && isLive(item, now) ? fromItem(item) : undefined;
    },

    async listBySub(subHash, now) {
      const items = await table.query({
        index: 'GSI2',
        pk: subIndexKey(subHash),
        skPrefix: PASS_PREFIX,
      });
      return items.filter((item) => isLive(item, now)).map(fromItem);
    },

    async save(rec, expectedVersion) {
      return table.updateIfVersion(passKey(rec.serialNumber), expectedVersion, {
        fields: rec.fields,
        status: rec.status,
        version: rec.version,
        lastUpdatedMs: rec.lastUpdatedMs,
        expiresAtMs: rec.expiresAtMs,
        ttl: ttlOf(rec.expiresAtMs),
        googleState: rec.googleState,
        ...(rec.voidedAt === undefined ? {} : { voidedAt: rec.voidedAt }),
      });
    },

    async setGoogleState(serial, state) {
      await table.set(passKey(serial), { googleState: state });
    },

    async delete(serial) {
      return table.delete(passKey(serial));
    },
  };
}
