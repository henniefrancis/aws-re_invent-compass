import { describe, expect, test, vi } from 'vitest';
import type { LoopbackServer } from '../../src/auth/loopback-server.js';

// The default binder of the sign-in flow asks for ports 8484 to 8489. The loopback
// module is replaced here by a fake, so no real port is ever bound by this test.
const bindSpy = vi.hoisted(() => vi.fn());
vi.mock('../../src/auth/loopback-server.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/auth/loopback-server.js')>()),
  bindLoopback: bindSpy,
}));

import { startSignIn } from '../../src/auth/sign-in.js';
import { capturingLogger, fakeOAuth, fakeStore } from './auth-harness.js';

describe('events-client, task 11.1: the default loopback binder', () => {
  test('binds through bindLoopback over exactly 8484 to 8489 when no binder is injected', async () => {
    const server: LoopbackServer = {
      port: 8484,
      awaitCallback: () => Promise.reject(new Error('not used')),
      close: () => undefined,
    };
    bindSpy.mockResolvedValue(server);
    const opened: string[] = [];
    const pending = await startSignIn({
      store: fakeStore(),
      logger: capturingLogger().logger,
      fetch: fakeOAuth([{ status: 200 }]).fetch,
      now: () => 0,
      openBrowser: (url) => {
        opened.push(url);
      },
    });
    expect(bindSpy).toHaveBeenCalledWith([8484, 8485, 8486, 8487, 8488, 8489]);
    expect(pending.port).toBe(8484);
    expect(opened).toHaveLength(1);
  });
});
