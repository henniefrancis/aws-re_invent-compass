import type { ConsoleLike } from '../../src/observability/console-guard.js';

export interface Capture {
  lines: string[];
  sink: (line: string) => void;
  console: ConsoleLike;
  consoleCalls: string[];
}

/** Captures log lines and anything written to the (guarded) console. */
export function createCapture(): Capture {
  const lines: string[] = [];
  const consoleCalls: string[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      consoleCalls.push(`${name}:${args.map(String).join(' ')}`);
    };
  return {
    lines,
    sink: (line) => lines.push(line),
    consoleCalls,
    console: {
      log: record('log'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
      debug: record('debug'),
    },
  };
}

/** True when no needle appears in any of the texts. */
export function containsNone(texts: readonly string[], needles: readonly string[]): boolean {
  return needles.every((needle) => texts.every((text) => !text.includes(needle)));
}
