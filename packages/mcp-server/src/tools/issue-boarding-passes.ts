// issue_boarding_passes (Requirements 15.1 to 15.3): issues passes only for sessions the fresh
// confirmed schedule lists as reserved. Anything else is refused without any pass call. Each
// reserved session is refreshed through S1 GetSession first, so the pass carries current
// times. The text says the pass is unofficial and that the badge is the ticket, and never claims
// a pass can be deleted from a phone.

import { CompassError } from '../ports/errors.js';
import { checkIdentifiers } from '../safety/identifiers.js';
import { labelUntrusted } from '../safety/labelled-data.js';
import { describeTargets } from '../safety/targets.js';
import type { ToolContext, ToolOutcome } from '../server/types.js';
import {
  confirmMessage,
  confirmedCommitments,
  ensureSignedIn,
  humanConfirms,
  readFreshSchedule,
} from './common.js';
import { PASS_DISCLAIMER } from './pass-text.js';

/** issue_boarding_passes. */
export async function issueBoardingPasses(
  input: { sessionIds: string[] },
  ctx: ToolContext,
): Promise<ToolOutcome<'issue_boarding_passes'>> {
  const { events, passes } = ctx.runtime;
  if (!checkIdentifiers(input.sessionIds).ok) {
    throw new CompassError('IdentifierRejected');
  }
  await ensureSignedIn(ctx);
  const catalog = await events.catalog();
  const targets = describeTargets(input.sessionIds, catalog);
  if (targets.missing > 0) {
    throw new CompassError('UnknownSession');
  }
  const { schedule } = await readFreshSchedule(ctx);
  const reservedIds = input.sessionIds.filter((id) => schedule.reserved.includes(id));
  const refused = targets.found.filter((t) => !schedule.reserved.includes(t.sessionId));
  const reserved = targets.found.filter((t) => schedule.reserved.includes(t.sessionId));

  if (reservedIds.length === 0) {
    return {
      ok: true,
      structured: { issued: [], serials: [] },
      text: [
        'No passes were issued, because none of those sessions is reserved on your schedule.',
        labelUntrusted('catalog', { refused }),
      ].join('\n'),
    };
  }
  const approved = await humanConfirms(
    ctx,
    confirmMessage(
      'Issue boarding passes for these sessions? This creates real passes on the Compass pass service.',
      reserved,
    ),
  );
  if (!approved) {
    return {
      ok: true,
      structured: { issued: [], serials: [] },
      text: 'No passes were issued, because you did not confirm.',
    };
  }

  const sessions = [];
  for (const id of reservedIds) {
    sessions.push(await events.getSession(id));
  }
  const issued = await passes.issue(sessions, confirmedCommitments(schedule, catalog));
  return {
    ok: true,
    structured: {
      issued: issued.map((i) => i.sessionId),
      serials: issued.map((i) => i.serialNumber),
    },
    text: [
      `Issued ${issued.length} boarding passes.`,
      PASS_DISCLAIMER,
      ...(refused.length > 0 ? ['Some sessions were refused because they are not reserved.'] : []),
      labelUntrusted('catalog', { issued: reserved, refused }),
    ].join('\n'),
  };
}
