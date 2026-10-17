import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { createApiFixture } from '../helpers/api-fixture.js';
import { samplePassFields } from '../helpers/pass-fields.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', 'dist', 'coverage'].includes(entry.name)) {
      return [];
    }
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const files = walk(root);
const textFiles = files.filter((file) => /\.(ts|md|json|mjs|js)$/.test(file));
const relative = (file: string) => path.relative(root, file).replaceAll('\\', '/');

// The markers are assembled from parts so that this file does not contain them itself.
const PEM_BLOCK = ['-----', 'BEGIN'].join('');
const KEY_HEADER = ['PRIVATE', ' KEY'].join('');
const P12_FILE = new RegExp(String.raw`[A-Za-z0-9_/\\-]+\.p1${'2'}\b`, 'i');
const SECRETS_CLIENT = ['@aws-sdk/client-', 'secrets-manager'].join('');

describe('Feature: pass-service, structural guards', () => {
  test('only the secret-source adapter test imports the Secrets Manager client', () => {
    const importers = files
      .filter((file) => relative(file).startsWith('test/') && file.endsWith('.ts'))
      .filter((file) => readFileSync(file, 'utf8').includes(SECRETS_CLIENT))
      .map(relative);
    expect(importers).toEqual(['test/secrets/aws-secret-source.test.ts']);
  });

  test('no file holds a certificate block, a private key header or a .p12 file name', () => {
    expect(textFiles.length).toBeGreaterThan(50);
    const offenders = textFiles.filter((file) => {
      const text = readFileSync(file, 'utf8');
      return text.includes(PEM_BLOCK) || text.includes(KEY_HEADER) || P12_FILE.test(text);
    });
    expect(offenders.map(relative)).toEqual([]);
  });

  test('the Passkit_Lambda never requests the google-wallet secret', async () => {
    const fixture = createApiFixture();
    const serial = await fixture.issue('9'.repeat(64), samplePassFields(), ['apple']);
    const token = await fixture.authToken(serial);
    const before = fixture.secrets.reads.google;
    const header = { authorization: `ApplePass ${token}` };
    const path = {
      deviceLibraryIdentifier: 'lib-1',
      passTypeIdentifier: 'pass.test.compass',
      serialNumber: serial,
    };
    const resource =
      '/api/passkit/v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}/{serialNumber}';
    await fixture.callPasskit({
      method: 'POST',
      resource,
      path,
      headers: header,
      body: { pushToken: 'aabb' },
    });
    await fixture.callPasskit({
      method: 'GET',
      resource:
        '/api/passkit/v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}',
      path,
    });
    await fixture.callPasskit({
      method: 'GET',
      resource: '/api/passkit/v1/passes/{passTypeIdentifier}/{serialNumber}',
      path,
      headers: header,
    });
    await fixture.callPasskit({ method: 'DELETE', resource, path, headers: header });
    await fixture.callPasskit({
      method: 'POST',
      resource: '/api/passkit/v1/log',
      body: { logs: ['x'] },
    });
    expect(fixture.secrets.reads.google).toBe(before);
  });
});
