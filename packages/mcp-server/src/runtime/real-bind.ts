// Binds S1's loopback sign-in server on the real machine (ports 8484 to 8489, 127.0.0.1 only).
// Tests inject a fake instead; this is the production default.

import { bindLoopback, defaultLoopbackDeps, LOOPBACK_PORTS } from '@compass/core/auth';
import type { LoopbackServer } from '@compass/core/auth';

/** Binds the loopback server for one sign-in attempt. */
export function realBind(expectedState: string, timeoutMs: number): Promise<LoopbackServer> {
  return bindLoopback(LOOPBACK_PORTS, defaultLoopbackDeps, { expectedState, timeoutMs });
}
