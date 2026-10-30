// Demo state and reducer (showcase-site, Component 7).
//
// The whole demo is one pure reducer over DemoState and user actions. The same actions from the
// same start state always give deeply equal states, and nothing here reads the system clock: the
// context carries the fixed demo instant. Every verdict, reason, rebooking option and swap plan
// comes from the rules port. The reducer only decides what to do with the answer, and it copies
// reasons exactly as the engine returned them.

import type { Commitment, NormalisedSession } from '@compass/contracts';
import { STARTER_WEEK, DEMO_SESSIONS, GUIDED_CLASH, DEMO_EVENT } from './demo-catalog';
import type { DemoDeps } from './demo-deps';
import type { RebookResult, SwapPlan } from './rules-port';
import { commitmentOfSession, commitmentRef, sortCommitments, toScheduleInput } from './schedule';
import { formatInZone } from '../time/time-format';

export type Pending =
  | { readonly kind: 'warn'; readonly sessionId: string; readonly reasons: readonly string[] }
  | {
      readonly kind: 'block';
      readonly sessionId: string;
      readonly reasons: readonly string[];
      readonly rebook: RebookResult;
      readonly swapOffer: {
        readonly originalSessionId: string;
        readonly repeatSessionId: string;
      } | null;
    };

export type SwapStep = 'offered' | 'repeatReserved' | 'confirmed' | 'done' | 'stopped';

export interface SwapProgress {
  readonly originalSessionId: string;
  readonly repeatSessionId: string;
  readonly blockedSessionId: string;
  readonly step: SwapStep;
  readonly plan: SwapPlan | null;
  readonly reasons: readonly string[];
}

export interface DemoState {
  /** Ordered by start time. */
  readonly commitments: readonly Commitment[];
  readonly pending: Pending | null;
  readonly swap: SwapProgress | null;
  readonly selectedPassSessionId: string | null;
  /** The text for the polite live region. */
  readonly announcement: string;
}

export type DemoAction =
  | { readonly type: 'loadStarter' }
  | { readonly type: 'add'; readonly sessionId: string }
  | { readonly type: 'confirmWarn' }
  | { readonly type: 'dismiss' }
  | { readonly type: 'remove'; readonly ref: string }
  | { readonly type: 'bookRepeat'; readonly sessionId: string }
  | { readonly type: 'startSwap' }
  | { readonly type: 'advanceSwap' }
  | { readonly type: 'addLayover'; readonly start: string; readonly end: string }
  | { readonly type: 'selectPass'; readonly sessionId: string }
  | { readonly type: 'reset' };

export const EMPTY_DEMO: DemoState = {
  commitments: [],
  pending: null,
  swap: null,
  selectedPassSessionId: null,
  announcement: '',
};

export const DEMO_MESSAGES = {
  finishSwap: 'Finish or cancel the swap first.',
  swapUnsafe: 'This swap cannot be made safely.',
  unknownSession: 'That session is not in the demo.',
  layoverTitle: 'Layover',
} as const;

const IN_PROGRESS: ReadonlySet<SwapStep> = new Set(['offered', 'repeatReserved', 'confirmed']);
const HELD_DURING_SWAP: ReadonlySet<DemoAction['type']> = new Set([
  'loadStarter',
  'add',
  'confirmWarn',
  'remove',
  'bookRepeat',
  'startSwap',
  'addLayover',
]);

const join = (texts: readonly string[]): string => texts.join(' ');

function codeOf(deps: DemoDeps, sessionId: string): string {
  // Only called with ids of catalog sessions: held sessions and their repeats.
  return (deps.catalog.get(sessionId) as NormalisedSession).code;
}

function heldSession(state: DemoState, sessionId: string): boolean {
  return state.commitments.some((c) => c.kind === 'reservedSession' && c.sessionId === sessionId);
}

function withCommitment(state: DemoState, commitment: Commitment): readonly Commitment[] {
  return sortCommitments([...state.commitments, commitment]);
}

