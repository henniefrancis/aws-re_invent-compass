// Silences console output from third-party code (passkit-generator, the AWS SDK,
// google-auth-library) while a request runs, so their messages cannot carry request
// content into the logs. Overlapping requests share one guard through a depth counter.

export type ConsoleLike = Record<
  'log' | 'info' | 'warn' | 'error' | 'debug',
  (...args: unknown[]) => void
>;

const METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;

interface GuardState {
  depth: number;
  saved: ConsoleLike;
}

const states = new WeakMap<ConsoleLike, GuardState>();

function noop(): void {
  // Intentionally silent.
}

function enter(target: ConsoleLike): void {
  const existing = states.get(target);
  if (existing !== undefined) {
    existing.depth += 1;
    return;
  }
  const saved = {} as ConsoleLike;
  for (const method of METHODS) {
    saved[method] = target[method];
    target[method] = noop;
  }
  states.set(target, { depth: 1, saved });
}

function leave(target: ConsoleLike): void {
  const state = states.get(target)!;
  state.depth -= 1;
  if (state.depth === 0) {
    for (const method of METHODS) {
      target[method] = state.saved[method];
    }
    states.delete(target);
  }
}

export async function withConsoleGuard<T>(target: ConsoleLike, run: () => Promise<T>): Promise<T> {
  enter(target);
  try {
    return await run();
  } finally {
    leave(target);
  }
}
