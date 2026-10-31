// sync_passes (Requirements 15.6 and 15.7, CTO review H1, integrator S4 sync safety).
//
// sync_passes is a Write_Tool because it can void passes. It reads a fresh, complete schedule,
// resolves the reserved ids through the catalog, narrows both sides to `sessionIds` when given
// (the adapter narrows the stored passes the same way, so a narrowed sync never touches other
// passes), and previews what S4 would do. Whenever the plan has any issue, update or void, the human
// is asked first (where the client can ask) with each change listed by code and catalog title
// (security M3). Voiding every pass, or more than five, needs that elicited confirmation and sets
// S4's `confirmEmpty` or `allowBulkVoid`; where the client cannot ask, it is refused. A reserved
// session the catalog does not know makes the sync refuse and ask for refresh_catalog (security M4),
// because a pass for it could not be built or compared safely.

import type { NormalisedSession } from '@compass/contracts';
import { CompassError } from '../ports/errors.js';
import type { CatalogView } from '../ports/events-port.js';
import { checkIdentifiers } from '../safety/identifiers.js';
import { labelUntrusted } from '../safety/labelled-data.js';
import type { ToolContext, ToolOutcome } from '../server/types.js';
import type { SyncScope } from '../ports/passes-port.js';
import { describeTargets } from '../safety/targets.js';
import { ensureSignedIn, readFreshSchedule, scheduleViewOf } from './common.js';
import { VOID_NOTE } from './pass-text.js';

/** More than this many voids in one sync needs explicit confirmation. */
export const BULK_VOID_THRESHOLD = 5;

/** The session for an id, or the fixed "run refresh_catalog" error when the catalog does not know it. */
function known(catalog: CatalogView, id: string): NormalisedSession {
  const entry = catalog.byId.get(id);
  if (entry === undefined) {
    throw new CompassError('UnknownSession');
  }
  return entry.session;
}

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
  const considered = schedule.reserved.filter((id) => narrow === undefined || narrow.has(id));
  // A reserved session the catalog does not know refuses the sync (security M4).
  const resolved = considered.map((id) => known(catalog, id));

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
  const describe = (id: string): { code: string; title: string | undefined } => {
    const { code, title } = known(catalog, id);
    return { code, title };
  };
  const voiding = plan.toVoid.map((v) => ({
    code: v.sessionCode,
    title: titles.get(v.sessionCode),
  }));

  const changes = [
    ...plan.toIssue.map((id) => ({ verb: 'Issue', ...describe(id) })),
    ...plan.toUpdate.map((id) => ({ verb: 'Update', ...describe(id) })),
    ...voiding.map((v) => ({ verb: 'Void', code: v.code, title: v.title })),
  ];
  if (changes.length > 0 && ctx.elicit !== undefined) {
    const answer = await ctx.elicit({
      message: [
        `This sync will change your Boarding Passes: ${plan.toIssue.length} to issue, ${plan.toUpdate.length} to update, ${plan.toVoid.length} to void${emptyVoid ? ', which is every pass you hold' : ''}.`,
        ...changes.map(
          (c) => `- ${c.verb} ${c.code}${c.title === undefined ? '' : ` "${c.title}"`}`,
        ),
        ...(plan.toVoid.length > 0 ? [VOID_NOTE] : []),
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
