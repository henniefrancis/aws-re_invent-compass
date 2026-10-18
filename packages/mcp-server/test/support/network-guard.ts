import net from 'node:net';

/** What the guard observed. Any entry means a test tried to reach the network. */
export interface NetworkGuard {
  readonly attempts: string[];
  restore(): void;
}

/**
 * Fails any `fetch` or socket connection made while installed (task 1.3). Tests call
 * `installNetworkGuard()` before the code under test and `restore()` afterwards, then
 * assert `attempts` is empty.
 */
export function installNetworkGuard(): NetworkGuard {
  const attempts: string[] = [];
  const originalFetch = globalThis.fetch;
  const socketProto: { connect: unknown } = net.Socket.prototype;
  const originalConnect = socketProto.connect;

  globalThis.fetch = () => {
    attempts.push('fetch');
    return Promise.reject(new Error('network guard: fetch is not allowed in tests'));
  };

  socketProto.connect = () => {
    attempts.push('socket');
    throw new Error('network guard: sockets are not allowed in tests');
  };

  return {
    attempts,
    restore: () => {
      globalThis.fetch = originalFetch;
      socketProto.connect = originalConnect;
    },
  };
}