function withoutRef(state: DemoState, ref: string): readonly Commitment[] {
  return state.commitments.filter((c) => commitmentRef(c) !== ref);
}

/**
 * The first catalog repeat of a held session that is not in the week yet, if there is one. A repeat
 * shares the base code of the held session: the real catalog lists DAT302-R and DAT302-R1 as
 * repeats of DAT302, and the held session may be either of them.
 */
function repeatOf(held: NormalisedSession, state: DemoState): NormalisedSession | undefined {
  const base = held.repeatOf ?? held.code;
  return DEMO_SESSIONS.find(
    (s) =>
      s.repeatOf === base && s.sessionId !== held.sessionId && !heldSession(state, s.sessionId),
  );
}

/** The held session that clashes with the candidate, if the engine reports a clash with it. */
function clashPartner(
  candidate: NormalisedSession,
  state: DemoState,
  deps: DemoDeps,
): NormalisedSession | undefined {
  const withCandidate = [...state.commitments, commitmentOfSession(candidate)];
  const report = deps.rules.findClashes(toScheduleInput(withCandidate, deps.catalog), deps.context);
  if (report.status !== 'ok') {
    return undefined;
  }
  const last = withCandidate.length - 1;
  const pair = report.clashes.find((p) => p.aIndex === last || p.bIndex === last);
  const partner =
    pair === undefined
      ? undefined
      : withCandidate[pair.aIndex === last ? pair.bIndex : pair.aIndex];
  return partner?.kind === 'reservedSession' ? deps.catalog.get(partner.sessionId) : undefined;
}

function addSession(state: DemoState, sessionId: string, deps: DemoDeps): DemoState {
  const session = deps.catalog.get(sessionId);
  if (session === undefined) {
    return { ...state, announcement: DEMO_MESSAGES.unknownSession };
  }
  if (heldSession(state, sessionId)) {
    return { ...state, announcement: `${session.code} is already in your week.` };
  }
  const verdict = deps.rules.checkReservation(
    session,
    toScheduleInput(state.commitments, deps.catalog),
    deps.context,
  );
  if (verdict.decision === 'allow') {
    return {
      ...state,
      commitments: withCommitment(state, commitmentOfSession(session)),
      pending: null,
      announcement: join([`Allowed: ${session.code} was added to your week.`, ...verdict.reasons]),
    };
  }
  if (verdict.decision === 'warn') {
    return {
      ...state,
      pending: { kind: 'warn', sessionId, reasons: verdict.reasons },
      announcement: join([
        `Warning for ${session.code}.`,
        ...verdict.reasons,
        'Choose Add anyway or Keep my week.',
      ]),
    };
  }
  const rebook = deps.rules.findRebookingOptions(
    session.repeatOf ?? session.code,
    DEMO_SESSIONS,
    [],
    deps.context,
  );
  const partner = clashPartner(session, state, deps);
  const repeat = partner === undefined ? undefined : repeatOf(partner, state);
  return {
    ...state,
    pending: {
      kind: 'block',
      sessionId,
      reasons: verdict.reasons,
      rebook,
      swapOffer:
        partner === undefined || repeat === undefined
          ? null
          : { originalSessionId: partner.sessionId, repeatSessionId: repeat.sessionId },
    },
    announcement: join([
      `Blocked: ${session.code} was not added.`,
      ...verdict.reasons,
      rebook.message,
    ]),
  };
}

/** Add the session of a warning the user chose to accept. The warning is not asked again. */
function confirmWarn(state: DemoState, deps: DemoDeps): DemoState {
  const pending = state.pending;
  const session = pending?.kind === 'warn' ? deps.catalog.get(pending.sessionId) : undefined;
  if (session === undefined) {
    return state;
  }
  return {
    ...state,
    commitments: withCommitment(state, commitmentOfSession(session)),
    pending: null,
    announcement: `Added anyway: ${session.code} is in your week.`,
  };
}

