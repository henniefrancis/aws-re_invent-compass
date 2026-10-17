// sync_passes (Requirements 15.6 and 15.7, CTO review H1, integrator S4 sync safety).
//
// sync_passes is a Write_Tool because it can void passes. It reads a fresh, complete schedule,
// resolves the reserved ids through the catalog, narrows both sides to `sessionIds` when given
// (the adapter narrows the stored passes the same way, so a narrowed sync never touches other
// passes), and previews what S4 would do. A void is shown to the human with the pass codes and
// catalog titles. Voiding every pass, or more than five, needs an explicit elicited confirmation
// and sets S4's `confirmEmpty` or `allowBulkVoid`; where the client cannot ask, it is refused.

import { CompassError } from '../ports/errors.js';
import { checkIdentifiers } from '../safety/identifiers.js';
import { labelUntrusted } from '../safety/labelled-data.js';
import type { ToolContext, ToolOutcome } from '../server/types.js';
import type { SyncScope } from '../ports/passes-port.js';
import { describeTargets } from '../safety/targets.js';
import { ensureSignedIn, readFreshSchedule, scheduleViewOf } from './common.js';
import { VOID_NOTE } from './pass-text.js';

/** More than this many voids in one sync needs explicit confirmation. */
export const BULK_VOID_THRESHOLD = 5;

/** sync_passes. */
export async function syncPasses(
  input: { sessionIds?: string[] | undefined },
  ctx: ToolContext,
): Promise<ToolOutcome<'sync_passes'>> {
  const { events, passes } = ctx.runtime;
  const narrow = input.sessionIds === undefined ? undefined : new Set(input.sessionIds);
  if (!checkIdentifiers(input.sessionIds ?? []).ok) {
    throw new CompassError('IdentifierRejected');
  }
  await ensureSignedIn(ctx);
  const catalog = await events.catalog();
  const { schedule } = await readFreshSchedule(ctx);
  const resolved = schedule.reserved
    .filter((id) => narrow === undefined || narrow.has(id))
    .flatMap((id) => {
      const entry = catalog.byId.get(id);
      return entry === undefined ? [] : [entry.session];
    });

  const scope: SyncScope = {
    resolved,
    schedule: scheduleViewOf(schedule, catalog),
    idByCode: new Map([...catalog.byId.values()].map((e) => [e.session.code, e.session.sessionId])),
    ...(narrow === undefined
      ? {}
      : {
          narrowCodes: new Set(
            describeTargets([...narrow], catalog).sessions.map((session) => session.code),
          ),
        }),
  };
  const plan = await passes.previewSync(scope);
  const emptyVoid = resolved.length === 0 && plan.toVoid.length > 0;
  const bulkVoid = plan.toVoid.length > BULK_VOID_THRESHOLD;
  const titles = new Map([...catalog.byId.values()].map((e) => [e.session.code, e.session.title]));
  const voiding = plan.toVoid.map((v) => ({
    code: v.sessionCode,
    title: titles.get(v.sessionCode),
  }));

  if (plan.toVoid.length > 0 && ctx.elicit !== undefined) {
    const answer = await ctx.elicit({
      message: [
        `This sync will void ${plan.toVoid.length} boarding passes${emptyVoid ? ', which is every pass you hold' : ''}. ${VOID_NOTE}`,
        ...voiding.map((v) => `- ${v.code}${v.title === undefined ? '' : ` "${v.title}"`}`),
        'Go ahead?',
      ].join('\n'),
    });
    if (answer !== 'accept') {
      return {
        ok: true,
        structured: { issued: [], updated: [], voided: [] },
        text: 'Nothing was synced, because you did not confirm.',
      };
    }
  } else if (emptyVoid || bulkVoid) {
    throw new CompassError('BulkVoidRefused');
  }

  const result = await passes.sync({ ...scope, confirmEmpty: emptyVoid, allowBulkVoid: bulkVoid });
  return {
    ok: true,
    structured: result,
    text: [
      `Passes synced: ${result.issued.length} issued, ${result.updated.length} updated, ${result.voided.length} voided.`,
      ...(result.voided.length > 0 ? [VOID_NOTE] : []),
      labelUntrusted('catalog', { voided: voiding }),
    ].join('\n'),
  };
}
