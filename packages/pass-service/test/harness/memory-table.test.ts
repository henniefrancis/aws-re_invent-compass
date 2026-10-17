import { describe, expect, test } from 'vitest';
import { DependencyError } from '../../src/http/problem.js';
import { createMemoryTable } from '../../src/harness/memory-table.js';

const key = (pk: string, sk: string) => ({ pk, sk });

describe('Feature: pass-service, in-memory table', () => {
  test('get, put and putIfAbsent keep copies, not references', async () => {
    const table = createMemoryTable();
    const item = { pk: 'A', sk: 'a', nested: { n: 1 } };
    expect(await table.get(key('A', 'a'))).toBeUndefined();
    expect(await table.putIfAbsent(item)).toBe('ok');
    expect(await table.putIfAbsent({ pk: 'A', sk: 'a', other: true })).toBe('exists');
    item.nested.n = 99;
    const read = await table.get(key('A', 'a'));
    expect(read).toEqual({ pk: 'A', sk: 'a', nested: { n: 1 } });
    (read as unknown as { nested: { n: number } }).nested.n = 5;
    expect(await table.get(key('A', 'a'))).toEqual({ pk: 'A', sk: 'a', nested: { n: 1 } });
    await table.put({ pk: 'A', sk: 'a', replaced: true });
    expect(await table.get(key('A', 'a'))).toEqual({ pk: 'A', sk: 'a', replaced: true });
  });

  test('updateIfVersion needs the item and the expected version', async () => {
    const table = createMemoryTable();
    expect(await table.updateIfVersion(key('A', 'a'), 1, { x: 1 })).toBe('conflict');
    await table.put({ pk: 'A', sk: 'a', version: 1 });
    expect(await table.updateIfVersion(key('A', 'a'), 2, { x: 1 })).toBe('conflict');
    expect(await table.updateIfVersion(key('A', 'a'), 1, { version: 2, x: 1 })).toBe('ok');
    expect(await table.get(key('A', 'a'))).toEqual({ pk: 'A', sk: 'a', version: 2, x: 1 });
  });

  test('set changes an existing item and ignores a missing one', async () => {
    const table = createMemoryTable();
    await table.set(key('A', 'a'), { x: 1 });
    expect(table.snapshot()).toEqual([]);
    await table.put({ pk: 'A', sk: 'a' });
    await table.set(key('A', 'a'), { x: 1 });
    expect(await table.get(key('A', 'a'))).toEqual({ pk: 'A', sk: 'a', x: 1 });
  });

  test('delete reports whether an item was removed, and batchDelete removes many', async () => {
    const table = createMemoryTable();
    await table.put({ pk: 'A', sk: 'a' });
    await table.put({ pk: 'A', sk: 'b' });
    await table.put({ pk: 'A', sk: 'c' });
    expect(await table.delete(key('A', 'a'))).toBe(true);
    expect(await table.delete(key('A', 'a'))).toBe(false);
    await table.batchDelete([key('A', 'b'), key('A', 'zzz')]);
    expect(table.snapshot()).toEqual([{ pk: 'A', sk: 'c' }]);
    await table.put({ pk: 'A', sk: 'b' });
    expect(table.snapshot().map((i) => i.sk)).toEqual(['b', 'c']);
  });

  test('batchDelete rejects a batch that names the same key twice, as DynamoDB does', async () => {
    const table = createMemoryTable();
    await table.put({ pk: 'A', sk: 'a' });
    await expect(table.batchDelete([key('A', 'a'), key('A', 'a')])).rejects.toBeInstanceOf(
      DependencyError,
    );
    expect(table.snapshot()).toHaveLength(1);
  });

  test('query reads the table or a GSI with an optional prefix, in byte order', async () => {
    const table = createMemoryTable();
    await table.put({
      pk: 'P',
      sk: 'REG#b',
      gsi1pk: 'G',
      gsi1sk: 'D#2',
      gsi2pk: 'S',
      gsi2sk: 'x#2',
    });
    await table.put({
      pk: 'P',
      sk: 'REG#a',
      gsi1pk: 'G',
      gsi1sk: 'D#1',
      gsi2pk: 'S',
      gsi2sk: 'y#1',
    });
    await table.put({ pk: 'P', sk: 'PASS', gsi1pk: 'G', gsi1sk: 'E#3' });
    await table.put({ pk: 'Q', sk: 'REG#c' });
    const base = await table.query({ pk: 'P', skPrefix: 'REG#' });
    expect(base.map((i) => i.sk)).toEqual(['REG#a', 'REG#b']);
    expect((await table.query({ pk: 'P' })).map((i) => i.sk)).toEqual(['PASS', 'REG#a', 'REG#b']);
    expect(
      (await table.query({ index: 'GSI2', pk: 'S', skPrefix: 'x' })).map((i) => i.gsi2sk),
    ).toEqual(['x#2']);
    expect((await table.query({ index: 'GSI2', pk: 'S' })).map((i) => i.gsi2sk)).toEqual([
      'x#2',
      'y#1',
    ]);
    expect(await table.query({ pk: 'none' })).toEqual([]);
  });

  test('addCounter adds up to the max and refuses beyond it', async () => {
    const table = createMemoryTable();
    const k = key('RATE#s', 'passWrites#0');
    expect(await table.addCounter(k, 30, 60, { windowStartSec: 0 })).toEqual({ allowed: true });
    expect(await table.addCounter(k, 30, 60, { windowStartSec: 0 })).toEqual({ allowed: true });
    expect(await table.addCounter(k, 1, 60, { windowStartSec: 0 })).toEqual({ allowed: false });
    expect(table.snapshot()[0]).toMatchObject({ count: 60, windowStartSec: 0 });
    expect(await table.addCounter(key('RATE#t', 'x'), 61, 60, {})).toEqual({ allowed: false });
    expect(table.snapshot()).toHaveLength(1);
  });

  test('conditional updates stay atomic when callers interleave', async () => {
    let turns = 0;
    const table = createMemoryTable({
      interleave: async () => {
        turns += 1;
        for (let i = 0; i < turns % 3; i += 1) {
          await Promise.resolve();
        }
      },
    });
    const k = key('RATE#s', 'passWrites#0');
    const results = await Promise.all(
      Array.from({ length: 20 }, () => table.addCounter(k, 5, 60, {})),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(12);
    expect(table.snapshot()[0]).toMatchObject({ count: 60 });
  });
});
