// Wires the real S4 into a PassesPort (part of task 26.1). The Compass API host the ID token goes
// to is passed in as `allowedHosts`, taken by the caller from the build-time constant and never
// from the same source as the base URL; in simulated mode `simulated` is set. The ID token comes
// from an injected provider and goes only to the client, never to the Events transport.

import { createCompassClient, createPassStore } from '@compass/core/passes';
import type {
  AppDataResolver,
  Clock as PassClock,
  ConnectionProvider,
  EventWindow,
  FileSystem,
  HttpTransport,
  IdTokenProvider,
} from '@compass/core/passes';
import { createPassesAdapter } from '../adapters/passes-adapter.js';
import type { PassesPort } from '../ports/passes-port.js';

/** What the factory needs besides the transport and the base URL. */
export interface PassesFactoryDeps {
  idToken: IdTokenProvider;
  fs: FileSystem;
  appData: AppDataResolver;
  /** S4's clock: `now` and `sleep`. */
  clock: PassClock;
  connections: ConnectionProvider;
  eventWindow(): Promise<EventWindow>;
  /** The exact hosts allowed to receive the ID token (a build-time constant). */
  allowedHosts: readonly string[];
  simulated: boolean;
  attendeeName?: string;
}

/** Returns the `createPasses(transport, baseUrl)` factory the runtimes use. */
export function createPassesFactory(
  deps: PassesFactoryDeps,
): (transport: HttpTransport, baseUrl: string) => PassesPort {
  return (transport, baseUrl) =>
    createPassesAdapter({
      client: createCompassClient({
        baseUrl,
        allowedHosts: deps.allowedHosts,
        simulated: deps.simulated,
        transport,
        idToken: deps.idToken,
        clock: deps.clock,
      }),
      store: createPassStore({ appData: deps.appData, fs: deps.fs, clock: deps.clock }),
      fs: deps.fs,
      appData: deps.appData,
      clock: deps.clock,
      connections: deps.connections,
      eventWindow: () => deps.eventWindow(),
      ...(deps.attendeeName === undefined ? {} : { attendeeName: deps.attendeeName }),
    });
}
