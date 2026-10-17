import { ProblemSchema } from '@compass/contracts';
import fc from 'fast-check';
import { describe, expect, test, vi } from 'vitest';
import { createPipeline, HEALTH_ROUTE } from '../../src/app/pipeline.js';
import type { BaseDeps } from '../../src/app/deps.js';
import { DependencyError, ProblemError } from '../../src/http/problem.js';
import { empty, json } from '../../src/http/responses.js';
import { createRouter, type Handler, type RouteKey } from '../../src/http/router.js';
import { checkOrigin } from '../../src/security/origin-guard.js';
import { createCapture } from '../helpers/capture.js';
import { createFakeClock } from '../helpers/fake-clock.js';
import { createFakeSecrets, randomValue } from '../helpers/fake-secrets.js';
import { createSeededRandom } from '../helpers/seeded-random.js';
import { buildEvent } from '../helpers/proxy-event.js';
import type { SecretsProvider } from '../../src/secrets/secrets-provider.js';

function setup(routes: Partial<Record<RouteKey, Handler<BaseDeps>>>, secrets?: SecretsProvider) {
  const fake = createFakeSecrets();
  const capture = createCapture();
  const clock = createFakeClock();
  const deps: BaseDeps = {
    clock,
    random: createSeededRandom('pipeline'),
    secrets: secrets ?? fake,
    logSink: capture.sink,
    console: capture.console,
  };
  const app = createPipeline({ functionName: 'api', lookup: createRouter(routes), deps });
  return { app, fake, capture, clock, deps };
}

const okHandler: Handler<BaseDeps> = () => Promise.resolve(json(200, { ok: true }));

// Property tests do real work (signing, TLS, many records) and the machine may be busy.
vi.setConfig({ testTimeout: 120_000 });

