// An in-memory TableClient with the same conditional and query semantics as the DynamoDB
// adapter. Used by the unit tests and by the owner-run local harness. The optional
// `interleave` hook runs before every operation so a test can yield to other callers
// and so prove that conditional updates stay atomic.
import type { Item, Key, QueryInput, TableClient } from '../data/table-client.js';
import { DependencyError } from '../http/problem.js';

export interface MemoryTable extends TableClient {
  /** A copy of every stored item, in key order. */
  snapshot(): Item[];
}

export interface MemoryTableOptions {
  interleave?: () => Promise<void>;
}

function mapKey(key: Key): string {
  return `${key.pk}\u0000${key.sk}`;
}

function indexAttributes(index: QueryInput['index']): { pk: string; sk: string } {
  if (index === 'GSI2') {
    return { pk: 'gsi2pk', sk: 'gsi2sk' };
  }
  return { pk: 'pk', sk: 'sk' };
}

/** DynamoDB sorts by UTF-8 bytes. */
function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

function copy(item: Item): Item {
  return structuredClone(item);
}

export function createMemoryTable(options: MemoryTableOptions = {}): MemoryTable {
  const items = new Map<string, Item>();

  async function turn(): Promise<void> {
    await options.interleave?.();
  }

  function applySet(item: Item, set: Record<string, unknown>): void {
    for (const [attribute, value] of Object.entries(set)) {
      item[attribute] = structuredClone(value);
    }
  }

  return {
    async get(key) {
      await turn();
      const found = items.get(mapKey(key));
      return found === undefined ? undefined : copy(found);
    },

    async putIfAbsent(item) {
      await turn();
      if (items.has(mapKey(item))) {
        return 'exists';
      }
      items.set(mapKey(item), copy(item));
      return 'ok';
    },

    async put(item) {
      await turn();
      items.set(mapKey(item), copy(item));
    },

    async updateIfVersion(key, expectedVersion, set) {
      await turn();
      const found = items.get(mapKey(key));
      if (found === undefined || found.version !== expectedVersion) {
        return 'conflict';
      }
      applySet(found, set);
      return 'ok';
    },

    async set(key, set) {
      await turn();
      const found = items.get(mapKey(key));
      if (found !== undefined) {
        applySet(found, set);
      }
    },

    async delete(key) {
      await turn();
      return items.delete(mapKey(key));
    },

    async batchDelete(keys) {
      await turn();
      if (new Set(keys.map(mapKey)).size !== keys.length) {
        // DynamoDB rejects a batch that names the same key twice.
        throw new DependencyError('dynamodb');
      }
      for (const key of keys) {
        items.delete(mapKey(key));
      }
    },

    async query(input) {
      await turn();
      const names = indexAttributes(input.index);
      const matches = [...items.values()].filter(
        (item) =>
          item[names.pk] === input.pk &&
          (input.skPrefix === undefined || String(item[names.sk]).startsWith(input.skPrefix)),
      );
      matches.sort((a, b) => byteOrder(String(a[names.sk]), String(b[names.sk])));
      return matches.map(copy);
    },

    async addCounter(key, units, max, attrs) {
      await turn();
      const found = items.get(mapKey(key));
      const current = typeof found?.count === 'number' ? found.count : undefined;
      if (units > max || (current !== undefined && current > max - units)) {
        return { allowed: false };
      }
      const item: Item = found ?? { ...key };
      item.count = (current ?? 0) + units;
      applySet(item, attrs);
      items.set(mapKey(key), item);
      return { allowed: true };
    },

    snapshot() {
      return [...items.values()].sort((a, b) => byteOrder(mapKey(a), mapKey(b))).map(copy);
    },
  };
}
