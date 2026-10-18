import { describe, expect, test } from 'vitest';
import { parsePasskitConfig } from '../../src/config/config.js';
import { createApiApp, createPasskitApp } from '../../src/index.js';
import { BASE_ENV, createApiFixture } from '../helpers/api-fixture.js';
import { buildEvent } from '../helpers/proxy-event.js';

describe('Feature: pass-service, app factories', () => {
  test('both apps answer an unknown route with 404 and log as their own function', async () => {
    const fixture = createApiFixture();
    const origin = fixture.secrets.originSecret.originVerify;
    const api = createApiApp(fixture.deps);
    const passkit = createPasskitApp({
      clock: fixture.deps.clock,
      random: fixture.deps.random,
      secrets: fixture.deps.secrets,
      logSink: fixture.deps.logSink,
      console: fixture.deps.console,
      config: parsePasskitConfig(BASE_ENV),
      passes: fixture.deps.passes,
      registrations: fixture.deps.registrations,
      signer: fixture.deps.signer,
    });
    for (const [app, name] of [
      [api, 'api'],
      [passkit, 'passkit'],
    ] as const) {
      const result = await app(buildEvent({ method: 'GET', resource: '/nope', origin }));
      expect(result.statusCode).toBe(404);
      const lines = fixture.capture.lines;
      expect(JSON.parse(String(lines[lines.length - 1]))).toMatchObject({ Function: name });
    }
  });
});
