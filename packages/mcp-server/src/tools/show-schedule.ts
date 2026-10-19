// show_schedule (post-SP3 Requirements P1.1, P1.3): reads the attendee's live schedule and lists
// the reserved sessions, the standby list and the layovers with the ids the write tools take,
// so an agent that sees only the text can still cancel, remove or change an entry. Nothing is
// written to S1 or S4. Catalog titles are shown only inside a catalog Labelled_Data_Block and
// layover titles and locations only inside an attendee block.

import type { NormalisedSession, PersonalTime } from '@compass/contracts';
import type { CatalogView } from '../ports/events-port.js';
import { labelUntrusted } from '../safety/labelled-data.js';
import type { ToolContext, ToolOutcome } from '../server/types.js';
import { ensureSignedIn, readFreshSchedule } from './common.js';

/** A start instant for sorting; an entry with no usable time sorts last. */
function startOf(value: string | undefined): number {
  const instant = value === undefined ? Number.NaN : Date.parse(value);
  return Number.isNaN(instant) ? Number.POSITIVE_INFINITY : instant;
}

/** The catalog sessions for some schedule ids, in start order. */
function sessionsFor(ids: readonly string[], catalog: CatalogView): NormalisedSession[] {
  return ids
    .flatMap((id) => {
      const entry = catalog.byId.get(id);
      return entry === undefined ? [] : [entry.session];
    })
    .sort((a, b) => startOf(a.startsAt) - startOf(b.startsAt));
}

function sessionRow(session: NormalisedSession) {
  return {
    sessionId: session.sessionId,
    code: session.code,
    title: session.title,
    venue: session.venue,
    room: session.room,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
  };
}

function layoverRow(time: PersonalTime) {
  return {
    personalTimeId: time.personalTimeId,
    title: time.title,
    startDateTime: time.startDateTime,
    endDateTime: time.endDateTime,
    location: time.location,
  };
}

/** show_schedule. */
export async function showSchedule(
  _input: object,
  ctx: ToolContext,
): Promise<ToolOutcome<'show_schedule'>> {
  await ensureSignedIn(ctx);
  const catalog = await ctx.runtime.events.catalog();
  const { schedule } = await readFreshSchedule(ctx);
  const notInCatalog = [...schedule.reserved, ...schedule.favorites].filter(
    (id) => !catalog.byId.has(id),
  );
  const layovers = [...schedule.personalTime].sort(
    (a, b) => startOf(a.startDateTime) - startOf(b.startDateTime),
  );

  const counts = `Your schedule has ${schedule.reserved.length} reserved sessions, ${schedule.favorites.length} on your standby list and ${layovers.length} layovers.`;
  const lines = [counts];
  if (schedule.reserved.length + schedule.favorites.length > 0) {
    lines.push(
      'Use sessionId with cancel_reservation or remove_standby.',
      labelUntrusted('catalog', {
        reserved: sessionsFor(schedule.reserved, catalog).map(sessionRow),
        standby: sessionsFor(schedule.favorites, catalog).map(sessionRow),
      }),
    );
  }
  if (layovers.length > 0) {
    lines.push(
      'Use personalTimeId with add_layover to change or delete a layover.',
      labelUntrusted('attendee', { layovers: layovers.map(layoverRow) }),
    );
  }
  if (notInCatalog.length > 0) {
    lines.push(
      `${notInCatalog.length} sessions on your schedule are not in the catalog Compass has cached, so their codes and times are not shown. Run refresh_catalog if they should be.`,
      labelUntrusted('catalog', { notInCatalog }),
    );
  }
  return { ok: true, structured: { schedule, notInCatalog }, text: lines.join('\n') };
}
