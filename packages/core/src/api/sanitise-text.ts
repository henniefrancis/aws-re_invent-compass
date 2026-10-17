// Text sanitising for strings that came from the Events API (events-client, S1,
// security finding N1).
//
// Session titles, abstracts, rooms, speaker names and personal time entries are shown
// to people (in an editor, an MCP client, a pass). A hostile or broken value must not
// be able to hide text, reorder it visually or break a layout. sanitiseText:
//   - normalises to NFC,
//   - removes C0 and C1 control characters (and DEL); in single-line text a tab,
//     newline or carriage return becomes a space, in multi-line text a newline is
//     kept (carriage returns are dropped),
//   - removes zero-width and bidirectional formatting characters: U+200B to U+200F,
//     U+202A to U+202E, U+2066 to U+2069 and U+FEFF,
//   - truncates to a number of code points (it truncates, it never rejects, so a real
//     session with a very long text still loads).
// The contracts package is not changed: the limits live here, not in a schema.

/** Longest title, room, venue, name and similar single-line value, in code points. */
export const MAX_TITLE_CODE_POINTS = 300;
/** Longest abstract or description, in code points. */
export const MAX_ABSTRACT_CODE_POINTS = 5000;

/** Options for sanitiseText. */
export interface SanitiseOptions {
  /** Keep newlines (abstracts and descriptions). Default false: single line. */
  multiline?: boolean;
  /** Truncate to this many code points. Default MAX_TITLE_CODE_POINTS. */
  maxCodePoints?: number;
}

/** True for a character that is removed outright: invisible or formatting controls. */
function isRemoved(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff
  );
}

/** Sanitise one string. See the file header for the rules. */
export function sanitiseText(value: string, options: SanitiseOptions = {}): string {
  const multiline = options.multiline ?? false;
  const limit = options.maxCodePoints ?? MAX_TITLE_CODE_POINTS;
  const kept: string[] = [];
  for (const char of value.normalize('NFC')) {
    if (kept.length >= limit) {
      break;
    }
    // The first UTF-16 unit decides: no removed character is outside the BMP.
    const code = char.charCodeAt(0);
    if (code === 0x0a && multiline) {
      kept.push(char);
    } else if (code === 0x09 || code === 0x0a || code === 0x0d) {
      // A carriage return in multi-line text is dropped; elsewhere these are spaces.
      if (!(code === 0x0d && multiline)) {
        kept.push(' ');
      }
    } else if (!isRemoved(code)) {
      kept.push(char);
    }
  }
  return kept.join('');
}
