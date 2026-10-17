// Handoff_Builder for the pass side (boarding-passes, S4, Requirement 5).
//
// Creates a hand-off through the Compass_Client and renders the returned Board_URL as a QR
// code three ways: for the terminal (Unicode half blocks, black on white by ANSI colour so
// it scans in any terminal theme), as plain text for chat (Unicode full blocks, two columns
// per module) and as a PNG for chat. All three come from the same QR symbol of the same
// string, so they encode the same data.
//
// The Board_URL carries the hand-off id in its URL fragment, so it is a secret: it is encoded
// exactly as the server returned it and is never written to a log line or an error. Before
// anything is encoded the URL is checked to be https, free of credentials, and to carry the
// hand-off id in its fragment.
import QRCode, { type BitMatrix } from 'qrcode';
import type { CompassClient } from './compass-client.js';
import type { IncludeFlags } from './models.js';
import { passError } from './redaction.js';

/** Quiet zone around the symbol, in modules, as the QR specification asks. */
export const QUIET_ZONE = 4;
/** Pixels per module in the PNG. */
export const PNG_SCALE = 6;

/** The error correction level used by every render. */
const ERROR_CORRECTION = 'M';
/** ANSI select-graphic-rendition: black foreground on a white background, and its reset. */
const ESC = String.fromCharCode(0x1b);
const ANSI_BLACK_ON_WHITE = `${ESC}[30;47m`;
const ANSI_RESET = `${ESC}[0m`;
/** The block characters. */
const FULL_BLOCK = '\u{2588}';
const UPPER_HALF = '\u{2580}';
const LOWER_HALF = '\u{2584}';

/** The three renders of one Board_URL. */
export interface HandoffRenders {
  /** Terminal QR: Unicode block characters wrapped in ANSI colour. */
  terminalQr: string;
  /** Chat QR as text: Unicode full blocks, no escape codes. */
  chatText: string;
  /** Chat QR as a PNG image. */
  chatPng: Uint8Array;
}

/** The Handoff_Builder. */
export interface HandoffBuilder {
  handoff(serialNumbers: string[], include: IncludeFlags): Promise<HandoffRenders>;
}

/** What the builder needs from the client. */
export interface HandoffBuilderDeps {
  client: Pick<CompassClient, 'createHandoff'>;
}

/** The board URL must be https, carry no credentials and hold the hand-off id in its fragment. */
function checkBoardUrl(boardUrl: string, handoffId: string): void {
  let parsed: URL;
  try {
    parsed = new URL(boardUrl);
  } catch {
    throw invalidBoardUrl();
  }
  const fragment = parsed.hash.slice(1);
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    handoffId === '' ||
    !fragment.includes(handoffId)
  ) {
    throw invalidBoardUrl();
  }
}

function invalidBoardUrl(): Error {
  return passError(
    'handoff.invalid_board_url',
    'The hand-off link from the server is not a secure link that carries the hand-off id.',
  );
}

/** True when the module at (row, col) is dark. Anything outside the symbol is the light quiet zone. */
function dark(modules: BitMatrix, row: number, col: number): boolean {
  const inside = row >= 0 && col >= 0 && row < modules.size && col < modules.size;
  return inside && modules.get(row, col) === 1;
}

/** Render the symbol for the terminal with Unicode half blocks, two module rows per line. */
export function renderTerminalQr(modules: BitMatrix): string {
  const lines: string[] = [];
  const end = modules.size + QUIET_ZONE;
  for (let row = -QUIET_ZONE; row < end; row += 2) {
    let line = '';
    for (let col = -QUIET_ZONE; col < end; col += 1) {
      const top = dark(modules, row, col);
      const bottom = dark(modules, row + 1, col);
      line += top ? (bottom ? FULL_BLOCK : UPPER_HALF) : bottom ? LOWER_HALF : ' ';
    }
    lines.push(`${ANSI_BLACK_ON_WHITE}${line}${ANSI_RESET}`);
  }
  return lines.join('\n');
}

/** Render the symbol as chat text: a full block pair per dark module, two spaces per light one. */
export function renderChatText(modules: BitMatrix): string {
  const lines: string[] = [];
  const end = modules.size + QUIET_ZONE;
  for (let row = -QUIET_ZONE; row < end; row += 1) {
    let line = '';
    for (let col = -QUIET_ZONE; col < end; col += 1) {
      line += dark(modules, row, col) ? FULL_BLOCK + FULL_BLOCK : '  ';
    }
    lines.push(line);
  }
  return lines.join('\n');
}

/** Build the Handoff_Builder over the client. */
export function createHandoffBuilder(deps: HandoffBuilderDeps): HandoffBuilder {
  return {
    async handoff(serialNumbers, include) {
      const created = await deps.client.createHandoff({ serialNumbers, include });
      checkBoardUrl(created.boardUrl, created.handoffId);
      try {
        const symbol = QRCode.create(created.boardUrl, { errorCorrectionLevel: ERROR_CORRECTION });
        const png = await QRCode.toBuffer(created.boardUrl, {
          errorCorrectionLevel: ERROR_CORRECTION,
          margin: QUIET_ZONE,
          scale: PNG_SCALE,
          type: 'png',
        });
        return {
          terminalQr: renderTerminalQr(symbol.modules),
          chatText: renderChatText(symbol.modules),
          chatPng: new Uint8Array(png),
        };
      } catch {
        throw passError(
          'handoff.qr_failed',
          'The hand-off link could not be turned into a QR code.',
        );
      }
    },
  };
}
