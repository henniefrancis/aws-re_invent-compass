// add_layover (Requirement 14.3 to 14.6, CTO review M2 and M4, TAM review B5): creates, updates
// or deletes a block of the attendee's own time, so all three personal time operations of the
// Events API are reachable from a tool. The contract input is a union on `action`.
//
// Validation happens before the write and, for the offsets and the order, before any call at
// all: both times need an offset, the end must be after the start, and both must be inside the
// event window (read from the Schedule_Snapshot, or from S1 only when there is none, never
// guessed), widened to start at 00:00 on the badge pickup day, the day before the event, in the
// event time zone (task 56), and must end on the date they start in that zone (task 62). Update and delete also check the personal time id with the
// Identifier_Check and look the entry up in the fresh schedule, so the confirmation names what
// will change. An
// overlap with a commitment is a warning; the layover is still written. Every action asks the
// human to confirm (Schedule_Write_Tools). The title is the attendee's own text and is shown
// only inside a Labelled_Data_Block.

import type { PersonalTime, PersonalTimeInput, ScheduleWire } from '@compass/contracts';
import { startOfDayBefore } from '@compass/core/catalog';
import { CompassError } from '../ports/errors.js';
import type { EventWindow } from '../ports/events-port.js';
import { labelUntrusted } from '../safety/labelled-data.js';
import { checkIdentifier } from '../safety/identifiers.js';
import type { ToolContext, ToolOutcome } from '../server/types.js';
import {
  confirmedCommitments,
  ensureSignedIn,
  humanConfirms,
  readFreshSchedule,
  readOnlyReply,
} from './common.js';

/** What the handler can do with personal time. */
export type LayoverAction =
  | { action: 'create'; personalTime: PersonalTimeInput }
  | { action: 'update'; personalTimeId: string; personalTime: PersonalTimeInput }
  | { action: 'delete'; personalTimeId: string };

/** The marker title used when asking S2 about the new layover's overlaps. */
const NEW_LAYOVER = 'Your new layover';

/** The Events API takes personal time in whole 5 minute steps. */
const FIVE_MINUTES_MS = 5 * 60_000;

const OFFSET_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function instantOf(value: string): number {
  return OFFSET_INSTANT.test(value) ? Date.parse(value) : Number.NaN;
}

async function windowFor(ctx: ToolContext): Promise<EventWindow> {
  const known = await ctx.runtime.snapshot.read();
  return known?.eventWindow ?? (await ctx.runtime.events.eventWindow());
}

/** Checks the times of a created or updated layover and returns them as instants. */
async function validTimes(
  personalTime: PersonalTimeInput,
  ctx: ToolContext,
): Promise<{ start: number; end: number }> {
  const start = instantOf(personalTime.startDateTime);
  const end = instantOf(personalTime.endDateTime);
  if (
    Number.isNaN(start) ||
    Number.isNaN(end) ||
    end <= start ||
    start % FIVE_MINUTES_MS !== 0 ||
    end % FIVE_MINUTES_MS !== 0
  ) {
    throw new CompassError('LayoverInvalid');
  }
  const window = await windowFor(ctx);
  const opens = startOfDayBefore(window.start, window.timezone) ?? window.start;
  if (start < Date.parse(opens) || end > Date.parse(window.end)) {
    throw new CompassError('LayoverInvalid');
  }
  // The Events API takes a block only when it ends on the date it starts, in the event time
  // zone, so an end at 00:00 the next day is refused too (compass-power task 62).
  if (eventDate(start, window.timezone) !== eventDate(end, window.timezone)) {
    throw new CompassError('LayoverInvalid');
  }
  return { start, end };
}

/** The calendar date of an instant in the event time zone; a zone that cannot be read refuses. */
function eventDate(ms: number, zone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone, dateStyle: 'short' }).format(ms);
  } catch {
    throw new CompassError('LayoverInvalid');
  }
}

function requireId(personalTimeId: string): void {
  if (!checkIdentifier(personalTimeId).ok) {
    throw new CompassError('IdentifierRejected');
  }
}

/** The overlaps of a layover with the confirmed schedule, leaving out the entry it replaces. */
async function overlapsOf(
  personalTime: PersonalTimeInput,
  replacing: string | undefined,
  ctx: ToolContext,
  fresh: Awaited<ReturnType<typeof readFreshSchedule>>,
): Promise<string[]> {
  const { events, rules } = ctx.runtime;
  const catalog = await events.catalog();
  const confirmed = confirmedCommitments(
    {
      ...fresh.schedule,
      personalTime: fresh.schedule.personalTime.filter((p) => p.personalTimeId !== replacing),
    },
    catalog,
  );
  const { clashes } = await rules.findClashes(
    [
      ...confirmed,
      {
        kind: 'personalTime',
        title: NEW_LAYOVER,
        startsAt: personalTime.startDateTime,
        endsAt: personalTime.endDateTime,
      },
    ],
    catalog,
  );
  return clashes
    .filter((c) => c.firstTitle === NEW_LAYOVER || c.secondTitle === NEW_LAYOVER)
    .map((c) => c.reason);
}

