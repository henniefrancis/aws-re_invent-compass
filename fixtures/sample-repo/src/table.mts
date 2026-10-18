import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';

const client = new DynamoDBClient({ region: 'us-east-1' });

export async function load(id) {
  return client.send(new GetItemCommand({ TableName: 'sample-items', Key: { id: { S: id } } }));
}
