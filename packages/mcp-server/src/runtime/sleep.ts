// The real sleep, used for the single Retry-After wait of the Events and pass clients.

/** Resolves after `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Resolves after `ms` milliseconds, or at once when `signal` aborts (the GitHub sign-in poll). */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve();
      return;
    }
    // unref: a waiting GitHub sign-in never keeps the server process alive (security review L3).
    const timer = setTimeout(done, ms);
    timer.unref();
    function done(): void {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done);
  });
}
