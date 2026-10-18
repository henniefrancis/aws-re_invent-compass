// Runs one hook from stdin (Requirements 18.4 and 18.5). Reads at most 1 MiB for at most 5
// seconds, never spawns anything, never throws, and returns a decision whose exit code is 0 or 2.
// Any unexpected failure fails open with the note, because the server checks the call again.

import { exitCodeFor } from './exit-policy.js';
import type { HookDecision } from './exit-policy.js';
import { postWriteSync } from './post-write-sync.js';
import { COULD_NOT_CHECK_NOTE, preWriteGuardrail } from './pre-write-guardrail.js';
import type { HookDeps } from './pre-write-guardrail.js';
import { readStdin, STDIN_LIMITS } from './read-stdin.js';
import type { StdinLimits } from './read-stdin.js';

/** The only hook names the CLI accepts. */
export const HOOK_NAMES = ['pre-write-guardrail', 'post-write-sync'] as const;

/** A hook name. */
export type HookName = (typeof HOOK_NAMES)[number];

/** True for one of the two hook names. */
export function isHookName(value: string): value is HookName {
  return (HOOK_NAMES as readonly string[]).includes(value);
}

/** Runs the named hook over stdin. */
export async function runHook(
  name: HookName,
  stdin: AsyncIterable<Uint8Array>,
  deps: HookDeps,
  limits: StdinLimits = STDIN_LIMITS,
): Promise<HookDecision> {
  try {
    const raw = (await readStdin(stdin, limits)) ?? '';
    return name === 'pre-write-guardrail' ? await preWriteGuardrail(raw, deps) : postWriteSync(raw);
  } catch {
    return name === 'pre-write-guardrail'
      ? { exitCode: exitCodeFor('note'), stdout: COULD_NOT_CHECK_NOTE }
      : { exitCode: exitCodeFor('silent') };
  }
}
