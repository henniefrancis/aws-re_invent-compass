// refresh_catalog (Requirement 9.3): downloads the catalog through S1 and resolves the event
// window.

import type { ToolContext, ToolOutcome } from '../server/types.js';
import { ensureSignedIn } from './common.js';

/** refresh_catalog: downloads the catalog and resolves the event window. */
export async function refreshCatalog(
  _input: { force?: boolean | undefined },
  ctx: ToolContext,
): Promise<ToolOutcome<'refresh_catalog'>> {
  await ensureSignedIn(ctx);
  const result = await ctx.runtime.events.refreshCatalog();
  await ctx.runtime.events.eventWindow();
  return {
    ok: true,
    structured: { sessionCount: result.sessionCount, refreshedAt: result.refreshedAt },
    text: `The catalog now holds ${result.sessionCount} sessions, refreshed at ${result.refreshedAt}.`,
  };
}
