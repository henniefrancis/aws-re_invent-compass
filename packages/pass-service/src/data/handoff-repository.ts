// Handoff_Record storage. The key holds only the SHA-256 of the Handoff_Id.
import { HANDOFF_PREFIX, handoffKey, isLive, subIndexKey, ttlOf } from './keys.js';
import type { HandoffRecord } from './records.js';
import type { Item, TableClient } from './table-client.js';

export interface HandoffRepository {
  create(rec: HandoffRecord): Promise<void>;
  /** Undefined when absent or expired. */
  get(handoffHash: string, now: number): Promise<HandoffRecord | undefined>;
}

const INDEX_ATTRIBUTES = ['pk', 'sk', 'gsi2pk', 'gsi2sk'];

function toItem(rec: HandoffRecord): Item {
  return {
    ...rec,
    ...handoffKey(rec.handoffHash),
    ttl: ttlOf(rec.expiresAtMs),
    gsi2pk: subIndexKey(rec.subHash),
    gsi2sk: `${HANDOFF_PREFIX}${rec.handoffHash}`,
  };
}

function fromItem(item: Item): HandoffRecord {
  const plain: Record<string, unknown> = { ...item };
  for (const attribute of INDEX_ATTRIBUTES) {
    delete plain[attribute];
  }
  return plain as unknown as HandoffRecord;
}

export function createHandoffRepository(table: TableClient): HandoffRepository {
  return {
    async create(rec) {
      await table.put(toItem(rec));
    },

    async get(handoffHash, now) {
      const item = await table.get(handoffKey(handoffHash));
      return item !== undefined && isLive(item, now) ? fromItem(item) : undefined;
    },
  };
}
