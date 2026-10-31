// Pass text normalisation for the sample pass (showcase-site, CTO M9).
//
// This is the same mapping as `normalisePassText` in `@compass/contracts` (S4 uses that one).
// It is written out here because importing the contracts package at run time would put its zod
// schemas into the browser bundle, and the demo only needs this one function. A test proves
// that the two give the same text for any input, so the sample pass cannot drift from the real
// pass rules. Typographic characters are written as character codes, so this file holds no raw
// em dash or en dash.

const EN_DASH = String.fromCharCode(0x2013);
const EM_DASH = String.fromCharCode(0x2014);
const CURLY_SINGLE = [0x2018, 0x2019, 0x2032].map((code) => String.fromCharCode(code));
const CURLY_DOUBLE = [0x201c, 0x201d, 0x2033].map((code) => String.fromCharCode(code));
const ELLIPSIS = String.fromCharCode(0x2026);

/**
 * Map typographic punctuation to ASCII, collapse whitespace and turn a vertical bar into a comma
 * ("Level 1 | Academy 409" becomes "Level 1, Academy 409"). It does not validate.
 */
export function normalisePassText(value: string): string {
  let text = value.split(EN_DASH).join('-').split(EM_DASH).join('-');
  for (const mark of CURLY_SINGLE) {
    text = text.split(mark).join("'");
  }
  for (const mark of CURLY_DOUBLE) {
    text = text.split(mark).join('"');
  }
  return text
    .split(ELLIPSIS)
    .join('...')
    .replace(/\s+/g, ' ')
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(', ');
}
