// Pieces both Lambdas build the same way. Nothing here imports the Google or JWKS libraries,
// so the passkit bundle stays free of them (review N10).
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createDynamoTableClient } from '../data/dynamo-table-client.js';
import type { TableClient } from '../data/table-client.js';
import {
  awsSecretSource,
  createSecretsProvider,
  type SecretIds,
} from '../credentials/secrets-provider.js';
import { systemClock } from '../seams.js';
import type { SecretsProvider } from '../credentials/secrets-provider.js';

export function stdoutSink(line: string): void {
  process.stdout.write(`${line}\n`);
}

export function productionTable(tableName: string): TableClient {
  return createDynamoTableClient(
    DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    }),
    tableName,
  );
}

export function productionSecrets(ids: SecretIds, cacheSeconds: number): SecretsProvider {
  return createSecretsProvider(
    awsSecretSource(new SecretsManagerClient({})),
    ids,
    cacheSeconds,
    systemClock,
  );
}
