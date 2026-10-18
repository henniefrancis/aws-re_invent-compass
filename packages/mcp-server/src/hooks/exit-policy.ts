// The only place that maps a hook decision kind to an exit code (Requirements 18.5 and 24.2). A
// block exits 2 and everything else exits 0, so a hook can never block by accident through an
// error exit. SP1 may change this one table (for example to warn-only if a hook cannot block).

/** What a hook decided. */
export type DecisionKind = 'block' | 'warn' | 'allow' | 'note' | 'reminder' | 'silent';

/** The exit code for a decision kind. Only `block` exits 2. */
export function exitCodeFor(kind: DecisionKind): 0 | 2 {
  return kind === 'block' ? 2 : 0;
}

/** What a hook run tells Kiro. */
export interface HookDecision {
  exitCode: 0 | 2;
  stdout?: string;
  stderr?: string;
}
