// Waking up (showcase-site, QA M4).
//
// A phone can sleep, or a page can sit in the back-forward cache, past the moment a hand-off
// expires, and then the single expiry timer never fires on time. This helper tells a listener
// whenever the page becomes visible again or is shown from the cache, so the board can check the
// expiry and refresh its text. The browser objects are passed in, so it is unit tested.

export interface VisibilityDocument {
  readonly visibilityState: string;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

export interface PageShowWindow {
  addEventListener(type: 'pageshow', listener: () => void): void;
  removeEventListener(type: 'pageshow', listener: () => void): void;
}

/** Call the listener on every visibilitychange to visible and on every pageshow. Returns the stop function. */
export function watchVisibility(
  doc: VisibilityDocument,
  win: PageShowWindow,
  listener: () => void,
): () => void {
  const onVisibility = (): void => {
    if (doc.visibilityState === 'visible') {
      listener();
    }
  };
  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('pageshow', listener);
  return () => {
    doc.removeEventListener('visibilitychange', onVisibility);
    win.removeEventListener('pageshow', listener);
  };
}
