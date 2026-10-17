// The one seam over DynamoDB. Production uses the DocumentClient adapter; tests and the
// local harness use the in-memory table, which has the same conditional semantics.

export interface Key {
  pk: string;
  sk: string;
}

export type Item = Record<string, unknown> & Key;

export interface QueryInput {
  index?: 'GSI2';
  pk: string;
  skPrefix?: string;
}

export interface TableClient {
  get(key: Key): Promise<Item | undefined>;
  /** Writes only when no item with the key exists. */
  putIfAbsent(item: Item): Promise<'ok' | 'exists'>;
  put(item: Item): Promise<void>;
  /** Sets the attributes only when the stored `version` equals the expected one. */
  updateIfVersion(
    key: Key,
    expectedVersion: number,
    set: Record<string, unknown>,
  ): Promise<'ok' | 'conflict'>;
  /** Sets attributes on an existing item; does nothing when the item is gone. */
  set(key: Key, set: Record<string, unknown>): Promise<void>;
  /** Returns true when an item was deleted. */
  delete(key: Key): Promise<boolean>;
  /** Deletes many items (chunks of 25). */
  batchDelete(keys: Key[]): Promise<void>;
  /** Follows LastEvaluatedKey to the end. Results are in ascending sort key order. */
  query(input: QueryInput): Promise<Item[]>;
  /**
   * Adds `units` to the `count` attribute in one conditional update: allowed only while
   * the count after the add stays at or under `max`. `attrs` are set on the item.
   */
  addCounter(
    key: Key,
    units: number,
    max: number,
    attrs: Record<string, unknown>,
  ): Promise<{ allowed: boolean }>;
}
