// Panels of the Demo_Page (showcase-site, Component 13).
//
// The verdict panel, the rebooking and swap panel and the page notes are decided here, so the
// component only binds them. Reasons are copied exactly as the rules engine returned them.

import { DEMO_SOURCE, GUIDED_CLASH } from './demo-catalog';
import type { DemoDeps } from './demo-deps';
import type { DemoState, SwapStep } from './demo-state';
import type { RebookOption } from './rules-port';

export const DEMO_TEXT = {
  sessionNote:
    'These are real re:Invent 2026 sessions, shown by code, title, time, venue and room only. Your week, seats and reservations here are simulated. Nothing in this demo touches a real schedule.',
  credit: `Session data: ${DEMO_SOURCE.name}, catalog as of ${DEMO_SOURCE.asOf}.`,
  walkNote:
    'Walk times are the rules engine walk plus a buffer. The Leave now alarm in the sample calendar uses the same number.',
  unavailable: 'The demo cannot run in this build.',
  startSample: 'Start with a sample week',
  startOver: 'Start over',
  keepWeek: 'Keep my week',
  addAnyway: 'Add anyway',
  download: 'Download sample calendar',
  emptyWeek: 'Add a session first.',
  noAlternative: 'No alternative found.',
  swapIntro: 'Move the held session to its repeat without risking your seat.',
} as const;

export interface RebookView {
  readonly message: string;
  readonly options: readonly {
    readonly sessionId: string;
    readonly text: string;
    readonly canBook: boolean;
  }[];
}

export interface VerdictView {
  readonly kind: 'warn' | 'block';
  readonly title: string;
  readonly reasons: readonly string[];
  readonly rebook: RebookView | null;
  readonly swapOffer: { readonly text: string } | null;
}

export interface SwapStepView {
  readonly number: 1 | 2 | 3;
  readonly label: string;
  readonly status: 'done' | 'next' | 'waiting';
  readonly buttonLabel: string;
}

export interface SwapView {
  readonly title: string;
  readonly steps: readonly SwapStepView[];
  readonly reasons: readonly string[];
  readonly state: 'inProgress' | 'stopped' | 'done';
  readonly message: string;
  readonly invite: { readonly sessionId: string; readonly text: string } | null;
}

function codeOf(deps: DemoDeps, sessionId: string): string {
  return (deps.catalog.get(sessionId) as { code: string }).code;
}

function rebookView(message: string, options: readonly RebookOption[], deps: DemoDeps): RebookView {
  return {
    message,
    options: options.map((option) => ({
      sessionId: option.sessionId,
      text: `${deps.catalog.get(option.sessionId)?.code ?? option.sessionId}: ${option.reason}`,
      canBook: option.kind === 'repeat',
    })),
  };
}

/** The warning or block shown after a session was tried, or null. */
export function buildVerdictView(state: DemoState, deps: DemoDeps): VerdictView | null {
  const pending = state.pending;
  if (pending === null) {
    return null;
  }
  const code = codeOf(deps, pending.sessionId);
  if (pending.kind === 'warn') {
    return {
      kind: 'warn',
      title: `Warning for ${code}`,
      reasons: pending.reasons,
      rebook: null,
      swapOffer: null,
    };
  }
  return {
    kind: 'block',
    title: `${code} was blocked`,
    reasons: pending.reasons,
    rebook: rebookView(pending.rebook.message, pending.rebook.options, deps),
    swapOffer:
      pending.swapOffer === null
        ? null
        : {
            text: `Safe swap: move ${codeOf(deps, pending.swapOffer.originalSessionId)} to its repeat ${codeOf(deps, pending.swapOffer.repeatSessionId)}. Reserve the repeat first, confirm, then cancel the original.`,
          },
  };
}

const ORDER: readonly SwapStep[] = ['offered', 'repeatReserved', 'confirmed', 'done'];

/** The three-step swap panel, or null when there is no swap. */
export function buildSwapView(state: DemoState, deps: DemoDeps): SwapView | null {
  const swap = state.swap;
  if (swap === null) {
    return null;
  }
  const repeat = codeOf(deps, swap.repeatSessionId);
  const original = codeOf(deps, swap.originalSessionId);
  const reached = swap.step === 'stopped' ? 0 : ORDER.indexOf(swap.step);
  const labels: readonly [string, string, string] = [
    `Reserve ${repeat}, the repeat (simulated)`,
    'Confirm the schedule',
    `Cancel ${original}, the original (simulated)`,
  ];
  const buttons: readonly [string, string, string] = [
    'Reserve the repeat',
    'Confirm the schedule',
    'Cancel the original',
  ];
  const steps = labels.map((label, index): SwapStepView => ({
    number: (index + 1) as 1 | 2 | 3,
    label,
    status:
      index < reached ? 'done' : index === reached && swap.step !== 'stopped' ? 'next' : 'waiting',
    buttonLabel: buttons[index] as string,
  }));
  if (swap.step === 'stopped') {
    return {
      title: 'Safe swap',
      steps,
      reasons: swap.reasons,
      state: 'stopped',
      message: 'This swap cannot be made safely.',
      invite: null,
    };
  }
  if (swap.step === 'done') {
    const blocked = codeOf(deps, swap.blockedSessionId);
    return {
      title: 'Safe swap',
      steps,
      reasons: [],
      state: 'done',
      message: `The swap is done. You can now add ${blocked}.`,
      invite: { sessionId: swap.blockedSessionId, text: `Add ${blocked}` },
    };
  }
  return {
    title: 'Safe swap',
    steps,
    reasons: swap.reasons,
    state: 'inProgress',
    message: DEMO_TEXT.swapIntro,
    invite: null,
  };
}

/** The line that names the session to try after loading the sample week. */
export function guidedHint(deps: DemoDeps): string {
  const session = deps.catalog.get(GUIDED_CLASH.tryAdd);
  return session === undefined
    ? DEMO_TEXT.startSample
    : `Start with a sample week, then try adding ${session.code}: ${session.title}.`;
}