function declined(action: LayoverAction['action']): ToolOutcome<'add_layover'> {
  return {
    ok: true,
    structured: { action, done: false },
    text: 'Nothing was changed, because you did not confirm.',
  };
}

/**
 * Asks before a layover write, or in read-only live mode (task 37) says what it would have done.
 * Undefined means go ahead.
 */
async function confirmOrStop(
  ctx: ToolContext,
  action: LayoverAction['action'],
  question: string,
  readOnlyData: { attendee: Record<string, string>; warnings?: readonly string[] },
): Promise<ToolOutcome<'add_layover'> | undefined> {
  // Read-only reply (task 40): the attendee's own text and the catalog warnings stay labelled.
  const readOnly = readOnlyReply(
    ctx,
    `${action} a layover.`,
    [
      labelUntrusted('attendee', readOnlyData.attendee),
      labelUntrusted('catalog', { warnings: readOnlyData.warnings ?? [] }),
    ].join('\n'),
  );
  if (readOnly !== undefined) {
    return { ok: true, structured: { action, done: false }, text: readOnly };
  }
  return (await humanConfirms(ctx, question)) ? undefined : declined(action);
}

function unconfirmed(action: LayoverAction['action']): ToolOutcome<'add_layover'> {
  return {
    ok: true,
    structured: { action, done: false },
    text: 'The change was sent, but Compass could not read your schedule back, so it is unconfirmed. Check your schedule before trying again. Compass did not send it twice.',
  };
}

async function remember(
  ctx: ToolContext,
  fresh: Awaited<ReturnType<typeof readFreshSchedule>>,
  schedule: ScheduleWire,
): Promise<void> {
  const { snapshot, clock, mode } = ctx.runtime;
  await snapshot.write({
    version: 1,
    mode,
    fetchedAt: clock.now().toISOString(),
    eventWindow: fresh.window,
    schedule,
  });
}

function matches(entry: PersonalTime, personalTime: PersonalTimeInput): boolean {
  return (
    entry.title === personalTime.title &&
    Date.parse(entry.startDateTime) === Date.parse(personalTime.startDateTime) &&
    Date.parse(entry.endDateTime) === Date.parse(personalTime.endDateTime)
  );
}

/**
 * The result text. A confirmed layover's `personalTimeId` sits beside its title inside the
 * attendee block, because some clients show the model only the text (post-SP3 P1.2).
 */
function summaryLines(
  headline: string,
  warnings: readonly string[],
  title: string,
  personalTimeId?: string,
): string {
  return [
    headline,
    ...(warnings.length > 0
      ? [
          'It overlaps something on your schedule. It was still written.',
          labelUntrusted('catalog', warnings),
        ]
      : []),
    labelUntrusted(
      'attendee',
      personalTimeId === undefined ? { title } : { personalTimeId, title },
    ),
  ].join('\n');
}

async function createLayover(
  personalTime: PersonalTimeInput,
  ctx: ToolContext,
): Promise<ToolOutcome<'add_layover'>> {
  await validTimes(personalTime, ctx);
  await ensureSignedIn(ctx);
  const fresh = await readFreshSchedule(ctx);
  const warnings = await overlapsOf(personalTime, undefined, ctx, fresh);

  const stop = await confirmOrStop(
    ctx,
    'create',
    [
      `Add a layover from ${personalTime.startDateTime} to ${personalTime.endDateTime}? This changes your real re:Invent schedule.`,
      labelUntrusted('attendee', { title: personalTime.title }),
      ...warnings.map((warning) => `Warning: ${warning}`),
      'Go ahead?',
    ].join('\n'),
    {
      attendee: {
        title: personalTime.title,
        from: personalTime.startDateTime,
        to: personalTime.endDateTime,
      },
      warnings,
    },
  );
  if (stop !== undefined) {
    return stop;
  }

  const written = await ctx.runtime.events.createPersonalTime(personalTime);
  if (written.kind === 'unconfirmed') {
    return unconfirmed('create');
  }
  await remember(ctx, fresh, written.schedule);
  const known = new Set(fresh.schedule.personalTime.map((p) => p.personalTimeId));
  const entry = written.schedule.personalTime.find(
    (p) => !known.has(p.personalTimeId) && matches(p, personalTime),
  );
  return {
    ok: true,
    structured:
      entry === undefined
        ? { action: 'create', done: false }
        : { action: 'create', done: true, personalTimeId: entry.personalTimeId },
    text: summaryLines(
      entry === undefined
        ? 'The layover was sent, but your schedule does not list it, so it is not confirmed.'
        : 'The layover is on your schedule and your schedule confirms it.',
      warnings,
      personalTime.title,
      entry?.personalTimeId,
    ),
  };
}