function startSwap(state: DemoState, deps: DemoDeps): DemoState {
  const pending = state.pending;
  const repeat =
    pending?.kind === 'block' && pending.swapOffer !== null
      ? deps.catalog.get(pending.swapOffer.repeatSessionId)
      : undefined;
  if (pending?.kind !== 'block' || pending.swapOffer === null || repeat === undefined) {
    return state;
  }
  const verdict = deps.rules.checkReservation(
    repeat,
    toScheduleInput(state.commitments, deps.catalog),
    deps.context,
  );
  const base = {
    originalSessionId: pending.swapOffer.originalSessionId,
    repeatSessionId: repeat.sessionId,
    blockedSessionId: pending.sessionId,
    plan: null,
  };
  if (verdict.decision === 'block') {
    return {
      ...state,
      pending: null,
      swap: { ...base, step: 'stopped', reasons: verdict.reasons },
      announcement: join([DEMO_MESSAGES.swapUnsafe, ...verdict.reasons]),
    };
  }
  return {
    ...state,
    pending: null,
    swap: { ...base, step: 'offered', reasons: verdict.reasons },
    announcement: join([
      `Swap started. Step 1 of 3: reserve ${repeat.code}, the repeat (simulated).`,
      ...verdict.reasons,
    ]),
  };
}

function stopSwap(state: DemoState, swap: SwapProgress, plan: SwapPlan, deps: DemoDeps): DemoState {
  return {
    ...state,
    commitments: withoutRef(state, swap.repeatSessionId),
    swap: { ...swap, step: 'stopped', plan, reasons: [plan.reason] },
    announcement: join([
      DEMO_MESSAGES.swapUnsafe,
      plan.reason,
      `${codeOf(deps, swap.originalSessionId)} stays in your week.`,
    ]),
  };
}

function advanceSwap(state: DemoState, deps: DemoDeps): DemoState {
  const swap = state.swap;
  const repeat = swap === null ? undefined : deps.catalog.get(swap.repeatSessionId);
  const original =
    swap === null
      ? undefined
      : state.commitments.find(
          (c) => c.kind === 'reservedSession' && c.sessionId === swap.originalSessionId,
        );
  if (swap === null || repeat === undefined) {
    return state;
  }
  if (swap.step === 'offered') {
    return {
      ...state,
      commitments: withCommitment(state, commitmentOfSession(repeat)),
      swap: { ...swap, step: 'repeatReserved' },
      announcement: `Step 1 of 3 done: ${repeat.code} is reserved (simulated). Next, confirm the schedule.`,
    };
  }
  if (swap.step === 'repeatReserved' && original !== undefined) {
    const plan = deps.rules.planSafeSwap(
      original,
      repeat,
      toScheduleInput(state.commitments, deps.catalog),
      deps.context,
    );
    if (plan.outcome !== 'safe') {
      return stopSwap(state, swap, plan, deps);
    }
    return {
      ...state,
      swap: { ...swap, step: 'confirmed', plan, reasons: [plan.reason] },
      announcement: join([
        'Step 2 of 3 done: the schedule shows the repeat held.',
        plan.reason,
        `Next, cancel ${codeOf(deps, swap.originalSessionId)} (simulated).`,
      ]),
    };
  }
  if (swap.step === 'confirmed') {
    return {
      ...state,
      commitments: withoutRef(state, swap.originalSessionId),
      swap: { ...swap, step: 'done' },
      announcement: `Step 3 of 3 done: ${codeOf(deps, swap.originalSessionId)} is cancelled (simulated). You can now add ${codeOf(deps, swap.blockedSessionId)}.`,
    };
  }
  return state;
}

