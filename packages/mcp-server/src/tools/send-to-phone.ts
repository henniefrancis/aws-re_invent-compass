// send_to_phone (Requirements 15.4 and 15.5, owner amendments P3.1 to P3.6): creates a 15-minute
// hand-off for the serials of the chosen sessions (all issued passes when none are chosen) and
// shows it the way the attendee chose: a link, a QR code on a page in the browser, or both.
// Without a choice it asks and creates nothing. When the QR page cannot be shown, the text QR
// and the PNG QR go in the chat instead. The URL is the capability the attendee needs, so it is
// returned to the client only when a link was asked for, and is never logged.

import { CompassError } from '../ports/errors.js';
import { checkIdentifiers } from '../safety/identifiers.js';
import { labelUntrusted } from '../safety/labelled-data.js';
import { describeTargets } from '../safety/targets.js';
import type { ImageContent, ToolContext, ToolOutcome } from '../server/types.js';
import { ensureSignedIn, humanConfirms } from './common.js';
import { HANDOFF_SHARING_NOTE, PASS_DISCLAIMER, withoutFragment } from './pass-text.js';

/** How the passes reach the phone. */
export type ShowChoice = 'link' | 'qr' | 'both';

/** The reply when no choice was given: nothing was created (P3.1). */
export const ASK_SHOW_MESSAGE =
  'Do you want a link, a QR code or both? Ask the attendee, then run send_to_phone again with show set to link, qr or both. No link was created.';

/** The line when the QR page opened (P3.3). */
export const QR_IN_BROWSER = 'Scan the QR code in your browser with your phone camera';

/**
 * Said after the browser line, because some systems report success without showing the page
 * (security review M1).
 */
export const NO_PAGE_HINT = 'If no page opened in your browser, ask for a link instead.';

/** The line when the QR page could not be shown (P3.4). */
export const QR_PAGE_FAILED =
  'Compass could not open your browser, so here is the QR code. Scan it with your phone camera:';

function confirmQuestion(show: ShowChoice, count: number, codes: string[]): string {
  const how =
    show === 'link'
      ? 'as a link'
      : show === 'qr'
        ? 'as a QR code in your browser'
        : 'as a link and a QR code in your browser';
  return `Create a 15-minute link that puts ${count} Boarding Passes (${codes.join(', ')}) on your phone, shown ${how}? This creates a real link.\nGo ahead?`;
}

/** send_to_phone. */
export async function sendToPhone(
  input: { sessionIds?: string[] | undefined; show?: ShowChoice | undefined },
  ctx: ToolContext,
): Promise<ToolOutcome<'send_to_phone'>> {
  const { events, passes } = ctx.runtime;
  const ids = input.sessionIds ?? [];
  if (!checkIdentifiers(ids).ok) {
    throw new CompassError('IdentifierRejected');
  }
  const { show } = input;
  if (show === undefined) {
    return { ok: false, message: ASK_SHOW_MESSAGE };
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
  const approved = await humanConfirms(ctx, confirmQuestion(show, chosen.length, shown));
  if (!approved) {
    return {
      ok: false,
      message: 'No link was created, because you did not confirm.',
    };
  }

  const handoff = await passes.handoff(chosen.map((r) => r.serialNumber));
  const wantsLink = show !== 'qr';
  const wantsQr = show !== 'link';
  const inBrowser =
    wantsQr && ctx.runtime.qrPage !== undefined
      ? await ctx.runtime.qrPage.show({ svg: handoff.svg, expiresAt: handoff.expiresAt })
      : false;
  const qrInChat = wantsQr && !inBrowser;

  const lines: string[] = [];
  if (wantsLink) {
    lines.push(`Open this link on your phone before ${handoff.expiresAt}: ${handoff.boardUrl}`);
  }
  if (inBrowser) {
    lines.push(`${QR_IN_BROWSER} before ${handoff.expiresAt}. ${NO_PAGE_HINT}`);
  }
  if (qrInChat) {
    // The plain text QR only, once: it has no escape codes, so it is safe in any client, and the
    // PNG image follows. (The terminal render with colour codes is not sent.)
    lines.push(QR_PAGE_FAILED, handoff.chatText, `It works until ${handoff.expiresAt}.`);
  }
  lines.push(HANDOFF_SHARING_NOTE, PASS_DISCLAIMER, labelUntrusted('catalog', { passes: shown }));

  const png: ImageContent = {
    type: 'image',
    data: Buffer.from(handoff.chatPng).toString('base64'),
    mimeType: 'image/png',
  };
  return {
    ok: true,
    // The capability lives in the link's fragment, so the structured result keeps only the part
    // before it; the full link is in the text only when a link was asked for, and never logged.
    structured: {
      handoffUrl: withoutFragment(handoff.boardUrl),
      expiresAt: handoff.expiresAt,
      shownAs: show,
      ...(wantsQr ? { qrShownIn: inBrowser ? ('browser' as const) : ('chat' as const) } : {}),
    },
    text: lines.join('\n'),
    ...(qrInChat ? { extra: [png] } : {}),
  };
}