async function updateLayover(
  personalTimeId: string,
  personalTime: PersonalTimeInput,
  ctx: ToolContext,
): Promise<ToolOutcome<'add_layover'>> {
  requireId(personalTimeId);
  await validTimes(personalTime, ctx);
  await ensureSignedIn(ctx);
  const fresh = await readFreshSchedule(ctx);
  const current = fresh.schedule.personalTime.find((p) => p.personalTimeId === personalTimeId);
  if (current === undefined) {
    return {
      ok: true,
      structured: { action: 'update', done: false },
      text: 'That layover is not on your schedule, so nothing was changed.',
    };
  }
  const warnings = await overlapsOf(personalTime, personalTimeId, ctx, fresh);

  const stop = await confirmOrStop(
    ctx,
    'update',
    [
      `Change the layover (id ${personalTimeId}) now from ${current.startDateTime} to ${current.endDateTime} so that it runs from ${personalTime.startDateTime} to ${personalTime.endDateTime}? This changes your real re:Invent schedule.`,
      labelUntrusted('attendee', { was: current.title, now: personalTime.title }),
      ...warnings.map((warning) => `Warning: ${warning}`),
      'Go ahead?',
    ].join('\n'),
    {
      attendee: {
        personalTimeId,
        was: current.title,
        now: personalTime.title,
        from: personalTime.startDateTime,
        to: personalTime.endDateTime,
      },
      warnings,
    },
  );
  if (stop !== undefined) {
    return stop;
  }

  const written = await ctx.runtime.events.updatePersonalTime(personalTimeId, personalTime);
  if (written.kind === 'unconfirmed') {
    return unconfirmed('update');
  }
  await remember(ctx, fresh, written.schedule);
  const entry = written.schedule.personalTime.find(
    (p) => p.personalTimeId === personalTimeId && matches(p, personalTime),
  );
  return {
    ok: true,
    structured:
      entry === undefined
        ? { action: 'update', done: false, personalTimeId }
        : { action: 'update', done: true, personalTimeId },
    text: summaryLines(
      entry === undefined
        ? 'The change was sent, but your schedule does not show it, so it is not confirmed.'
        : 'The layover is changed and your schedule confirms it.',
      warnings,
      personalTime.title,
      personalTimeId,
    ),
  };
}

async function deleteLayover(
  personalTimeId: string,
  ctx: ToolContext,
): Promise<ToolOutcome<'add_layover'>> {
  requireId(personalTimeId);
  await ensureSignedIn(ctx);
  const fresh = await readFreshSchedule(ctx);
  const current = fresh.schedule.personalTime.find((p) => p.personalTimeId === personalTimeId);
  if (current === undefined) {
    return {
      ok: true,
      structured: { action: 'delete', done: false },
      text: 'That layover is not on your schedule, so nothing was deleted.',
    };
  }

  const stop = await confirmOrStop(
    ctx,
    'delete',
    [
      `Delete the layover (id ${personalTimeId}) from ${current.startDateTime} to ${current.endDateTime}? This changes your real re:Invent schedule.`,
      labelUntrusted('attendee', { title: current.title }),
      'Go ahead?',
    ].join('\n'),
    {
      attendee: {
        personalTimeId,
        title: current.title,
        from: current.startDateTime,
        to: current.endDateTime,
      },
    },
  );
  if (stop !== undefined) {
    return stop;
  }

  const written = await ctx.runtime.events.deletePersonalTime(personalTimeId);
  if (written.kind === 'unconfirmed') {
    return unconfirmed('delete');
  }
  await remember(ctx, fresh, written.schedule);
  const gone = !written.schedule.personalTime.some((p) => p.personalTimeId === personalTimeId);
  return {
    ok: true,
    structured: { action: 'delete', done: gone, personalTimeId },
    text: gone
      ? `The layover (id ${personalTimeId}) is deleted and your schedule confirms it.`
      : `The delete was sent, but your schedule still lists the layover (id ${personalTimeId}), so it is not confirmed.`,
  };
}

/** add_layover. */
export function addLayover(
  input: LayoverAction,
  ctx: ToolContext,
): Promise<ToolOutcome<'add_layover'>> {
  switch (input.action) {
    case 'create':
      return createLayover(input.personalTime, ctx);
    case 'update':
      return updateLayover(input.personalTimeId, input.personalTime, ctx);
    case 'delete':
      return deleteLayover(input.personalTimeId, ctx);
  }
}
