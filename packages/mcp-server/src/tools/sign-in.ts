// sign_in (Requirement 9.1): runs the S1 sign-in flow. In simulated mode the attendee is
// signed in at once and no browser or OAuth endpoint is touched. Tokens never appear in the
// result.

import type { ToolContext, ToolOutcome } from '../server/types.js';

/** sign_in: runs the S1 sign-in flow. Tokens never appear in the result. */
export async function signIn(
  input: { force?: boolean | undefined },
  ctx: ToolContext,
): Promise<ToolOutcome<'sign_in'>> {
  const result = await ctx.runtime.events.signIn(input.force ?? false);
  const lines = [
    result.signedIn
      ? 'You are signed in to the AWS Events service.'
      : 'Sign-in did not finish. Run sign_in again when you are ready.',
  ];
  if (result.signedIn && result.expiresAt !== undefined) {
    lines.push(`This sign-in lasts until ${result.expiresAt}.`);
  }
  if (result.memoryOnlyNotice !== undefined) {
    lines.push(result.memoryOnlyNotice);
  }
  return {
    ok: true,
    structured: {
      signedIn: result.signedIn,
      ...(result.expiresAt === undefined ? {} : { expiresAt: result.expiresAt }),
    },
    text: lines.join('\n'),
  };
}
