// issue_all_boarding_passes and issue_boarding_pass (Requirements 15.2, 15.3 and P4.1 to P4.3,
// compass-power task 51). They replace issue_boarding_passes, which Kiro called once per session,
// so the attendee confirmed once per pass. Passes are issued only for sessions the fresh confirmed
// schedule lists as reserved; anything else is refused without any pass call. Each session is
// refreshed through S1 GetSession first, so the pass carries current times, and the adapter splits
// a long list into chunks for the pass service. The text says the pass is unofficial and that the
// badge is the ticket, and never claims a pass can be deleted from a phone.

import type { CatalogView } from '../ports/events-port.js';
import { CompassError } from '../ports/errors.js';
import { checkIdentifiers } from '../safety/identifiers.js';
import { labelUntrusted } from '../safety/labelled-data.js';
import { describeTargets } from '../safety/targets.js';
import type { ToolContext, ToolOutcome } from '../server/types.js';
import type { ScheduleWire } from '@compass/contracts';
import type { ActingOn } from './common.js';
import {
  confirmMessage,
  ensureSignedIn,
  humanConfirms,
  readFreshSchedule,
  scheduleViewOf,
} from './common.js';
import { PASS_DISCLAIMER } from './pass-text.js';

type Issued = ToolOutcome<'issue_all_boarding_passes'>;

/** The reply when nothing is reserved (P4.1, P4.2). */
export const NOTHING_RESERVED =
  'No passes were issued, because nothing is reserved on your schedule. Reserve sessions in the re:Invent app first.';

/** The question of the pick list (P4.2). */
export const WHICH_SESSION = 'Which reserved session should get a Boarding Pass?';

/** The reply to a client that cannot ask, when no session was named (P4.2). */
export const NAME_ONE =
  'Nothing was issued. Name one of your reserved sessions with issue_boarding_pass (its code works), or use issue_all_boarding_passes for all of them.';

function nothing(text: string): Issued {
  return { ok: true, structured: { issued: [], serials: [] }, text };
}

/** Issues the passes after the confirmation, and says what was issued. */
async function issueFor(
  ctx: ToolContext,
  ids: readonly string[],
  schedule: ScheduleWire,
  catalog: CatalogView,
  targets: readonly ActingOn[],
): Promise<Issued> {
  const { events, passes } = ctx.runtime;
  const sessions = [];
  for (const id of ids) {
    sessions.push(await events.getSession(id));
  }
  const issued = await passes.issue(sessions, scheduleViewOf(schedule, catalog, sessions));
  return {
    ok: true,
    structured: {
      issued: issued.map((i) => i.sessionId),
      serials: issued.map((i) => i.serialNumber),
    },
    text: [
      `Issued ${issued.length} Boarding Passes.`,
      PASS_DISCLAIMER,
      labelUntrusted('catalog', { issued: targets }),
    ].join('\n'),
  };
}

/** The reserved session ids the catalog knows, in schedule order. */
function reservedKnown(schedule: ScheduleWire, catalog: CatalogView): string[] {
  return schedule.reserved.filter((id) => catalog.byId.has(id));
}

/** issue_all_boarding_passes: every reserved session, after one confirmation (P4.1). */
export async function issueAllBoardingPasses(
  _input: Record<string, never>,
  ctx: ToolContext,
): Promise<Issued> {
  await ensureSignedIn(ctx);
  const catalog = await ctx.runtime.events.catalog();
  const { schedule } = await readFreshSchedule(ctx);
  const ids = reservedKnown(schedule, catalog);
  if (ids.length === 0) {
    return nothing(NOTHING_RESERVED);
  }
  const targets = describeTargets(ids, catalog).found;
  const approved = await humanConfirms(
    ctx,
    confirmMessage(
      `Issue Boarding Passes for all ${String(ids.length)} of your reserved sessions? This creates real passes on the Compass pass service.`,
      targets,
    ),
  );
  if (!approved) {
    return nothing('No passes were issued, because you did not confirm.');
  }
  return issueFor(ctx, ids, schedule, catalog, targets);
}

/** Pick-list options: "CODE Title", made unique with the id when two would read the same. */
function optionsFor(targets: readonly ActingOn[]): { value: string; label: string }[] {
  const seen = new Set<string>();
  return targets.map((target) => {
    const plain = `${target.code} ${target.title}`;
    const label = seen.has(plain) ? `${plain} (id ${target.sessionId})` : plain;
    seen.add(label);
    return { value: target.sessionId, label };
  });
}

/** issue_boarding_pass: one session, named or picked from the reserved ones (P4.2). */
export async function issueBoardingPass(
  input: { sessionId?: string | undefined },
  ctx: ToolContext,
): Promise<ToolOutcome<'issue_boarding_pass'>> {
  if (input.sessionId !== undefined && !checkIdentifiers([input.sessionId]).ok) {
    throw new CompassError('IdentifierRejected');
  }
  await ensureSignedIn(ctx);
  const catalog = await ctx.runtime.events.catalog();
  if (input.sessionId !== undefined && describeTargets([input.sessionId], catalog).missing > 0) {
    throw new CompassError('UnknownSession');
  }
  const { schedule } = await readFreshSchedule(ctx);

  let id = input.sessionId;
  if (id === undefined) {
    const reserved = describeTargets(reservedKnown(schedule, catalog), catalog).found;
    if (reserved.length === 0) {
      return nothing(NOTHING_RESERVED);
    }
    if (ctx.choose === undefined) {
      return nothing([NAME_ONE, labelUntrusted('catalog', { reserved })].join('\n'));
    }
    const picked = await ctx.choose({ message: WHICH_SESSION, options: optionsFor(reserved) });
    if (typeof picked === 'string') {
      return nothing('No pass was issued, because you did not choose a session.');
    }
    id = picked.value;
  } else if (!schedule.reserved.includes(id)) {
    return nothing(
      [
        'No pass was issued, because that session is not reserved on your schedule.',
        labelUntrusted('catalog', { refused: describeTargets([id], catalog).found }),
      ].join('\n'),
    );
  }

  const targets = describeTargets([id], catalog).found;
  const approved = await humanConfirms(
    ctx,
    confirmMessage(
      'Issue a Boarding Pass for this session? This creates a real pass on the Compass pass service.',
      targets,
    ),
  );
  if (!approved) {
    return nothing('No pass was issued, because you did not confirm.');
  }
  return issueFor(ctx, [id], schedule, catalog, targets);
}
