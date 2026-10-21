import { cp, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { weekSpecDirectory } from '@compass/core/spec';
import { createRuntime } from '../../src/runtime/create-runtime.js';
import { DEMO_STEP_TITLES } from '../../src/demo/run-demo.js';
import { main } from '../../src/cli/main.js';
import { PassThrough } from 'node:stream';
import { connect, textOf } from '../support/connect.js';
import { repoRoot } from '../support/fake-catalog.js';
import { installNetworkGuard } from '../support/network-guard.js';
import { createPrivateCheckout, type PrivateCheckout } from '../support/private-checkout.js';
import type { NetworkGuard } from '../support/network-guard.js';
import { testEnvironment } from '../support/runtime-env.js';
import { TRIPLE } from '../support/triple.js';

let guard: NetworkGuard;
// The CLI demo below reads its resources from a private copy, not from the dist/ folder that
// the pack smoke test rebuilds (compass-power task 36).
let checkout: PrivateCheckout;
beforeAll(async () => {
  checkout = await createPrivateCheckout();
});
afterAll(async () => {
  await checkout.remove();
});
beforeEach(() => {
  guard = installNetworkGuard();
});
afterEach(() => {
  guard.restore();
});

describe('the full flow over the real simulated stack (S1 simulated transport, S2, S4, in-process pass service)', () => {
  test('sign in to forget me, with a blocked clash that sends nothing and a swap that never leaves the attendee with neither seat', async () => {
    const env = await testEnvironment();
    await cp(join(repoRoot(), 'fixtures', 'sample-repo'), env.workspace, { recursive: true });
    const runtime = await createRuntime(env.environment, { COMPASS_MODE: 'simulated' });
    const reserveCalls: string[][] = [];
    const realReserve = runtime.events.reserve.bind(runtime.events);
    runtime.events.reserve = (ids) => {
      reserveCalls.push([...ids]);
      return realReserve(ids);
    };
    const conn = await connect(runtime, { elicit: 'accept' });
    const reservedNow = async (): Promise<string[]> =>
      (await runtime.events.getSchedule()).reserved;
    const ok = async (name: string, args: Record<string, unknown> = {}) => {
      const result = await conn.call(name, args);
      expect([name, result.isError]).toEqual([name, undefined]);
      return result;
    };

    // 1 and 2: sign in and refresh the catalog.
    await ok('sign_in');
    expect(await runtime.events.isSignedIn()).toBe(true);
    await ok('refresh_catalog');

    // 3 and 4: scan the temporary copy of the sample repo and plan from it.
    const scan = await ok('scan_repo', { path: env.workspace });
    expect(textOf(scan)).toMatch(/found \d+ AWS services/);
    const plan = await ok('plan_week', { maxPerDay: 3 });
    expect(textOf(plan)).toContain(env.workspace);
    const specFolder = weekSpecDirectory(env.workspace);
    expect((await readdir(specFolder)).sort()).toEqual([
      'design.md',
      'requirements.md',
      'tasks.md',
    ]);
    expect(await readFile(join(specFolder, 'tasks.md'), 'utf8')).not.toContain(env.home);

    // 5: reserve A.
    await ok('reserve_with_guardrails', { sessionIds: [TRIPLE.a] });
    expect(await reservedNow()).toEqual([TRIPLE.a]);
    expect(reserveCalls).toEqual([[TRIPLE.a]]);

    // 6: B clashes with A, so it is blocked and ReserveSessions is never called for it.
    const blocked = await conn.call('reserve_with_guardrails', { sessionIds: [TRIPLE.b] });
    expect(textOf(blocked)).toContain('the booking guardrail blocked it');
    expect(blocked.structuredContent).toMatchObject({ verdict: { decision: 'block' } });
    expect(reserveCalls).toEqual([[TRIPLE.a]]);
    expect(await reservedNow()).toEqual([TRIPLE.a]);

    // 7 and 8: reserve the repeat, then cancel A as a completed swap (the repeat is held first).
    await ok('reserve_with_guardrails', { sessionIds: [TRIPLE.aRepeat] });
    expect((await reservedNow()).sort()).toEqual([TRIPLE.a, TRIPLE.aRepeat].sort());
    await ok('cancel_reservation', { sessionId: TRIPLE.a });
    expect(await reservedNow()).toEqual([TRIPLE.aRepeat]);

    // 9: B no longer clashes.
    await ok('reserve_with_guardrails', { sessionIds: [TRIPLE.b] });
    expect((await reservedNow()).sort()).toEqual([TRIPLE.aRepeat, TRIPLE.b].sort());
    expect(reserveCalls).toEqual([[TRIPLE.a], [TRIPLE.aRepeat], [TRIPLE.b]]);

    // 10: issue passes for A-R and B only.
    const issued = await ok('issue_boarding_passes', { sessionIds: [TRIPLE.aRepeat, TRIPLE.b] });
    expect(issued.structuredContent).toMatchObject({ issued: [TRIPLE.aRepeat, TRIPLE.b] });
    expect((await runtime.passes.issuedRecord()).map((p) => p.sessionCode).sort()).toEqual(
      [TRIPLE.codes.aRepeat, TRIPLE.codes.b].sort(),
    );

    // 11: the phone link.
    const phone = await ok('send_to_phone', { show: 'link' });
    const structuredLink = (phone.structuredContent as { handoffUrl: string }).handoffUrl;
    expect(structuredLink).not.toContain('#');
    const link = /https:\/\/compass\.invalid\/board#h=\S+/.exec(textOf(phone))?.[0] ?? '';
    expect(link).not.toBe('');
    expect(new URL(link).host).toBe('compass.invalid');
    expect(link.startsWith(structuredLink)).toBe(true);
    expect(textOf(phone)).toContain('unofficial');

    // 12 and 13: cancel B, then sync voids only B's pass.
    await ok('cancel_reservation', { sessionId: TRIPLE.b });
    expect(await reservedNow()).toEqual([TRIPLE.aRepeat]);
    const synced = await ok('sync_passes');
    const result = synced.structuredContent as {
      issued: string[];
      updated: string[];
      voided: string[];
    };
    expect(result.voided).toEqual([TRIPLE.b]);
    expect(result.issued).toEqual([]);
    // The remaining pass may be rebuilt, because its neighbour on the itinerary is gone; nothing else is touched.
    expect(result.updated.every((id) => id === TRIPLE.aRepeat)).toBe(true);

    // 14: forget me removes the local data.
    const forgotten = await ok('forget_me', { confirm: true });
    expect(forgotten.structuredContent).toEqual({ forgotten: true });
    expect(await runtime.snapshot.read()).toBeUndefined();
    expect(await runtime.passes.issuedRecord()).toEqual([]);

    await conn.close();

    // Nothing left the machine, and no token, link or hand-off id reached the log.
    expect(guard.attempts).toEqual([]);
    const logged = env.stderr.join('');
    expect(logged).not.toContain(link);
    expect(logged).not.toContain(new URL(link).hash.slice(1));
    expect(logged).not.toMatch(/eyJ[A-Za-z0-9_-]{5,}/);
    expect(env.launched).toEqual([]);
  });
});

describe('the demo acceptance (Requirements 18.2, 18.3, 25.2)', () => {
  test('runs through the CLI on a temporary copy of the sample repo and every step succeeds', async () => {
    const env = await testEnvironment();
    const copy = join(env.workspace, 'sample-copy');
    await cp(join(repoRoot(), 'fixtures', 'sample-repo'), copy, { recursive: true });
    const before = (await readdir(copy, { recursive: true })).sort();
    const out: string[] = [];
    const err: string[] = [];
    const stdin = new PassThrough();
    stdin.end();
    const stdout = new PassThrough();
    stdout.on('data', (c: Buffer) => out.push(c.toString()));
    const stderr = new PassThrough();
    stderr.on('data', (c: Buffer) => err.push(c.toString()));
    const code = await main(
      { argv: ['demo', '--repo', copy], env: {}, stdin, stdout, stderr },
      {
        homeDir: env.home,
        platform: 'linux',
        cwd: env.workspace,
        tempRoot: env.workspace,
        moduleUrl: checkout.moduleUrl,
      },
    );
    expect(code).toBe(0);
    const headings = [...out.join('').matchAll(/^Step (\d+) of 10: (.+)$/gm)];
    expect(headings.map((m) => m[2])).toEqual([...DEMO_STEP_TITLES]);
    expect(headings.map((m) => Number(m[1]))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(err.join('')).toBe(['SIMULATED MODE: no real data', ''].join('\n'));
    expect((await readdir(copy, { recursive: true })).sort()).toEqual(before);
    expect(guard.attempts).toEqual([]);
  });
});
