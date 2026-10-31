// Runs a clean-up when the process ends (compass-power task 48, security review M2). Node runs
// 'exit' listeners on a normal exit but not when SIGTERM, SIGINT or SIGHUP stop the process, and
// an MCP client usually stops its stdio servers with SIGTERM. So the clean-up also runs on those
// signals, once, and the signal is then raised again so the process still stops as it would have.
// When another part of the program also listens for the signal, it is left to that listener.

/** The signals that stop a process without the 'exit' event. */
export const STOP_SIGNALS = ['SIGTERM', 'SIGINT', 'SIGHUP'] as const;

/** The part of `process` the hooks use. */
export interface ExitProcess {
  readonly pid: number;
  once(event: 'exit' | (typeof STOP_SIGNALS)[number], listener: () => void): unknown;
  listenerCount(event: string): number;
  kill(pid: number, signal: string): unknown;
}

/** Registers fn to run once when the process exits or a stop signal arrives. */
export function onProcessEnd(fn: () => void, proc: ExitProcess = process): void {
  let ran = false;
  const runOnce = (): void => {
    if (!ran) {
      ran = true;
      fn();
    }
  };
  proc.once('exit', runOnce);
  for (const signal of STOP_SIGNALS) {
    proc.once(signal, () => {
      runOnce();
      // The listener is gone now; with no other listener, raising the signal again stops the
      // process the way it would have stopped without this hook.
      if (proc.listenerCount(signal) === 0) {
        proc.kill(proc.pid, signal);
      }
    });
  }
}

/** This process's user id on POSIX, or undefined on Windows (where there is no getuid). */
export function processUid(proc: { getuid?: () => number } = process): number | undefined {
  return proc.getuid?.();
}
