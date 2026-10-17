import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test, vi } from 'vitest';
import type { ApnsClient } from '../../src/apns/apns-client.js';
import {
  startLocalHarness,
  type HarnessHandle,
  type HarnessSecrets,
} from '../../src/harness/local-server.js';
import { BASE_ENV, createApiFixture } from '../helpers/api-fixture.js';
import { throwawayPki } from '../helpers/throwaway-pki.js';
import { zipMap } from '../helpers/zip-reader.js';

vi.setConfig({ testTimeout: 120_000 });

const folder = mkdtempSync(path.join(tmpdir(), 'compass-harness-test-'));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

function writeFiles(encrypted: boolean): HarnessSecrets {
  const pki = throwawayPki();
  const file = (name: string, text: string) => {
    const full = path.join(folder, name);
    writeFileSync(full, text);
    return full;
  };
  return {
    passTypeIdentifier: 'pass.test.compass',
    teamIdentifier: 'TESTTEAM01',
    signerCertFile: file('signer-cert.pem', pki.signerCertPem),
    signerKeyFile: file('signer-key.pem', encrypted ? pki.signerKeyPem : pki.signerKeyPlainPem),
    wwdrFile: file('wwdr.pem', pki.wwdrPem),
    ...(encrypted ? { signerKeyPassphrase: pki.signerKeyPassphrase } : {}),
    googleKeyFile: file(
      'google-key.json',
      JSON.stringify({
        client_email: pki.google.clientEmail,
        private_key: pki.google.privateKeyPem,
      }),
    ),
    googleIssuerId: '3388000000099999999',
  };
}

const handles: HarnessHandle[] = [];
afterAll(async () => {
  await Promise.all(handles.map((h) => h.close()));
});

async function start(encrypted = true, log: string[] = []) {
  const port = await freePort();
  const fake = createApiFixture();
  const apns: ApnsClient = {
    push: (targets) =>
      Promise.resolve({ delivered: targets.length, invalid: [], failed: 0, skipped: false }),
  };
  const handle = await startLocalHarness({
    host: '127.0.0.1',
    port,
    env: { ...BASE_ENV, PUBLIC_BASE_URL: `http://127.0.0.1:${port}` },
    secrets: writeFiles(encrypted),
    log: (line) => log.push(line),
    enable: { apns: true, google: true },
    overrides: { apns, google: fake.google },
  });
  handles.push(handle);
  return { base: `http://127.0.0.1:${handle.port}`, log, google: fake.google };
}

const NEEDLE_SIGN_IN = 'harness-needle-sign-in';
const NEEDLE_DEVICE = 'device-needle-library';
const NEEDLE_PUSH = 'ab12cd34ef56ab12cd34';

const session = (room: string) => ({
  sessionCode: 'TEST101',
  title: 'Made up session',
  venue: 'Made Up Hall',
  room,
  startsAt: '2026-12-02T10:00:00-08:00',
  endsAt: '2026-12-02T11:00:00-08:00',
});

