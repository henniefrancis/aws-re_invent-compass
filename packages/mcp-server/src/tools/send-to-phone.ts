// send_to_phone (Requirements 15.4 and 15.5): creates a 15-minute hand-off for the serials of the
// chosen sessions (all issued passes when none are chosen) and returns the board URL, its
// expiry, the text QR code and the PNG QR code. The URL is the capability the attendee needs, so
// it is returned to the client but never logged.

import { CompassError } from '../ports/errors.js';
import { checkIdentifiers } from '../safety/identifiers.js';
import { labelUntrusted } from '../safety/labelled-data.js';
import { describeTargets } from '../safety/targets.js';
import type { ImageContent, ToolContext, ToolOutcome } from '../server/types.js';
import { ensureSignedIn, humanConfirms } from './common.js';
import { PASS_DISCLAIMER } from './pass-text.js';

/** send_to_phone. */
export async function sendToPhone(
  input: { sessionIds?: string[] | undefined },
  ctx: ToolContext,
): Promise<ToolOutcome<'send_to_phone'>> {
  const { events, passes } = ctx.runtime;
  const ids = input.sessionIds ?? [];
  if (!checkIdentifiers(ids).ok) {
    throw new CompassError('IdentifierRejected');
  }
  await ensureSignedIn(ctx);
  const catalog = await events.catalog();
  const targets = describeTargets(ids, catalog);
  if (targets.missing > 0) {
    throw new CompassError('UnknownSession');
  }
  const record = await passes.issuedRecord();
  const codes = new Set(targets.found.map((t) => t.code));
  const chosen =
    input.sessionIds === undefined ? record : record.filter((r) => codes.has(r.sessionCode));
  if (chosen.length === 0) {
    throw new CompassError('NoPassesIssued');
  }
  const shown = [...new Set(chosen.map((r) => r.sessionCode))];
  const approved = await humanConfirms(
    ctx,
    `Create a 15-minute link that puts ${chosen.length} boarding passes (${shown.join(', ')}) on your phone? This creates a real link.\nGo ahead?`,
  );
  if (!approved) {
    return {
      ok: false,
      message: 'No link was created, because you did not confirm.',
    };
  }

  const handoff = await passes.handoff(chosen.map((r) => r.serialNumber));
  const png: ImageContent = {
    type: 'image',
    data: Buffer.from(handoff.chatPng).toString('base64'),
    mimeType: 'image/png',
  };
  return {
    ok: true,
    structured: { handoffUrl: handoff.boardUrl, expiresAt: handoff.expiresAt },
    text: [
      `Open this link on your phone before ${handoff.expiresAt}: ${handoff.boardUrl}`,
      'Or scan this QR code with your phone camera:',
      handoff.terminalQr,
      handoff.chatText,
      PASS_DISCLAIMER,
      labelUntrusted('catalog', { passes: shown }),
    ].join('\n'),
    extra: [png],
  };
}
