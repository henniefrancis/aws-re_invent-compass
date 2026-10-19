// Helpers shared by the tool handlers.

import type { Commitment, NormalisedSession, ScheduleWire } from '@compass/contracts';
import type { ScheduleView } from '@compass/core/passes';
import { CompassError } from '../ports/errors.js';
import type { CatalogView, EventWindow } from '../ports/events-port.js';
import { READ_ONLY_MESSAGE } from '../server/error-messages.js';
import type { ToolContext } from '../server/types.js';

/** Throws NotSignedIn unless the attendee is signed in. Simulated mode is signed in at once. */
export async function ensureSignedIn(ctx: ToolContext): Promise<void> {
  if (!(await ctx.runtime.events.isSignedIn())) {
    throw new CompassError('NotSignedIn');
  }
}

/** A fresh, confirmed schedule and the event window it was read against. */
export interface FreshSchedule {
  schedule: ScheduleWire;
  window: EventWindow;
}

/**
 * Reads the schedule from S1 (never from a cache) and the event window, and updates the
 * Schedule_Snapshot (Requirement 12.8) so the hooks can read it.
 */
export async function readFreshSchedule(ctx: ToolContext): Promise<FreshSchedule> {
  const { events, snapshot, clock, mode } = ctx.runtime;
  const schedule = await events.getSchedule();
  const window = await events.eventWindow();
  await snapshot.write({
    version: 1,
    mode,
    fetchedAt: clock.now().toISOString(),
    eventWindow: window,
    schedule,
  });
  return { schedule, window };
}

/** A reserved-session commitment for a catalog session. Missing times become empty strings. */
export function commitmentFor(session: NormalisedSession): Commitment {
  return {
    kind: 'reservedSession',
    sessionId: session.sessionId,
    startsAt: session.startsAt ?? '',
    endsAt: session.endsAt ?? '',
    title: session.title,
    ...(session.venue === undefined ? {} : { venue: session.venue }),
  };
}

/**
 * The confirmed schedule as commitments: reserved sessions the catalog knows, and personal
 * time. A reserved session missing from the catalog cannot be placed in time and is left out.
 */
export function confirmedCommitments(schedule: ScheduleWire, lookup: CatalogView): Commitment[] {
  const commitments: Commitment[] = [];
  for (const id of schedule.reserved) {
    const entry = lookup.byId.get(id);
    if (entry !== undefined) {
      commitments.push(commitmentFor(entry.session));
    }
  }
  for (const time of schedule.personalTime) {
    commitments.push({
      kind: 'personalTime',
      title: time.title,
      startsAt: time.startDateTime,
      endsAt: time.endDateTime,
      personalTimeId: time.personalTimeId,
      ...(time.location === undefined ? {} : { location: time.location }),
    });
  }
  return commitments;
}

/** A session as shown to the human before a write: from the catalog, never from model text. */
export interface ActingOn {
  sessionId: string;
  code: string;
  title: string;
}

/**
 * The confirmation question for a write (CTO review M4): the action, the exact ids, codes and
 * catalog titles it will act on, and every warning.
 */
export function confirmMessage(
  action: string,
  targets: readonly ActingOn[],
  warnings: readonly string[] = [],
): string {
  const lines = [
    action,
    ...targets.map((t) => `- ${t.code} "${t.title}" (id ${t.sessionId})`),
    ...warnings.map((warning) => `Warning: ${warning}`),
    'Go ahead?',
  ];
  return lines.join('\n');
}

/**
 * When Compass is read-only (the live default, compass-power task 37), the reply a schedule write tool gives instead
 * of asking: what it would have done, and that nothing changed. Undefined when writes are on.
 * The confirmation text is reused without its closing question.
 */
export function readOnlyReply(ctx: ToolContext, confirmation: string): string | undefined {
  if (ctx.runtime.readOnly !== true) {
    return undefined;
  }
  const preview = confirmation
    .replace(/\nGo ahead\?$/, '')
    .replace(' This changes your real re:Invent schedule.', '');
  return [READ_ONLY_MESSAGE, 'Compass would have done this:', preview].join('\n');
}

/**
 * True when the write may go ahead: the client has no elicitation (the agent's own approval is
 * the only gate) or the human accepted. A decline or cancel means no write.
 */
export async function humanConfirms(ctx: ToolContext, message: string): Promise<boolean> {
  return ctx.elicit === undefined || (await ctx.elicit({ message })) === 'accept';
}

/**
 * The confirmed schedule as S4 sees it: the reserved sessions the catalog knows (a refreshed
 * session replaces the cached one) and the personal time.
 */
export function scheduleViewOf(
  schedule: ScheduleWire,
  lookup: CatalogView,
  refreshed: readonly NormalisedSession[] = [],
): ScheduleView {
  const newer = new Map(refreshed.map((session) => [session.sessionId, session]));
  return {
    sessions: schedule.reserved.flatMap((id) => {
      const session = newer.get(id) ?? lookup.byId.get(id)?.session;
      return session === undefined ? [] : [session];
    }),
    personalTime: schedule.personalTime,
  };
}

/** A schedule view built from commitments the caller gave (export_calendar). */
export function scheduleViewFromCommitments(
  commitments: readonly Commitment[],
  lookup: CatalogView,
): ScheduleView {
  return {
    sessions: commitments.flatMap((c) => {
      const session =
        c.kind === 'reservedSession' ? lookup.byId.get(c.sessionId)?.session : undefined;
      return session === undefined ? [] : [session];
    }),
    personalTime: commitments.flatMap((c, index) =>
      c.kind === 'personalTime'
        ? [
            {
              personalTimeId: c.personalTimeId ?? `layover-${String(index + 1)}`,
              startDateTime: c.startsAt,
              endDateTime: c.endsAt,
              title: c.title,
              description: '',
              ...(c.location === undefined ? {} : { location: c.location }),
            },
          ]
        : [],
    ),
  };
}
