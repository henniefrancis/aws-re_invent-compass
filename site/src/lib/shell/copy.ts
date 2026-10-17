// Copy to clipboard (showcase-site, Install_Page).
//
// The page passes the browser clipboard in. The function returns the message for the polite
// live region: "Copied", or the fixed failure text. It never throws.

import { COPIED_MESSAGE, COPY_FAILED_MESSAGE } from '../content/install';

export interface ClipboardLike {
  writeText(text: string): Promise<void>;
}

export async function copyText(
  clipboard: ClipboardLike | undefined,
  text: string,
): Promise<string> {
  try {
    if (clipboard === undefined) {
      return COPY_FAILED_MESSAGE;
    }
    await clipboard.writeText(text);
    return COPIED_MESSAGE;
  } catch {
    return COPY_FAILED_MESSAGE;
  }
}
