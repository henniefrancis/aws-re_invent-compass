import { describe, expect, test } from 'vitest';
import { createApiApp, createPasskitApp } from '../../src/index.js';
import type { ApiConfig, PasskitConfig } from '../../src/config/config.js';
import { createCapture } from '../helpers/capture.js';
import { createFakeClock } from '../helpers/fake-clock.js';
import { createFakeSecrets } from '../helpers/fake-secrets.js';
import { buildEvent } from '../helpers/proxy-event.js';
import { createSeededRandom } from '../helpers/seeded-random.js';

describe('Feature: pass-service, app factories', () => {
  test('both apps answer an unknown route with 404 and log as their own function', async () => {
    const secrets = createFakeSecrets();
    for (const [create, name] of [
      [createApiApp, 'api'],
      [createPasskitApp, 'passkit'],
    ] as const) {
      const capture = createCapture();
      const deps = {
        clock: createFakeClock(),
        random: createSeededRandom('apps'),
        secrets,
        logSink: capture.sink,
        console: capture.console,
        config: {} as ApiConfig & PasskitConfig,
      };
      const app = create(deps);
      const result = await app(
        buildEvent({ method: 'GET', resource: '/nope', origin: secrets.appSecret.originVerify }),
      );
      expect(result.statusCode).toBe(404);
      expect(JSON.parse(String(capture.lines[0]))).toMatchObject({ Function: name });
    }
  });
});
