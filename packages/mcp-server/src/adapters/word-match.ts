// Whole-word matching for find_sessions_by_tech and the planner (compass-power task 44,
// Requirement P2.6). Case-insensitive. Where a search word starts or ends with a letter or digit,
// the text next to it must not be a letter or digit, so "net" does not match "network" and "Go"
// does not match "Google". Where it starts or ends with a mark (".NET", "C#", "C++"), that side is
// not checked, so ".NET" matches "ASP.NET". Linear in the text for each word: indexOf only.

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

function isLetterOrDigit(char: string | undefined): boolean {
  return char !== undefined && LETTER_OR_DIGIT.test(char);
}

/** True when `word` appears in `text` as a whole word. An empty word never matches. */
export function containsWord(text: string, word: string): boolean {
  const haystack = text.toLowerCase();
  const needle = word.trim().toLowerCase();
  if (needle.length === 0) {
    return false;
  }
  const checkBefore = isLetterOrDigit(needle[0]);
  const checkAfter = isLetterOrDigit(needle[needle.length - 1]);
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    const before = at === 0 ? undefined : haystack[at - 1];
    const after = haystack[at + needle.length];
    if ((!checkBefore || !isLetterOrDigit(before)) && (!checkAfter || !isLetterOrDigit(after))) {
      return true;
    }
  }
  return false;
}

/** True when any of `words` appears in any of `texts` (a text, a list of texts, or none) as a whole word. */
export function containsAnyWord(
  texts: readonly (string | readonly string[] | undefined)[],
  words: readonly string[],
): boolean {
  return texts
    .flat()
    .some((text) => text !== undefined && words.some((word) => containsWord(text, word)));
}
