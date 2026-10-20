// Small XML readers shared by the .NET and Java detectors (compass-power tasks 41.2 and 41.3).
//
// They are linear scanners, not an XML parser: comments are cut out with `indexOf`, and each
// element is read inside a window of at most MAX_TAG characters, so no input can make them slow.
// Anything they cannot read is skipped.

/** The longest tag or element text read. A real one is far shorter; this bounds every scan. */
const MAX_TAG = 500;

const PACKAGE_REFERENCE = '<PackageReference';
const INCLUDE = /\bInclude\s*=\s*(?:"([^"]*)"|'([^']*)')/;

/** The text with every `<!-- ... -->` comment removed (an unclosed one runs to the end). */
export function stripXmlComments(text: string): string {
  const parts: string[] = [];
  let at = 0;
  for (;;) {
    const open = text.indexOf('<!--', at);
    if (open === -1) {
      parts.push(text.slice(at));
      return parts.join('');
    }
    parts.push(text.slice(at, open));
    const close = text.indexOf('-->', open + 4);
    if (close === -1) {
      return parts.join('');
    }
    at = close + 3;
  }
}

/** The `Include` value of every `<PackageReference ...>` outside comments, trimmed and non-empty. */
export function packageReferences(text: string): string[] {
  const code = stripXmlComments(text);
  const names: string[] = [];
  let at = code.indexOf(PACKAGE_REFERENCE);
  while (at !== -1) {
    // The tag ends at its `>`, or at the next `<` when it is not closed.
    const window = code.slice(at, at + MAX_TAG);
    const end = window.slice(1).search(/[<>]/);
    const tag = end === -1 ? window : window.slice(0, end + 1);
    const match = /\s/.test(tag.charAt(PACKAGE_REFERENCE.length)) ? INCLUDE.exec(tag) : null;
    const name = (match?.[1] ?? match?.[2] ?? '').trim();
    if (name !== '') {
      names.push(name);
    }
    at = code.indexOf(PACKAGE_REFERENCE, at + PACKAGE_REFERENCE.length);
  }
  return names;
}

/** The trimmed, non-empty text of every `<tag>...</tag>` element outside comments. */
export function elementTexts(text: string, tag: string): string[] {
  const code = stripXmlComments(text);
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const texts: string[] = [];
  let at = code.indexOf(open);
  while (at !== -1) {
    const start = at + open.length;
    const window = code.slice(start, start + MAX_TAG);
    const end = window.indexOf(close);
    const value = end === -1 ? '' : window.slice(0, end).trim();
    if (value !== '') {
      texts.push(value);
    }
    at = code.indexOf(open, start);
  }
  return texts;
}
