import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { describe, expect, test, vi } from 'vitest';
import { createDynamoTableClient, type DocClient } from '../../src/data/dynamo-table-client.js';
import { DependencyError } from '../../src/http/problem.js';

type Reply = unknown;

function fakeDoc(...replies: Reply[]) {
  const sent: { name: string; input: Record<string, unknown> }[] = [];
  let index = 0;
  const send = vi.fn(
    (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      sent.push({ name: command.constructor.name, input: command.input });
      const reply = replies[Math.min(index, replies.length - 1)];
      index += 1;
      return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply ?? {});
    },
  );
  return { doc: { send } as unknown as DocClient, sent };
}

const conditionFailure = () =>
  new ConditionalCheckFailedException({ message: 'no', $metadata: {} });

describe('Feature: pass-service, DynamoDB table client', () => {
  test('get sends a consistent GetCommand and returns the item', async () => {
    const { doc, sent } = fakeDoc({ Item: { pk: 'A', sk: 'a' } });
    const table = createDynamoTableClient(doc, 'compass-dev');
    expect(await table.get({ pk: 'A', sk: 'a' })).toEqual({ pk: 'A', sk: 'a' });
    expect(sent[0]).toEqual({
      name: 'GetCommand',
      input: { TableName: 'compass-dev', Key: { pk: 'A', sk: 'a' }, ConsistentRead: true },
    });
  });

  test('putIfAbsent sends attribute_not_exists and maps the condition failure to exists', async () => {
    const ok = fakeDoc({});
    expect(await createDynamoTableClient(ok.doc, 't').putIfAbsent({ pk: 'A', sk: 'a' })).toBe('ok');
    expect(ok.sent[0]?.input).toEqual({
      TableName: 't',
      Item: { pk: 'A', sk: 'a' },
      ConditionExpression: 'attribute_not_exists(pk)',
    });
    const exists = fakeDoc(conditionFailure());
    expect(await createDynamoTableClient(exists.doc, 't').putIfAbsent({ pk: 'A', sk: 'a' })).toBe(
      'exists',
    );
  });

  test('put sends a plain PutCommand', async () => {
    const { doc, sent } = fakeDoc({});
    await createDynamoTableClient(doc, 't').put({ pk: 'A', sk: 'a', x: 1 });
    expect(sent[0]).toEqual({
      name: 'PutCommand',
      input: { TableName: 't', Item: { pk: 'A', sk: 'a', x: 1 } },
    });
  });

  test('updateIfVersion sets attributes under a version condition', async () => {
    const ok = fakeDoc({});
    const table = createDynamoTableClient(ok.doc, 't');
    expect(
      await table.updateIfVersion({ pk: 'A', sk: 'a' }, 3, { version: 4, status: 'voided' }),
    ).toBe('ok');
    expect(ok.sent[0]).toEqual({
      name: 'UpdateCommand',
      input: {
        TableName: 't',
        Key: { pk: 'A', sk: 'a' },
        UpdateExpression: 'SET #f0 = :v0, #f1 = :v1',
        ConditionExpression: 'attribute_exists(#pk) AND #cv = :expected',
        ExpressionAttributeNames: {
          '#f0': 'version',
          '#f1': 'status',
          '#pk': 'pk',
          '#cv': 'version',
        },
        ExpressionAttributeValues: { ':v0': 4, ':v1': 'voided', ':expected': 3 },
      },
    });
    const conflict = fakeDoc(conditionFailure());
    expect(
      await createDynamoTableClient(conflict.doc, 't').updateIfVersion({ pk: 'A', sk: 'a' }, 1, {
        version: 2,
      }),
    ).toBe('conflict');
  });

  test('setIfEquals sets attributes under an equality condition on the item', async () => {
    const ok = fakeDoc({});
    const table = createDynamoTableClient(ok.doc, 't');
    expect(
      await table.setIfEquals({ pk: 'A', sk: 'a' }, 'status', 'active', { googleState: 'active' }),
    ).toBe('ok');
    expect(ok.sent[0]).toEqual({
      name: 'UpdateCommand',
      input: {
        TableName: 't',
        Key: { pk: 'A', sk: 'a' },
        UpdateExpression: 'SET #f0 = :v0',
        ConditionExpression: 'attribute_exists(#pk) AND #ca = :expected',
        ExpressionAttributeNames: { '#f0': 'googleState', '#pk': 'pk', '#ca': 'status' },
        ExpressionAttributeValues: { ':v0': 'active', ':expected': 'active' },
      },
    });
    const refused = fakeDoc(conditionFailure());
    expect(
      await createDynamoTableClient(refused.doc, 't').setIfEquals(
        { pk: 'A', sk: 'a' },
        'status',
        'active',
        { googleState: 'active' },
      ),
    ).toBe('conflict');
  });

  test('set updates only an existing item and swallows a missing one', async () => {
    const ok = fakeDoc({});
    await createDynamoTableClient(ok.doc, 't').set({ pk: 'A', sk: 'a' }, { googleState: 'active' });
    expect(ok.sent[0]?.input).toMatchObject({
      UpdateExpression: 'SET #f0 = :v0',
      ConditionExpression: 'attribute_exists(#pk)',
      ExpressionAttributeNames: { '#f0': 'googleState', '#pk': 'pk' },
      ExpressionAttributeValues: { ':v0': 'active' },
    });
    const gone = fakeDoc(conditionFailure());
    await expect(
      createDynamoTableClient(gone.doc, 't').set({ pk: 'A', sk: 'a' }, { x: 1 }),
    ).resolves.toBeUndefined();
  });

  test('delete asks for the old item and reports whether one existed', async () => {
    const had = fakeDoc({ Attributes: { pk: 'A' } });
    expect(await createDynamoTableClient(had.doc, 't').delete({ pk: 'A', sk: 'a' })).toBe(true);
    expect(had.sent[0]).toEqual({
      name: 'DeleteCommand',
      input: { TableName: 't', Key: { pk: 'A', sk: 'a' }, ReturnValues: 'ALL_OLD' },
    });
    const none = fakeDoc({});
    expect(await createDynamoTableClient(none.doc, 't').delete({ pk: 'A', sk: 'a' })).toBe(false);
  });

  test('batchDelete sends chunks of 25 and retries unprocessed keys', async () => {
    const keys = Array.from({ length: 30 }, (_, i) => ({ pk: `K${i}`, sk: 's' }));
    const { doc, sent } = fakeDoc(
      { UnprocessedItems: { t: [{ DeleteRequest: { Key: keys[0] } }] } },
      {},
      {},
    );
    await createDynamoTableClient(doc, 't').batchDelete(keys);
    expect(sent.map((s) => s.name)).toEqual([
      'BatchWriteCommand',
      'BatchWriteCommand',
      'BatchWriteCommand',
    ]);
    const first = sent[0]?.input.RequestItems as Record<string, unknown[]>;
    const second = sent[1]?.input.RequestItems as Record<string, unknown[]>;
    const third = sent[2]?.input.RequestItems as Record<string, unknown[]>;
    expect(first.t).toHaveLength(25);
    expect(second.t).toEqual([{ DeleteRequest: { Key: keys[0] } }]);
    expect(third.t).toHaveLength(5);
  });

  test('batchDelete sends each key once even when it is named twice', async () => {
    const { doc, sent } = fakeDoc({});
    await createDynamoTableClient(doc, 't').batchDelete([
      { pk: 'A', sk: 'a' },
      { pk: 'B', sk: 'b' },
      { pk: 'A', sk: 'a' },
    ]);
    const first = sent[0]?.input.RequestItems as Record<string, unknown[]>;
    expect(sent).toHaveLength(1);
    expect(first.t).toHaveLength(2);
  });

  test('batchDelete gives up when keys stay unprocessed', async () => {
    const stuck = { UnprocessedItems: { t: [{ DeleteRequest: { Key: { pk: 'A', sk: 'a' } } }] } };
    const { doc, sent } = fakeDoc(stuck);
    await expect(
      createDynamoTableClient(doc, 't').batchDelete([{ pk: 'A', sk: 'a' }]),
    ).rejects.toBeInstanceOf(DependencyError);
    expect(sent).toHaveLength(4);
  });

  test('query reads the table, a GSI, with and without a prefix, and follows pagination', async () => {
    const paged = fakeDoc(
      { Items: [{ pk: 'A', sk: 'a' }], LastEvaluatedKey: { pk: 'A', sk: 'a' } },
      { Items: [{ pk: 'A', sk: 'b' }] },
    );
    const table = createDynamoTableClient(paged.doc, 't');
    expect((await table.query({ pk: 'A', skPrefix: 'a' })).map((i) => i.sk)).toEqual(['a', 'b']);
    expect(paged.sent[0]?.input).toEqual({
      TableName: 't',
      ConsistentRead: true,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
      ExpressionAttributeNames: { '#pk': 'pk', '#sk': 'sk' },
      ExpressionAttributeValues: { ':pk': 'A', ':prefix': 'a' },
      ExclusiveStartKey: undefined,
    });
    expect(paged.sent[1]?.input.ExclusiveStartKey).toEqual({ pk: 'A', sk: 'a' });

    const gsi = fakeDoc({});
    expect(
      await createDynamoTableClient(gsi.doc, 't').query({ index: 'GSI2', pk: 'SUB#x' }),
    ).toEqual([]);
    expect(gsi.sent[0]?.input).toEqual({
      TableName: 't',
      IndexName: 'GSI2',
      KeyConditionExpression: '#pk = :pk',
      ExpressionAttributeNames: { '#pk': 'gsi2pk' },
      ExpressionAttributeValues: { ':pk': 'SUB#x' },
      ExclusiveStartKey: undefined,
    });

    const gsi2 = fakeDoc({ Items: [] });
    await createDynamoTableClient(gsi2.doc, 't').query({ index: 'GSI2', pk: 'P', skPrefix: 'D' });
    expect(gsi2.sent[0]?.input).toMatchObject({
      IndexName: 'GSI2',
      ExpressionAttributeNames: { '#pk': 'gsi2pk', '#sk': 'gsi2sk' },
    });
  });

  test('addCounter adds under a conditional update, with and without attributes', async () => {
    const ok = fakeDoc({});
    const table = createDynamoTableClient(ok.doc, 't');
    expect(await table.addCounter({ pk: 'R', sk: 'k' }, 5, 60, { kind: 'passWrites' })).toEqual({
      allowed: true,
    });
    expect(ok.sent[0]).toEqual({
      name: 'UpdateCommand',
      input: {
        TableName: 't',
        Key: { pk: 'R', sk: 'k' },
        UpdateExpression: 'ADD #count :units SET #a0 = :a0',
        ConditionExpression: 'attribute_not_exists(#count) OR #count <= :limit',
        ExpressionAttributeNames: { '#count': 'count', '#a0': 'kind' },
        ExpressionAttributeValues: { ':units': 5, ':limit': 55, ':a0': 'passWrites' },
      },
    });
    await table.addCounter({ pk: 'R', sk: 'k' }, 1, 60, {});
    expect(ok.sent[1]?.input.UpdateExpression).toBe('ADD #count :units');
    const refused = fakeDoc(conditionFailure());
    expect(
      await createDynamoTableClient(refused.doc, 't').addCounter({ pk: 'R', sk: 'k' }, 1, 60, {}),
    ).toEqual({ allowed: false });
  });

  test('a request larger than the max is refused without calling DynamoDB', async () => {
    const { doc, sent } = fakeDoc({});
    expect(
      await createDynamoTableClient(doc, 't').addCounter({ pk: 'R', sk: 'k' }, 61, 60, {}),
    ).toEqual({
      allowed: false,
    });
    expect(sent).toHaveLength(0);
  });

  test('any other failure becomes a dependency error without detail', async () => {
    const boom = new Error('arn:aws:dynamodb:secret-detail');
    const table = createDynamoTableClient(fakeDoc(boom).doc, 't');
    const attempts: Promise<unknown>[] = [
      table.get({ pk: 'A', sk: 'a' }),
      table.putIfAbsent({ pk: 'A', sk: 'a' }),
      table.put({ pk: 'A', sk: 'a' }),
      table.updateIfVersion({ pk: 'A', sk: 'a' }, 1, { version: 2 }),
      table.setIfEquals({ pk: 'A', sk: 'a' }, 'status', 'active', { x: 1 }),
      table.set({ pk: 'A', sk: 'a' }, { x: 1 }),
      table.delete({ pk: 'A', sk: 'a' }),
      table.batchDelete([{ pk: 'A', sk: 'a' }]),
      table.query({ pk: 'A' }),
      table.addCounter({ pk: 'A', sk: 'a' }, 1, 5, {}),
    ];
    for (const attempt of attempts) {
      const error = await attempt.then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(DependencyError);
      expect((error as Error).message).not.toContain('arn');
      expect((error as Error).cause).toBeUndefined();
    }
  });
});
