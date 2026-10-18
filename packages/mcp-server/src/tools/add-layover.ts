// add_layover (Requirement 14.3 to 14.6, CTO review M2 and M4): creates a block of the
// attendee's own time. It is create-only for the MVP (the contract input is PersonalTimeInput),
// written around an internal action so adding update and delete later is a schema swap.
//
// Validation happens before the write and, for the offsets and the order, before any call at
// all: both times need an offset, the end must be after the start, and both must be inside the
// event window (read from the Schedule_Snapshot, or from S1 only when there is none, never
// guessed). An overlap with a commitment is a warning; the layover is still created. The title
// is the attendee's own text and is shown only inside a Labelled_Data_Block.

import type { PersonalTimeInput } from '@compass/contracts';
import { CompassError } from '../ports/errors.js';
import type { EventWindow } from '../ports/events-port.js';
import { labelUntrusted } from '../safety/labelled-data.js';
import type { ToolContext, ToolOutcome } from '../server/types.js';
import {
  confirmedCommitments,
  ensureSignedIn,
  humanConfirms,
  readFreshSchedule,
} from './common.js';

/** What the handler can do with personal time. Only creation is reachable from the contract. */
export type LayoverAction = { kind: 'create'; personalTime: PersonalTimeInput };

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

/** add_layover. */
export async function addLayover(
  input: { personalTime: PersonalTimeInput },
  ctx: ToolContext,
): Promise<ToolOutcome<'add_layover'>> {
  const action: LayoverAction = { kind: 'create', personalTime: input.personalTime };
  const { personalTime } = action;
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
  if (start < Date.parse(window.start) || end > Date.parse(window.end)) {
    throw new CompassError('LayoverInvalid');
  }
  await ensureSignedIn(ctx);
  const { events, rules, snapshot, clock, mode } = ctx.runtime;
  const catalog = await events.catalog();
  const fresh = await readFreshSchedule(ctx);
  const confirmed = confirmedCommitments(fresh.schedule, catalog);

  const clashes = (
    await rules.findClashes(
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
    )
  ).clashes.filter((c) => c.firstTitle === NEW_LAYOVER || c.secondTitle === NEW_LAYOVER);
  const warnings = clashes.map((c) => c.reason);

  const approved = await humanConfirms(
    ctx,
    [
      `Add a layover from ${personalTime.startDateTime} to ${personalTime.endDateTime}? This changes your real re:Invent schedule.`,
      labelUntrusted('attendee', { title: personalTime.title }),
      ...warnings.map((warning) => `Warning: ${warning}`),
      'Go ahead?',
    ].join('\n'),
  );
  if (!approved) {
    return {
      ok: true,
      structured: { added: false },
      text: 'Nothing was added, because you did not confirm.',
    };
  }

  const written = await events.createPersonalTime(personalTime);
  if (written.kind === 'unconfirmed') {
    return {
      ok: true,
      structured: { added: false },
      text: 'The layover was sent, but Compass could not read your schedule back, so it is unconfirmed. Check your schedule before trying again. Compass did not send it twice.',
    };
  }
  await snapshot.write({
    version: 1,
    mode,
    fetchedAt: clock.now().toISOString(),
    eventWindow: fresh.window,
    schedule: written.schedule,
  });
  const entry = written.schedule.personalTime.find(
    (p) =>
      p.title === personalTime.title &&
      Date.parse(p.startDateTime) === start &&
      Date.parse(p.endDateTime) === end,
  );
  const lines = [
    entry === undefined
      ? 'The layover was sent, but your schedule does not list it, so it is not confirmed.'
      : 'The layover is on your schedule and your schedule confirms it.',
    ...(clashes.length > 0
      ? [
          'It overlaps something on your schedule. It was still created.',
          labelUntrusted('catalog', warnings),
        ]
      : []),
    labelUntrusted('attendee', { title: personalTime.title }),
  ];
  return {
    ok: true,
    structured:
      entry === undefined
        ? { added: false }
        : { added: true, personalTimeId: entry.personalTimeId },
    text: lines.join('\n'),
  };
}
