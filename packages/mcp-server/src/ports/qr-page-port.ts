// The QR page (compass-power task 48, Requirements P3.3 to P3.5): a page on the attendee's
// computer that shows the hand-off QR code in the browser, because Kiro does not show the PNG a
// tool returns and the text QR wraps in the chat.

/** Shows and removes the QR page. Neither method throws. */
export interface QrPagePort {
  /**
   * Replaces any earlier page with a new one for this QR code and opens it in the browser.
   * Resolves true only when the page was written and the browser reported it opened.
   */
  show(page: { svg: string; expiresAt: string }): Promise<boolean>;
  /** Deletes the current page now, if there is one. */
  clear(): Promise<void>;
}