/** Leave a swap that is in progress: take the repeat back out if it was reserved. */
function cancelSwap(state: DemoState, swap: SwapProgress): DemoState {
  const reserved = swap.step === 'repeatReserved' || swap.step === 'confirmed';
  return {
    ...state,
    commitments: reserved ? withoutRef(state, swap.repeatSessionId) : state.commitments,
    swap: null,
    announcement: 'Swap cancelled. Your week is as it was.',
  };
}

function dismiss(state: DemoState): DemoState {
  if (state.swap !== null && IN_PROGRESS.has(state.swap.step)) {
    return cancelSwap(state, state.swap);
  }
  return { ...state, pending: null, swap: null, announcement: 'Your week is unchanged.' };
}

function loadStarter(deps: DemoDeps): DemoState {
  const sessions = STARTER_WEEK.flatMap((id) => deps.catalog.get(id) ?? []);
  const tryAdd = deps.catalog.get(GUIDED_CLASH.tryAdd);
  return {
    ...EMPTY_DEMO,
    commitments: sortCommitments(sessions.map(commitmentOfSession)),
    announcement: `Sample week loaded: ${String(sessions.length)} sessions. Try adding ${tryAdd?.code ?? GUIDED_CLASH.tryAdd} to see the guardrail at work.`,
  };
}

function removeRef(state: DemoState, ref: string): DemoState {
  const found = state.commitments.find((c) => commitmentRef(c) === ref);
  if (found === undefined) {
    return state;
  }
  return {
    ...state,
    commitments: withoutRef(state, ref),
    // A question about the old week no longer applies.
    pending: null,
    selectedPassSessionId: state.selectedPassSessionId === ref ? null : state.selectedPassSessionId,
    announcement: `Removed ${found.kind === 'reservedSession' ? (found.title ?? found.sessionId) : found.title} from your week.`,
  };
}

function addLayover(state: DemoState, start: string, end: string): DemoState {
  const layover: Commitment = {
    kind: 'personalTime',
    title: DEMO_MESSAGES.layoverTitle,
    startsAt: start,
    endsAt: end,
    personalTimeId: `layover-${start}`,
  };
  if (state.commitments.some((c) => commitmentRef(c) === commitmentRef(layover))) {
    return state;
  }
  return {
    ...state,
    commitments: withCommitment(state, layover),
    pending: null,
    announcement: `Added a layover from ${formatInZone(start, DEMO_EVENT.timezone)} to ${formatInZone(end, DEMO_EVENT.timezone)}.`,
  };
}

function apply(
  state: DemoState,
  action: Exclude<DemoAction, { type: 'reset' }>,
  deps: DemoDeps,
): DemoState {
  switch (action.type) {
    case 'loadStarter':
      return loadStarter(deps);
    case 'add':
    case 'bookRepeat':
      return addSession(state, action.sessionId, deps);
    case 'confirmWarn':
      return confirmWarn(state, deps);
    case 'dismiss':
      return dismiss(state);
    case 'remove':
      return removeRef(state, action.ref);
    case 'startSwap':
      return startSwap(state, deps);
    case 'advanceSwap':
      return advanceSwap(state, deps);
    case 'addLayover':
      return addLayover(state, action.start, action.end);
    case 'selectPass':
      return heldSession(state, action.sessionId)
        ? { ...state, selectedPassSessionId: action.sessionId }
        : state;
  }
}

/** The next demo state. The same action from the same state always gives the same result. */
export function reduceDemo(state: DemoState, action: DemoAction, deps: DemoDeps): DemoState {
  if (action.type === 'reset') {
    return EMPTY_DEMO;
  }
  const swap = state.swap;
  if (swap !== null && IN_PROGRESS.has(swap.step) && HELD_DURING_SWAP.has(action.type)) {
    return { ...state, announcement: DEMO_MESSAGES.finishSwap };
  }
  const finished = swap !== null && !IN_PROGRESS.has(swap.step) && action.type !== 'selectPass';
  return apply(finished ? { ...state, swap: null } : state, action, deps);
}
