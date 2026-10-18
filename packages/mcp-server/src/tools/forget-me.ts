// forget_me (Requirement 16): deletes everything Compass holds about the attendee. It runs the S4
// forget-me orchestrator (which voids the passes on the Compass service and removes the local
// pass record, calendar and itinerary page) and only on its success deletes the Schedule_Snapshot
// and clears the in-memory scan result and Pending_Swaps. On failure nothing local is touched
// and the text says so. The copy never claims a pass was deleted from a phone: a voided pass
// expires in the wallet but stays there until the attendee removes it.

import type { ToolContext, ToolOutcome } from '../server/types.js';
import { ensureSignedIn, humanConfirms } from './common.js';

const PHONE_NOTE =
  'Passes already in a wallet stay on the phone until you remove them yourself, but they are voided and will expire.';

/** forget_me. */
export async function forgetMe(
  _input: { confirm: true },
  ctx: ToolContext,
): Promise<ToolOutcome<'forget_me'>> {
  const { passes, snapshot } = ctx.runtime;
  await ensureSignedIn(ctx);
  const approved = await humanConfirms(
    ctx,
    'Delete everything Compass holds about you? This voids your boarding passes and removes your local Compass data.\nGo ahead?',
  );
  if (!approved) {
    return {
      ok: true,
      structured: { forgotten: false },
      text: 'Nothing was deleted, because you did not confirm.',
    };
  }
  const outcome = await passes.forgetMe();
  if (!outcome.ok) {
    return {
      ok: true,
      structured: { forgotten: false },
      text: `Nothing was deleted on this computer. ${outcome.summary}`,
    };
  }
  await snapshot.remove();
  ctx.state.lastScan = undefined;
  ctx.state.swaps.clearAll();
  return {
    ok: true,
    structured: { forgotten: true },
    text: `Your boarding passes were voided and your local Compass data was deleted. ${PHONE_NOTE}`,
  };
}