describe('Feature: pass-service, local harness', () => {
  test('serves the page and a full issue, register, latest pass, update and void round trip', async () => {
    const log: string[] = [];
    const { base, google } = await start(true, log);
    expect(log).toEqual(['listening']);

    const page = await fetch(`${base}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toContain('Compass local harness');

    const auth = { authorization: `Bearer ${NEEDLE_SIGN_IN}`, 'content-type': 'application/json' };
    const issued = await fetch(`${base}/api/v1/passes`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ platforms: ['apple', 'google'], passes: [session('Room 1')] }),
    });
    expect(issued.status).toBe(201);
    const serial = ((await issued.json()) as { passes: { serialNumber: string }[] }).passes[0]!
      .serialNumber;

    const download = await fetch(`${base}/api/v1/passes/${serial}/apple`, { headers: auth });
    expect(download.status).toBe(200);
    const files = zipMap(Buffer.from(await download.arrayBuffer()));
    const pass = JSON.parse(String(files.get('pass.json'))) as {
      authenticationToken: string;
      webServiceURL: string;
    };
    expect(pass.webServiceURL).toBe(`${base}/api/passkit`);
    const apple = {
      authorization: `ApplePass ${pass.authenticationToken}`,
      'content-type': 'application/json',
    };

    const registered = await fetch(
      `${base}/api/passkit/v1/devices/${NEEDLE_DEVICE}/registrations/pass.test.compass/${serial}`,
      { method: 'POST', headers: apple, body: JSON.stringify({ pushToken: NEEDLE_PUSH }) },
    );
    expect(registered.status).toBe(201);
    const listed = await fetch(
      `${base}/api/passkit/v1/devices/${NEEDLE_DEVICE}/registrations/pass.test.compass?passesUpdatedSince=0`,
    );
    expect(listed.status).toBe(200);
    const latest = await fetch(`${base}/api/passkit/v1/passes/pass.test.compass/${serial}`, {
      headers: apple,
    });
    expect(latest.status).toBe(200);
    const modified = latest.headers.get('last-modified') ?? '';
    const notModified = await fetch(`${base}/api/passkit/v1/passes/pass.test.compass/${serial}`, {
      headers: { ...apple, 'if-modified-since': modified },
    });
    expect(notModified.status).toBe(304);

    const updated = await fetch(`${base}/api/v1/passes/${serial}`, {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify(session('Room 2')),
    });
    expect(updated.status).toBe(200);
    const voided = await fetch(`${base}/api/v1/passes/${serial}/void`, {
      method: 'POST',
      headers: auth,
    });
    expect(voided.status).toBe(200);
    const after = await fetch(`${base}/api/passkit/v1/passes/pass.test.compass/${serial}`, {
      headers: apple,
    });
    const voidedPass = JSON.parse(
      String(zipMap(Buffer.from(await after.arrayBuffer())).get('pass.json')),
    ) as { voided?: boolean };
    expect(voidedPass.voided).toBe(true);
    expect(google.patches.length).toBeGreaterThan(0);

    const noOrigin = await fetch(`${base}/api/v1/health`);
    expect(noOrigin.status).toBe(200);
    expect(((await noOrigin.json()) as { status: string }).status).toBe('ok');
    expect((await fetch(`${base}/nothing/here`)).status).toBe(404);
    expect((await fetch(`${base}/api/v1/passes`, { method: 'POST', body: '{}' })).status).toBe(401);
    expect((await fetch(`${base}/api/v1/handoffs/%E0%A4%A`)).status).toBe(500);

    const output = log.join('\n');
    for (const needle of [
      NEEDLE_SIGN_IN,
      NEEDLE_DEVICE,
      NEEDLE_PUSH,
      serial,
      pass.authenticationToken,
    ]) {
      expect(output).not.toContain(needle);
    }
    expect(log.length).toBeGreaterThan(10);
    expect(
      log.slice(1).every((line) => (JSON.parse(line) as { route: string }).route !== undefined),
    ).toBe(true);
  });

  test('hand-offs, the repeat-insert action and an unencrypted key work too', async () => {
    const { base, google } = await start(false);
    const auth = { authorization: `Bearer ${NEEDLE_SIGN_IN}`, 'content-type': 'application/json' };
    const issued = await fetch(`${base}/api/v1/passes`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ platforms: ['apple', 'google'], passes: [session('Room 1')] }),
    });
    const serial = ((await issued.json()) as { passes: { serialNumber: string }[] }).passes[0]!
      .serialNumber;
    const handoff = await fetch(`${base}/api/v1/handoffs`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        serialNumbers: [serial],
        include: { apple: true, google: true, calendar: true },
      }),
    });
    const { handoffId } = (await handoff.json()) as { handoffId: string };
    const view = (await (await fetch(`${base}/api/v1/handoffs/${handoffId}`)).json()) as {
      apple: { bundlePaths: string[] };
      calendarPath: string;
    };
    const bundle = await fetch(`${base}${view.apple.bundlePaths[0]}`);
    expect(bundle.status).toBe(200);
    expect(bundle.headers.get('content-type')).toBe('application/vnd.apple.pkpasses');
    expect((await fetch(`${base}${view.calendarPath}`)).headers.get('content-type')).toBe(
      'text/calendar',
    );

    const repeat = await fetch(`${base}/harness/repeat-insert/${serial}`, { method: 'POST' });
    expect(repeat.status).toBe(200);
    expect(await repeat.json()).toEqual({ first: 'ok', second: 'ok' });
    expect(google.inserts.length).toBeGreaterThanOrEqual(3);
    const missing = await fetch(
      `${base}/harness/repeat-insert/00000000-0000-4000-8000-000000000000`,
      { method: 'POST' },
    );
    expect(missing.status).toBe(404);
  });

  test('without a log function the harness prints to stdout', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const port = await freePort();
      const handle = await startLocalHarness({
        host: '127.0.0.1',
        port,
        env: { ...BASE_ENV, PUBLIC_BASE_URL: `http://127.0.0.1:${port}` },
        secrets: writeFiles(true),
      });
      handles.push(handle);
      expect(write).toHaveBeenCalledWith('listening\n');
    } finally {
      write.mockRestore();
    }
  });

  test('the repeat-insert action is a 404 when Google is disabled', async () => {
    const port = await freePort();
    const handle = await startLocalHarness({
      host: '127.0.0.1',
      port,
      env: {
        ...BASE_ENV,
        PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
        GOOGLE_WALLET_ENABLED: 'false',
        GOOGLE_SECRET_ID: '',
        APNS_ENABLED: 'false',
      },
      secrets: writeFiles(true),
      log: () => undefined,
    });
    handles.push(handle);
    const reply = await fetch(
      `http://127.0.0.1:${handle.port}/harness/repeat-insert/00000000-0000-4000-8000-000000000000`,
      { method: 'POST' },
    );
    expect(reply.status).toBe(404);
  });
});
