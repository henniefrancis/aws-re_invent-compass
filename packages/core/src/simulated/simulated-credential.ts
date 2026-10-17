// The credential for simulated mode (events-client, S1, QA M4).
//
// A simulated session presents a signed-in attendee without any sign-in: there is no
// OAuth call, no keychain and no real token. The access token this returns is a fixed
// label that the simulated transport never reads and that no real service would
// accept; the refresh is local and does nothing. It deliberately has no ID token
// provider: nothing in simulated mode may reach a Compass API with a credential.

import type { EventsApiCredential } from '../api/transport.js';

/** The fixed label handed out as the simulated access token. It is not a secret. */
export const SIMULATED_ACCESS_TOKEN = 'simulated-access-token';

/** Create the simulated credential. Makes no call of any kind. */
export function createSimulatedCredential(): EventsApiCredential {
  return {
    getAccessTokenForEventsApi: () => Promise.resolve(SIMULATED_ACCESS_TOKEN),
    forceRefresh: () => Promise.resolve(),
  };
}
