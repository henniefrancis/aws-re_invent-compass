// Display text safety for the local artifacts (boarding-passes, S4): the calendar and the
// itinerary page both show text that came from the catalog or the attendee.
//
// cleanDisplayText makes such text safe to put in an iCalendar TEXT value or an HTML page:
//  - control characters (C0, DEL and C1) become spaces, so a title can never break a line;
//  - the line and paragraph separators (U+2028, U+2029) become spaces;
//  - format characters (zero-width characters, the bidirectional marks, overrides and isolates,
//    the byte order mark) are removed, so text cannot be visually reordered or hide content;
//  - the result is trimmed.
// An empty result is the caller's cue to use a fallback.

/** Make text safe for the calendar and the page, as described above. */
export function cleanDisplayText(text: string): string {
  return text
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\p{Cf}/gu, '')
    .trim();
}
