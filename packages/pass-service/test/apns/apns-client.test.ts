import type { ClientHttp2Session } from 'node:http2';
import fc from 'fast-check';
import { afterAll, describe, expect, test } from 'vitest';
import { createApnsClient, type PushTarget } from '../../src/apns/apns-client.js';
import { createHttp2Connector, type Http2Connector } from '../../src/apns/http2-connector.js';
import type { ApiConfig } from '../../src/config/config.js';
import { appleSecretFromPki } from '../helpers/apple-secret.js';
import { startApnsStandIn, type ScriptedReply } from '../helpers/apns-stand-in.js';
import { createFakeSecrets } from '../helpers/fake-secrets.js';
import { throwawayPki } from '../helpers/throwaway-pki.js';

type ApnsConfig = ApiConfig['apns'];

const TIMEOUT = 120_000;
const baseConfig: ApnsConfig = {
  enabled: true,
  host: 'localhost',
  timeoutMs: 2000,
  budgetMs: 4000,
};

function targets(tokens: string[]): PushTarget[] {
  return tokens.map((pushToken, i) => ({
    deviceHash: `device-${i}`,
    serialNumber: `serial-${i}`,
    pushToken,
  }));
}

function connectorFor(port: number): Http2Connector {
  return createHttp2Connector({ port, ca: throwawayPki().wwdrPem });
}

const secrets = () => createFakeSecrets({ apple: appleSecretFromPki() });

const open: { close: () => Promise<void> }[] = [];
afterAll(async () => {
  await Promise.all(open.map((s) => s.close()));
});

async function standIn(script: (token: string) => ScriptedReply) {
  const server = await startApnsStandIn(script);
  open.push(server);
  return server;
}

