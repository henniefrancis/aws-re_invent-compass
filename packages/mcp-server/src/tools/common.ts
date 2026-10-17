// Helpers shared by the tool handlers.

import { CompassError } from '../ports/errors.js';
import type { ToolContext } from '../server/types.js';

/** Throws NotSignedIn unless the attendee is signed in. Simulated mode is signed in at once. */
export async function ensureSignedIn(ctx: ToolContext): Promise<void> {
  if (!(await ctx.runtime.events.isSignedIn())) {
    throw new CompassError('NotSignedIn');
  }
}
