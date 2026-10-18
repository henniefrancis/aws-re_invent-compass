// sign_out (Requirement 9.2): runs the S1 sign-out flow and gives the Builder ID sign-out URL.

import type { ToolContext, ToolOutcome } from '../server/types.js';

/** sign_out: runs the S1 sign-out flow and gives the Builder ID sign-out URL. */
export async function signOut(_input: object, ctx: ToolContext): Promise<ToolOutcome<'sign_out'>> {
  const { signOutUrl } = await ctx.runtime.events.signOut();
  return {
    ok: true,
    structured: { signedOut: true },
    text: `You are signed out of Compass. To also end your AWS Builder ID session in the browser, open ${signOutUrl}`,
  };
}
