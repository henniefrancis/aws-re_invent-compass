// export_calendar (Requirement 15.8): builds a calendar file through the S4 exporter, from the
// commitments given or, when none are given, from the fresh confirmed schedule. Nothing is
// booked or changed.

import type { Commitment } from '@compass/contracts';
import { CompassError } from '../ports/errors.js';
import { checkIdentifiers } from '../safety/identifiers.js';
import type { ToolContext, ToolOutcome } from '../server/types.js';
import { confirmedCommitments, ensureSignedIn, readFreshSchedule } from './common.js';

/** export_calendar. */
export async function exportCalendar(
  input: { commitments?: Commitment[] | undefined },
  ctx: ToolContext,
): Promise<ToolOutcome<'export_calendar'>> {
  const { events, passes } = ctx.runtime;
  let commitments: Commitment[];
  if (input.commitments === undefined) {
    await ensureSignedIn(ctx);
    const catalog = await events.catalog();
    const { schedule } = await readFreshSchedule(ctx);
    commitments = confirmedCommitments(schedule, catalog);
  } else {
    const ids = input.commitments.flatMap((c) =>
      c.kind === 'reservedSession' ? [c.sessionId] : [],
    );
    if (!checkIdentifiers(ids).ok) {
      throw new CompassError('IdentifierRejected');
    }
    commitments = input.commitments;
  }
  const calendar = await passes.exportCalendar(commitments);
  return {
    ok: true,
    structured: { ics: calendar.ics },
    text: `Built a calendar with ${commitments.length} entries. Import the .ics text into your calendar app. A copy was saved at ${calendar.path}.`,
  };
}