describe('Feature: pass-service, APNs client', () => {
  test('a push is POST /3/device/<token> with the topic, the empty body and the client certificate', async () => {
    const server = await standIn(() => ({ status: 200 }));
    const client = createApnsClient(baseConfig, {
      connector: connectorFor(server.port),
      secrets: secrets(),
    });
    const outcome = await client.push(targets(['aabbcc']));
    expect(outcome).toEqual({ delivered: 1, invalid: [], failed: 0, skipped: false });
    expect(server.pushes).toEqual([
      {
        method: 'POST',
        path: '/3/device/aabbcc',
        topic: 'pass.test.compass',
        pushType: undefined,
        contentType: 'application/json',
        body: '{}',
        clientCommonName: 'Throwaway Pass Type ID',
      },
    ]);
  });

  test('the push type header is sent when configured', async () => {
    const server = await standIn(() => ({ status: 200 }));
    const client = createApnsClient(
      { ...baseConfig, pushType: 'background' },
      { connector: connectorFor(server.port), secrets: secrets() },
    );
    await client.push(targets(['aa']));
    expect(server.pushes[0]?.pushType).toBe('background');
  });

  test('an unencrypted key with an empty passphrase also connects', async () => {
    const server = await standIn(() => ({ status: 200 }));
    const pki = throwawayPki();
    const client = createApnsClient(baseConfig, {
      connector: connectorFor(server.port),
      secrets: createFakeSecrets({
        apple: {
          ...appleSecretFromPki(),
          signerKeyPem: pki.signerKeyPlainPem,
          signerKeyPassphrase: '',
        },
      }),
    });
    expect((await client.push(targets(['aa']))).delivered).toBe(1);
  });

  test('disabled APNs skips without connecting, and no targets need no connection', async () => {
    const server = await standIn(() => ({ status: 200 }));
    const disabled = createApnsClient(
      { ...baseConfig, enabled: false },
      { connector: connectorFor(server.port), secrets: secrets() },
    );
    expect(await disabled.push(targets(['aa']))).toEqual({
      delivered: 0,
      invalid: [],
      failed: 0,
      skipped: true,
    });
    const enabled = createApnsClient(baseConfig, {
      connector: connectorFor(server.port),
      secrets: secrets(),
    });
    expect(await enabled.push([])).toEqual({
      delivered: 0,
      invalid: [],
      failed: 0,
      skipped: false,
    });
    expect(server.sessions()).toBe(0);
  });

  test('replies map as documented: 410 and BadDeviceToken are invalid, the rest fail', async () => {
    const replies: Record<string, ScriptedReply> = {
      a1: { status: 200 },
      a2: { status: 410, reason: 'Unregistered' },
      a3: { status: 410, reason: 'ExpiredToken' },
      a4: { status: 400, reason: 'BadDeviceToken' },
      a5: { status: 400, reason: 'PayloadEmpty' },
      a6: { status: 400, rawBody: 'not json' },
      a7: { status: 403, reason: 'BadCertificate' },
      a8: { status: 429, reason: 'TooManyRequests' },
      a9: { status: 500, reason: 'InternalServerError' },
      b1: { status: 200, reset: true },
    };
    const server = await standIn((token) => replies[token] ?? { status: 200 });
    const client = createApnsClient(baseConfig, {
      connector: connectorFor(server.port),
      secrets: secrets(),
    });
    const list = targets(Object.keys(replies));
    const outcome = await client.push(list);
    expect(outcome.delivered).toBe(1);
    expect(outcome.invalid.map((t) => t.pushToken)).toEqual(['a2', 'a3', 'a4']);
    expect(outcome.failed).toBe(6);
    expect(server.pushes).toHaveLength(10);
  });

  test('a session that cannot connect fails every push without throwing', async () => {
    const server = await standIn(() => ({ status: 200 }));
    const port = server.port;
    await server.close();
    const client = createApnsClient(baseConfig, {
      connector: connectorFor(port),
      secrets: secrets(),
    });
    const outcome = await client.push(targets(['aa', 'bb']));
    expect(outcome).toEqual({ delivered: 0, invalid: [], failed: 2, skipped: false });
  });

  test('a request that throws is a failure', async () => {
    const session = {
      on: () => undefined,
      request: () => {
        throw new Error('session closed');
      },
      destroy: () => undefined,
    } as unknown as ClientHttp2Session;
    const client = createApnsClient(baseConfig, {
      connector: { connect: () => session },
      secrets: secrets(),
    });
    expect((await client.push(targets(['aa']))).failed).toBe(1);
  });

  // Feature: pass-service, Property 19: APNs requests and replies are handled exactly
  test(
    'Property 19: requests are exact and replies are classified exactly, with no retry',
    async () => {
      const replyArb: fc.Arbitrary<ScriptedReply> = fc.constantFrom(
        { status: 200 },
        { status: 410, reason: 'Unregistered' },
        { status: 410, reason: 'ExpiredToken' },
        { status: 400, reason: 'BadDeviceToken' },
        { status: 400, reason: 'Other' },
        { status: 403 },
        { status: 429 },
        { status: 500 },
        { status: 200, reset: true },
      );
      await fc.assert(
        fc.asyncProperty(
          fc.array(replyArb, { minLength: 1, maxLength: 8 }),
          fc.option(fc.constantFrom<'alert' | 'background'>('alert', 'background'), {
            nil: undefined,
          }),
          async (replies, pushType) => {
            const tokens = replies.map((_, i) => `0${i}ab`);
            const byToken = new Map(tokens.map((t, i) => [t, replies[i] as ScriptedReply]));
            const server = await standIn((token) => byToken.get(token) ?? { status: 500 });
            const client = createApnsClient(
              { ...baseConfig, ...(pushType === undefined ? {} : { pushType }) },
              { connector: connectorFor(server.port), secrets: secrets() },
            );
            const outcome = await client.push(targets(tokens));
            await server.close();
            const isInvalid = (r: ScriptedReply) =>
              r.reset !== true &&
              (r.status === 410 || (r.status === 400 && r.reason === 'BadDeviceToken'));
            const isDelivered = (r: ScriptedReply) => r.reset !== true && r.status === 200;
            expect(server.pushes.map((p) => p.path).sort()).toEqual(
              tokens.map((t) => `/3/device/${t}`).sort(),
            );
            for (const push of server.pushes) {
              expect(push.method).toBe('POST');
              expect(push.topic).toBe('pass.test.compass');
              expect(push.pushType).toBe(pushType);
              expect(push.body).toBe('{}');
            }
            expect(outcome.invalid.map((t) => t.pushToken)).toEqual(
              tokens.filter((_, i) => isInvalid(replies[i] as ScriptedReply)),
            );
            expect(outcome.delivered).toBe(replies.filter(isDelivered).length);
            expect(outcome.failed).toBe(
              replies.filter((r) => !isDelivered(r) && !isInvalid(r)).length,
            );
            expect(outcome.skipped).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    },
    TIMEOUT,
  );

  // Feature: pass-service, Property 20: Pushes stay inside the time budget
  test(
    'Property 20: one session, per-push timeouts, and the call ends within the budget',
    async () => {
      const config: ApnsConfig = { ...baseConfig, timeoutMs: 300, budgetMs: 700 };
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.constantFrom(0, 10, 1200), { minLength: 1, maxLength: 6 }),
          async (delays) => {
            const tokens = delays.map((_, i) => `0${i}cd`);
            const delayOf = new Map(tokens.map((t, i) => [t, delays[i] as number]));
            const server = await standIn((token) => ({
              status: 200,
              delayMs: delayOf.get(token) ?? 0,
            }));
            const client = createApnsClient(config, {
              connector: connectorFor(server.port),
              secrets: secrets(),
            });
            const started = Date.now();
            const outcome = await client.push(targets(tokens));
            const elapsed = Date.now() - started;
            await server.close();
            expect(elapsed).toBeLessThan(config.budgetMs + 400);
            expect(server.sessions()).toBe(1);
            expect(outcome.delivered).toBe(delays.filter((d) => d < config.timeoutMs).length);
            expect(outcome.failed).toBe(delays.filter((d) => d >= config.timeoutMs).length);
          },
        ),
        { numRuns: 100 },
      );
      const disabled = await standIn(() => ({ status: 200 }));
      const outcome = await createApnsClient(
        { ...config, enabled: false },
        { connector: connectorFor(disabled.port), secrets: secrets() },
      ).push(targets(['aa']));
      expect(outcome.skipped).toBe(true);
      expect(disabled.sessions()).toBe(0);
    },
    TIMEOUT,
  );

  test('the budget cuts the call short when it is smaller than the push timeout', async () => {
    const server = await standIn(() => ({ status: 200, delayMs: 400 }));
    const client = createApnsClient(
      { ...baseConfig, timeoutMs: 2000, budgetMs: 100 },
      { connector: connectorFor(server.port), secrets: secrets() },
    );
    const started = Date.now();
    const outcome = await client.push(targets(['aa']));
    expect(Date.now() - started).toBeLessThan(350);
    expect(outcome.failed).toBe(1);
  });
});
