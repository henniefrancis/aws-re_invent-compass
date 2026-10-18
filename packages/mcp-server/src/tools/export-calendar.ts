// export_calendar (Requirement 15.8): builds a calendar file through the S4 exporter, from the
// commitments given or, when none are given, from the fresh confirmed schedule. Nothing is
// booked or changed.

import type { Commitment } from '@compass/contracts';
import type { ScheduleView } from '@compass/core/passes';
import { CompassError } from '../ports/errors.js';
import { checkIdentifiers } from '../safety/identifiers.js';
import { labelUntrusted } from '../safety/labelled-data.js';
import type { ToolContext, ToolOutcome } from '../server/types.js';
import {
  ensureSignedIn,
  readFreshSchedule,
  scheduleViewFromCommitments,
  scheduleViewOf,
} from './common.js';

/** export_calendar. */
export async function exportCalendar(
  input: { commitments?: Commitment[] | undefined },
  ctx: ToolContext,
): Promise<ToolOutcome<'export_calendar'>> {
  const { events, passes } = ctx.runtime;
  let view: ScheduleView;
  let entries: number;
  let unknown: string[] = [];
  if (input.commitments === undefined) {
    await ensureSignedIn(ctx);
    const catalog = await events.catalog();
    const { schedule } = await readFreshSchedule(ctx);
    view = scheduleViewOf(schedule, catalog);
    entries = view.sessions.length + view.personalTime.length;
  } else {
    const ids = input.commitments.flatMap((c) =>
      c.kind === 'reservedSession' ? [c.sessionId] : [],
    );
    if (!checkIdentifiers(ids).ok) {
      throw new CompassError('IdentifierRejected');
    }
    const catalog = await events.catalog();
    unknown = ids.filter((id) => !catalog.byId.has(id));
    view = scheduleViewFromCommitments(input.commitments, catalog);
    entries = view.sessions.length + view.personalTime.length;
  }
  const calendar = await passes.exportCalendar(view);
  return {
    ok: true,
    structured: { ics: calendar.ics },
    text: [
      `Built a calendar with ${entries} entries. Import the .ics text into your calendar app. A copy was saved at ${calendar.path}.`,
      ...(unknown.length === 0
        ? []
        : [
            `${unknown.length} sessions you named are not in the catalog Compass has cached, so they are not in the calendar. Run refresh_catalog if they should be.`,
            labelUntrusted('attendee', { notInCatalog: unknown }),
          ]),
    ].join('\n'),
  };
}
