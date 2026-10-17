// DynamoDB adapter for the TableClient seam, over the AWS SDK v3 DocumentClient.
// Each method is one command. A ConditionalCheckFailedException maps to the result
// values; any other failure becomes DependencyError('dynamodb') with no detail.
// Docs: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import { DependencyError } from '../http/problem.js';
import type { Item, Key, QueryInput, TableClient } from './table-client.js';

export type DocClient = Pick<DynamoDBDocumentClient, 'send'>;

const BATCH_SIZE = 25;
const BATCH_ATTEMPTS = 4;

interface Expression {
  update: string;
  names: Record<string, string>;
  values: Record<string, unknown>;
}

function setExpression(set: Record<string, unknown>): Expression {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const clauses = Object.entries(set).map(([attribute, value], i) => {
    names[`#f${i}`] = attribute;
    values[`:v${i}`] = value;
    return `#f${i} = :v${i}`;
  });
  return { update: `SET ${clauses.join(', ')}`, names, values };
}

function indexNames(index: QueryInput['index']): { pk: string; sk: string } {
  if (index === 'GSI1') {
    return { pk: 'gsi1pk', sk: 'gsi1sk' };
  }
  if (index === 'GSI2') {
    return { pk: 'gsi2pk', sk: 'gsi2sk' };
  }
  return { pk: 'pk', sk: 'sk' };
}

async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch {
    throw new DependencyError('dynamodb');
  }
}

/** Runs a conditional command; returns false when the condition failed. */
async function conditional(run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run();
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      return false;
    }
    throw new DependencyError('dynamodb');
  }
}

export function createDynamoTableClient(doc: DocClient, tableName: string): TableClient {
  return {
    async get(key) {
      const out = await guarded(() =>
        doc.send(new GetCommand({ TableName: tableName, Key: key, ConsistentRead: true })),
      );
      return out.Item as Item | undefined;
    },

    async putIfAbsent(item) {
      const written = await conditional(() =>
        doc.send(
          new PutCommand({
            TableName: tableName,
            Item: item,
            ConditionExpression: 'attribute_not_exists(pk)',
          }),
        ),
      );
      return written ? 'ok' : 'exists';
    },

    async put(item) {
      await guarded(() => doc.send(new PutCommand({ TableName: tableName, Item: item })));
    },

    async updateIfVersion(key, expectedVersion, set) {
      const expression = setExpression(set);
      const updated = await conditional(() =>
        doc.send(
          new UpdateCommand({
            TableName: tableName,
            Key: key,
            UpdateExpression: expression.update,
            ConditionExpression: 'attribute_exists(#pk) AND #cv = :expected',
            ExpressionAttributeNames: { ...expression.names, '#pk': 'pk', '#cv': 'version' },
            ExpressionAttributeValues: { ...expression.values, ':expected': expectedVersion },
          }),
        ),
      );
      return updated ? 'ok' : 'conflict';
    },

    async set(key, set) {
      const expression = setExpression(set);
      await conditional(() =>
        doc.send(
          new UpdateCommand({
            TableName: tableName,
            Key: key,
            UpdateExpression: expression.update,
            ConditionExpression: 'attribute_exists(#pk)',
            ExpressionAttributeNames: { ...expression.names, '#pk': 'pk' },
            ExpressionAttributeValues: expression.values,
          }),
        ),
      );
    },

    async delete(key) {
      const out = await guarded(() =>
        doc.send(new DeleteCommand({ TableName: tableName, Key: key, ReturnValues: 'ALL_OLD' })),
      );
      return out.Attributes !== undefined;
    },

    async batchDelete(keys) {
      for (let start = 0; start < keys.length; start += BATCH_SIZE) {
        let pending: Key[] = keys.slice(start, start + BATCH_SIZE);
        for (let attempt = 0; attempt < BATCH_ATTEMPTS && pending.length > 0; attempt += 1) {
          const batch = pending;
          const out = await guarded(() =>
            doc.send(
              new BatchWriteCommand({
                RequestItems: {
                  [tableName]: batch.map((key) => ({ DeleteRequest: { Key: key } })),
                },
              }),
            ),
          );
          pending = (out.UnprocessedItems?.[tableName] ?? []).map(
            (request) => request.DeleteRequest!.Key as Key,
          );
        }
        if (pending.length > 0) {
          throw new DependencyError('dynamodb');
        }
      }
    },

    async query(input) {
      const names = indexNames(input.index);
      const items: Item[] = [];
      let startKey: Record<string, unknown> | undefined;
      do {
        const exclusiveStartKey = startKey;
        const out = await guarded(() =>
          doc.send(
            new QueryCommand({
              TableName: tableName,
              ...(input.index === undefined
                ? { ConsistentRead: true }
                : { IndexName: input.index }),
              KeyConditionExpression:
                input.skPrefix === undefined
                  ? '#pk = :pk'
                  : '#pk = :pk AND begins_with(#sk, :prefix)',
              ExpressionAttributeNames:
                input.skPrefix === undefined
                  ? { '#pk': names.pk }
                  : { '#pk': names.pk, '#sk': names.sk },
              ExpressionAttributeValues:
                input.skPrefix === undefined
                  ? { ':pk': input.pk }
                  : { ':pk': input.pk, ':prefix': input.skPrefix },
              ExclusiveStartKey: exclusiveStartKey,
            }),
          ),
        );
        items.push(...((out.Items ?? []) as Item[]));
        startKey = out.LastEvaluatedKey;
      } while (startKey !== undefined);
      return items;
    },

    async addCounter(key, units, max, attrs) {
      if (units > max) {
        return { allowed: false };
      }
      const names: Record<string, string> = { '#count': 'count' };
      const values: Record<string, unknown> = { ':units': units, ':limit': max - units };
      const sets = Object.entries(attrs).map(([attribute, value], i) => {
        names[`#a${i}`] = attribute;
        values[`:a${i}`] = value;
        return `#a${i} = :a${i}`;
      });
      const allowed = await conditional(() =>
        doc.send(
          new UpdateCommand({
            TableName: tableName,
            Key: key,
            UpdateExpression: `ADD #count :units${sets.length > 0 ? ` SET ${sets.join(', ')}` : ''}`,
            ConditionExpression: 'attribute_not_exists(#count) OR #count <= :limit',
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
          }),
        ),
      );
      return { allowed };
    },
  };
}
