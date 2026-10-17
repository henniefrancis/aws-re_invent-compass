import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test, vi } from 'vitest';
import {
  isLoopbackHost,
  startLocalHarness,
  type HarnessHandle,
} from '../../src/harness/local-server.js';
import { BASE_ENV } from '../helpers/api-fixture.js';
import { throwawayPki } from '../helpers/throwaway-pki.js';
import { zipMap } from '../helpers/zip-reader.js';

vi.setConfig({ testTimeout: 120_000 });

// Code review N2: the harness listens on loopback by default; any other address needs an
// access token on every route, and APNs and Google are off unless asked for.

const folder = mkdtempSync(path.join(tmpdir(), 'compass-harness-access-'));
afterAll(() => rmSync(folder, { recursive: true, force: true }));
const handles: HarnessHandle[] = [];
afterAll(async () => {
  await Promise.all(handles.map((handle) => handle.close()));
});

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

function secretsFiles() {
  const pki = throwawayPki();
  const file = (name: string, text: string) => {
    const full = path.join(folder, name);
    writeFileSync(full, text);
    return full;
  };
  return {
    passTypeIdentifier: 'pass.test.compass',
    teamIdentifier: 'TESTTEAM01',
    signerCertFile: file('cert.pem', pki.signerCertPem),
    signerKeyFile: file('key.pem', pki.signerKeyPlainPem),
    wwdrFile: file('wwdr.pem', pki.wwdrPem),
  };
}

async function start(host: string, enable?: { apns?: boolean; google?: boolean }) {
  const port = await freePort();
  const log: string[] = [];
  const handle = await startLocalHarness({
    host,
    port,
    env: { ...BASE_ENV, PUBLIC_BASE_URL: `http://127.0.0.1:${port}` },
    secrets: secretsFiles(),
    log: (line) => log.push(line),
    ...(enable === undefined ? {} : { enable }),
  });
  handles.push(handle);
  return { base: `http://127.0.0.1:${handle.port}`, log, handle };
}

const session = {
  sessionCode: 'TEST101',
  title: 'Made up session',
  venue: 'Made Up Hall',
  room: 'Room 1',
  startsAt: '2026-12-02T10:00:00-08:00',
  endsAt: '2026-12-02T11:00:00-08:00',
};

describe('Feature: pass-service, harness access control', () => {
  test('loopback hosts need no token', () => {
    for (const host of ['127.0.0.1', '127.0.0.5', '::1', 'localhost']) {
      expect(isLoopbackHost(host)).toBe(true);
    }
    for (const host of ['0.0.0.0', '192.168.1.20', '::', 'harness.example']) {
      expect(isLoopbackHost(host)).toBe(false);
    }
  });

  test('on loopback there is no token and nothing extra is printed', async () => {
    const { base, log, handle } = await start('127.0.0.1');
    expect(handle.accessToken).toBeUndefined();
    expect(log).toEqual(['listening']);
    expect((await fetch(`${base}/`)).status).toBe(200);
  });

  test('beyond loopback: a warning, a token shown once, and the token on every route', async () => {
    const { base, log, handle } = await start('0.0.0.0', { apns: false, google: false });
    const token = handle.accessToken ?? '';
    expect(token).toHaveLength(32);
    expect(log[0]).toBe('listening');
    expect(log.some((line) => line.startsWith('WARNING'))).toBe(true);
    expect(log.filter((line) => line.includes(token))).toHaveLength(1);

    const routes: [string, string, string?][] = [
      ['GET', '/'],
      ['GET', '/api/v1/health'],
      ['POST', '/api/v1/passes', '{}'],
      ['POST', '/harness/repeat-insert/00000000-0000-4000-8000-000000000000'],
      ['GET', '/api/passkit/v1/devices/library-0000000001/registrations/pass.test.compass'],
      ['POST', '/api/passkit/v1/log', '{}'],
      ['GET', '/nothing'],
    ];
    for (const [method, route, body] of routes) {
      const refused = await fetch(`${base}${route}`, {
        method,
        ...(body === undefined ? {} : { body }),
      });
      expect(refused.status, `${method} ${route}`).toBe(401);
      expect(await refused.text()).toBe('');
      const wrong = await fetch(`${base}${route}`, {
        method,
        headers: { 'x-harness-token': 'wrong' },
        ...(body === undefined ? {} : { body }),
      });
      expect(wrong.status).toBe(401);
    }

    const withHeader = await fetch(`${base}/api/v1/health`, {
      headers: { 'x-harness-token': token },
    });
    expect(withHeader.status).toBe(200);
    const page = await fetch(`${base}/?harness_token=${token}`);
    expect(page.status).toBe(200);
    const cookie = (page.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    expect(cookie).toBe(`harness_token=${token}`);
    expect(page.headers.get('set-cookie')).toContain('HttpOnly');
    const viaCookie = await fetch(`${base}/api/v1/health`, {
      headers: { cookie: `a=b; ${cookie}` },
    });
    expect(viaCookie.status).toBe(200);
    const badCookie = await fetch(`${base}/api/v1/health`, {
      headers: { cookie: 'harness_token=nope; other' },
    });
    expect(badCookie.status).toBe(401);
  });

  test('the PassKit device carries the token in the web service path', async () => {
    const { base, handle } = await start('0.0.0.0');
    const token = handle.accessToken ?? '';
    const auth = {
      'x-harness-token': token,
      authorization: 'Bearer someone',
      'content-type': 'application/json',
    };
    const issued = await fetch(`${base}/api/v1/passes`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ platforms: ['apple'], passes: [session] }),
    });
    expect(issued.status).toBe(201);
    const serial = ((await issued.json()) as { passes: { serialNumber: string }[] }).passes[0]!
      .serialNumber;
    const download = await fetch(`${base}/api/v1/passes/${serial}/apple`, { headers: auth });
    const pass = JSON.parse(
      String(zipMap(Buffer.from(await download.arrayBuffer())).get('pass.json')),
    ) as { authenticationToken: string; webServiceURL: string };
    expect(pass.webServiceURL).toBe(`${base}/api/passkit/${token}`);
    const device = 'library-0000000001';
    const apple = {
      authorization: `ApplePass ${pass.authenticationToken}`,
      'content-type': 'application/json',
    };
    const viaPath = await fetch(
      `${pass.webServiceURL}/v1/devices/${device}/registrations/pass.test.compass/${serial}`,
      { method: 'POST', headers: apple, body: JSON.stringify({ pushToken: 'aabbccdd' }) },
    );
    expect(viaPath.status).toBe(201);
    expect(viaPath.headers.get('set-cookie')).toBeNull();
    const withoutToken = await fetch(
      `${base}/api/passkit/v1/devices/${device}/registrations/pass.test.compass/${serial}`,
      { method: 'POST', headers: apple, body: JSON.stringify({ pushToken: 'aabbccdd' }) },
    );
    expect(withoutToken.status).toBe(401);
  });

  test('APNs and Google are off by default, so a first run cannot push or call Google', async () => {
    const { base } = await start('127.0.0.1');
    const auth = { authorization: 'Bearer someone', 'content-type': 'application/json' };
    const issued = await fetch(`${base}/api/v1/passes`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ platforms: ['apple', 'google'], passes: [session] }),
    });
    const body = (await issued.json()) as {
      passes: { serialNumber: string; platforms: string[] }[];
    };
    expect(body.passes[0]?.platforms).toEqual(['apple']);
    const repeat = await fetch(`${base}/harness/repeat-insert/${body.passes[0]?.serialNumber}`, {
      method: 'POST',
    });
    expect(repeat.status).toBe(404);
  });
});