describe('Feature: pass-service, request pipeline', () => {
  test('a matching origin reaches the handler and one log line is written', async () => {
    const { app, fake, capture, clock } = setup({
      'GET /thing': async (req) => {
        clock.advance(7);
        req.metrics.add('ApnsFailure', 2);
        return Promise.resolve(json(200, { ok: true }));
      },
    });
    const result = await app(
      buildEvent({ method: 'GET', resource: '/thing', origin: fake.originSecret.originVerify }),
    );
    expect(result.statusCode).toBe(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers['x-content-type-options']).toBe('nosniff');
    expect(result.headers['referrer-policy']).toBe('no-referrer');
    expect(capture.lines).toHaveLength(1);
    const line = JSON.parse(String(capture.lines[0])) as Record<string, unknown>;
    expect(line).toMatchObject({
      route: 'GET /thing',
      status: 200,
      outcome: 'ok',
      latencyMs: 7,
      Function: 'api',
      ApnsFailure: 2,
    });
  });

  test('getHealth is the one route without the hardening headers', async () => {
    const { app, fake } = setup({ [HEALTH_ROUTE as RouteKey]: okHandler });
    const result = await app(
      buildEvent({
        method: 'GET',
        resource: '/api/v1/health',
        origin: fake.originSecret.originVerify,
      }),
    );
    expect(result.headers['cache-control']).toBeUndefined();
  });

  test('a wrong or missing origin is 403 forbidden with a Problem body', async () => {
    const { app, capture } = setup({ 'GET /thing': okHandler });
    for (const origin of [undefined, 'wrong']) {
      const result = await app(buildEvent({ method: 'GET', resource: '/thing', origin }));
      expect(result.statusCode).toBe(403);
      expect(ProblemSchema.parse(JSON.parse(result.body)).code).toBe('forbidden');
    }
    expect(capture.lines.map((l) => (JSON.parse(l) as { outcome: string }).outcome)).toEqual([
      'forbidden',
      'forbidden',
    ]);
  });

  test('an unknown route is 404 and is logged as UNMATCHED, never with its path', async () => {
    const { app, fake, capture } = setup({ 'GET /thing': okHandler });
    const result = await app(
      buildEvent({
        method: 'GET',
        resource: '/secret/path/NEEDLE',
        origin: fake.originSecret.originVerify,
      }),
    );
    expect(result.statusCode).toBe(404);
    const text = capture.lines.join('\n');
    expect(text).toContain('"route":"UNMATCHED"');
    expect(text).not.toContain('NEEDLE');
  });

  test('a ProblemError keeps its status, code and headers', async () => {
    const { app, fake } = setup({
      'POST /limited': () => {
        throw new ProblemError(429, 'rate_limited', { 'retry-after': '30' });
      },
    });
    const result = await app(
      buildEvent({ method: 'POST', resource: '/limited', origin: fake.originSecret.originVerify }),
    );
    expect(result.statusCode).toBe(429);
    expect(result.headers['retry-after']).toBe('30');
  });

  test('a dependency failure is 500 internal_error logged as dependency_error', async () => {
    const { app, fake, capture } = setup({
      'GET /dep': () => {
        throw new DependencyError('dynamodb');
      },
    });
    const result = await app(
      buildEvent({ method: 'GET', resource: '/dep', origin: fake.originSecret.originVerify }),
    );
    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body)).toMatchObject({ code: 'internal_error' });
    expect(capture.lines[0]).toContain('"outcome":"dependency_error"');
  });

  test('any other thrown value is 500, logged as internal_error, and never rethrown', async () => {
    const { app, fake, capture } = setup({
      'GET /boom': () => {
        throw new Error('NEEDLE detail');
      },
    });
    const result = await app(
      buildEvent({ method: 'GET', resource: '/boom', origin: fake.originSecret.originVerify }),
    );
    expect(result.statusCode).toBe(500);
    expect(result.body).not.toContain('NEEDLE');
    expect(capture.lines[0]).toContain('"outcome":"internal_error"');
    expect(capture.lines[0]).not.toContain('NEEDLE');
  });

  test('a secret failure while checking the origin is a 500 dependency_error', async () => {
    const failing: SecretsProvider = {
      app: () => Promise.reject(new DependencyError('secret')),
      origin: () => Promise.reject(new DependencyError('secret')),
      apple: () => Promise.reject(new DependencyError('secret')),
      google: () => Promise.reject(new DependencyError('secret')),
    };
    const { app, capture } = setup({ 'GET /thing': okHandler }, failing);
    const result = await app(buildEvent({ method: 'GET', resource: '/thing', origin: 'x' }));
    expect(result.statusCode).toBe(500);
    expect(capture.lines[0]).toContain('"outcome":"dependency_error"');
  });

  test('success statuses map to outcomes, and an odd status is internal_error', async () => {
    const { app, fake, capture } = setup({
      'GET /c201': () => Promise.resolve(json(201, {})),
      'GET /c202': () => Promise.resolve(json(202, {})),
      'GET /c204': () => Promise.resolve(empty(204)),
      'GET /c304': () => Promise.resolve(empty(304)),
      'GET /c200': () => Promise.resolve(empty(200)),
      'GET /odd': () =>
        Promise.resolve({ statusCode: 418, headers: {}, body: '', isBase64Encoded: false }),
    });
    for (const path of ['c201', 'c202', 'c204', 'c304', 'c200', 'odd']) {
      await app(
        buildEvent({
          method: 'GET',
          resource: `/${path}`,
          origin: fake.originSecret.originVerify,
        }),
      );
    }
    expect(capture.lines.map((l) => (JSON.parse(l) as { outcome: string }).outcome)).toEqual([
      'created',
      'accepted',
      'no_content',
      'not_modified',
      'ok',
      'internal_error',
    ]);
  });

  test('third-party console noise during a request is silenced', async () => {
    const { app, fake, capture } = setup({
      'GET /noisy': () => {
        capture.console.log('NEEDLE-from-library');
        return Promise.resolve(empty(200));
      },
    });
    await app(
      buildEvent({ method: 'GET', resource: '/noisy', origin: fake.originSecret.originVerify }),
    );
    expect(capture.consoleCalls).toEqual([]);
  });

  test('origin rotation accepts the previous value, and only the two configured values', async () => {
    const previous = randomValue();
    const fake = createFakeSecrets({ origin: { originVerifyPrevious: previous } });
    const { app } = setup({ 'GET /thing': okHandler }, fake);
    for (const [origin, expected] of [
      [fake.originSecret.originVerify, 200],
      [previous, 200],
      [`${previous}x`, 403],
    ] as const) {
      const result = await app(buildEvent({ method: 'GET', resource: '/thing', origin }));
      expect(result.statusCode).toBe(expected);
    }
  });

  // Feature: pass-service, Property 3: The Origin_Guard admits exactly the matching header
  test('Property 3: the guard admits exactly the matching header and nothing else runs on refusal', async () => {
    const secretsArb = fc.constantFrom(
      createFakeSecrets({ origin: { originVerify: 'origin-value-0123456789abcdef' } }),
    );
    const headerArb = fc.oneof(
      fc.constant(undefined),
      fc.constant('origin-value-0123456789abcdef'),
      fc.constant('origin-value-0123456789abcde'),
      fc.constant('origin-value-0123456789abcdefx'),
      fc.constant('ORIGIN-VALUE-0123456789ABCDEF'),
      fc.constant(' origin-value-0123456789abcdef'),
      fc.constant(''),
      fc.string({ maxLength: 40 }),
    );
    const nameArb = fc.constantFrom('x-origin-verify', 'X-Origin-Verify', 'X-ORIGIN-VERIFY');
    await fc.assert(
      fc.asyncProperty(secretsArb, headerArb, nameArb, async (secrets, value, name) => {
        let handlerCalls = 0;
        const { app } = setup(
          {
            'POST /x': () => {
              handlerCalls += 1;
              return Promise.resolve(empty(200));
            },
          },
          secrets,
        );
        const event = buildEvent({
          method: 'POST',
          resource: '/x',
          headers: value === undefined ? {} : { [name]: value },
          body: 'not read',
        });
        const result = await app(event);
        const admitted = value === 'origin-value-0123456789abcdef';
        expect(checkOrigin(event, secrets.originSecret)).toBe(admitted);
        expect(result.statusCode).toBe(admitted ? 200 : 403);
        expect(handlerCalls).toBe(admitted ? 1 : 0);
        if (!admitted) {
          expect(ProblemSchema.parse(JSON.parse(result.body)).code).toBe('forbidden');
        }
      }),
      { numRuns: 200 },
    );
  });
});
