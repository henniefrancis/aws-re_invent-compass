// Board state machine and view model (showcase-site, Component 13).
//
// Every decision of the /board page lives here and in board-controller.ts. The component only
// binds the view model. The state holds no hand-off id: only the bundle and calendar paths of
// a Ready state carry it, because they are the links the attendee follows. Every message is a
// constant. None is built from the id or from a response body.

import { dayHeading, formatWallClock, offsetLabel, timezoneNote } from '../time/time-format';
import type { FragmentResult } from './fragment';
import type { HandoffOutcome } from './handoff-client';
import type { AppleBundle, ValidatedHandoff } from './handoff-view';

export type BoardState =
  | { readonly kind: 'reading' }
  | { readonly kind: 'invalidLink' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly handoff: ValidatedHandoff }
  | { readonly kind: 'expired' }
  | { readonly kind: 'rateLimited' }
  | { readonly kind: 'unavailable' };

export type BoardEvent =
  | { readonly type: 'fragmentRead'; readonly result: FragmentResult }
  | { readonly type: 'requestStarted' }
  | {
      readonly type: 'outcome';
      readonly outcome: HandoffOutcome;
      readonly validated: ValidatedHandoff | null;
      /** The device clock when the answer arrived. */
      readonly nowMs: number;
    }
  | { readonly type: 'clock'; readonly nowMs: number };

export interface BoardAction {
  readonly kind: 'apple' | 'google' | 'calendar';
  readonly href: string;
  readonly label: string;
}

export interface BoardRow {
  readonly code: string;
  readonly title: string;
  readonly time: string;
}

export interface BoardViewModel {
  readonly heading: string;
  readonly message: string;
  readonly busy: boolean;
  readonly canRetry: boolean;
  readonly actions: readonly BoardAction[];
  readonly sessions: readonly BoardRow[];
  readonly expiresText: string | null;
  readonly timezoneNote: string | null;
  readonly deviceHint: string | null;
  readonly announcement: string;
}

/** How long a hand-off lasts, in minutes. */
export const MAX_LINK_MINUTES = 15;

export const INITIAL_BOARD_STATE: BoardState = { kind: 'reading' };

export const MESSAGES = {
  readingHeading: 'Opening your boarding passes',
  readingMessage: 'Reading your link.',
  loadingMessage: 'Loading your passes.',
  invalidHeading: 'This link is not complete',
  invalidMessage: 'This link is not complete. Scan the QR code again on your computer.',
  readyHeading: 'Your boarding passes are ready',
  readyMessage: 'Choose how to add your passes.',
  expiredHeading: 'This link has expired',
  expiredMessage:
    'This link has expired or is not valid. Links last 15 minutes. Create a new one on your computer.',
  rateLimitedHeading: 'Too many tries',
  rateLimitedMessage: 'Too many tries. Wait a minute, then try again.',
  unavailableHeading: 'We could not load your passes',
  unavailableMessage: 'We could not load your passes. Check your connection and try again.',
  deviceHint:
    'Apple Wallet is for iPhone. Google Wallet is for Android. The calendar file works on an iPad or any other device.',
  appleLabel: 'Add to Apple Wallet',
  googleLabel: 'Save to Google Wallet',
  calendarLabel: 'Download calendar',
  retryLabel: 'Try again',
} as const;

const RETRYABLE: ReadonlySet<BoardState['kind']> = new Set(['unavailable', 'rateLimited']);

/** True when the user may choose "Try again" in this state. */
export function canRetry(state: BoardState): boolean {
  return RETRYABLE.has(state.kind);
}

/** Milliseconds from now until the hand-off expires. Negative once it has expired. */
export function msUntilExpiry(handoff: ValidatedHandoff, nowMs: number): number {
  return handoff.expiresAtMs - nowMs;
}

function settle(
  outcome: HandoffOutcome,
  validated: ValidatedHandoff | null,
  nowMs: number,
): BoardState {
  if (outcome.kind === 'ok') {
    if (validated === null) {
      return { kind: 'unavailable' };
    }
    // A link that is already past its expiry when the answer arrives is never shown as Ready.
    return nowMs >= validated.expiresAtMs
      ? { kind: 'expired' }
      : { kind: 'ready', handoff: validated };
  }
  if (outcome.kind === 'status' && outcome.status === 404) {
    return { kind: 'expired' };
  }
  if (outcome.kind === 'status' && outcome.status === 429) {
    return { kind: 'rateLimited' };
  }
  return { kind: 'unavailable' };
}

/** The next state. An event that does not apply to the current state changes nothing. */
export function reduceBoard(state: BoardState, event: BoardEvent): BoardState {
  if (event.type === 'fragmentRead') {
    return state.kind === 'reading' && !event.result.ok ? { kind: 'invalidLink' } : state;
  }
  if (event.type === 'requestStarted') {
    return state.kind === 'reading' || canRetry(state) ? { kind: 'loading' } : state;
  }
  if (event.type === 'outcome') {
    return state.kind === 'loading' ? settle(event.outcome, event.validated, event.nowMs) : state;
  }
  return state.kind === 'ready' && event.nowMs >= state.handoff.expiresAtMs
    ? { kind: 'expired' }
    : state;
}

/** The label of one Apple bundle: plain when there is one, "bundle N of M" when there are more. */
export function bundleLabel(bundle: AppleBundle): string {
  return bundle.of === 1
    ? MESSAGES.appleLabel
    : `${MESSAGES.appleLabel} (bundle ${String(bundle.number)} of ${String(bundle.of)})`;
}

function expiryText(handoff: ValidatedHandoff, nowMs: number): string {
  // A hand-off lasts 15 minutes, so the text never says more, whatever the device clock thinks.
  const minutes = Math.min(
    MAX_LINK_MINUTES,
    Math.max(1, Math.ceil(msUntilExpiry(handoff, nowMs) / 60_000)),
  );
  return minutes === 1
    ? 'This link works for about 1 more minute.'
    : `This link works for about ${String(minutes)} more minutes.`;
}

function actionsOf(handoff: ValidatedHandoff): BoardAction[] {
  const actions: BoardAction[] = handoff.appleBundles.map((bundle) => ({
    kind: 'apple',
    href: bundle.path,
    label: bundleLabel(bundle),
  }));
  if (handoff.googleSaveUrl !== null) {
    actions.push({ kind: 'google', href: handoff.googleSaveUrl, label: MESSAGES.googleLabel });
  }
  if (handoff.calendarPath !== null) {
    actions.push({ kind: 'calendar', href: handoff.calendarPath, label: MESSAGES.calendarLabel });
  }
  return actions;
}

function rowsOf(handoff: ValidatedHandoff, withOffset: boolean): BoardRow[] {
  return handoff.sessions.map((session) => {
    const time = `${dayHeading(session.startsAt.slice(0, 10))}, ${formatWallClock(session.startsAt)}`;
    return {
      code: session.sessionCode,
      title: session.title,
      time: withOffset ? `${time} (${offsetLabel(session.startsAt)})` : time,
    };
  });
}

const PLAIN: Omit<BoardViewModel, 'heading' | 'message' | 'announcement'> = {
  busy: false,
  canRetry: false,
  actions: [],
  sessions: [],
  expiresText: null,
  timezoneNote: null,
  deviceHint: null,
};

function plain(
  heading: string,
  message: string,
  extra: Partial<BoardViewModel> = {},
): BoardViewModel {
  return { ...PLAIN, heading, message, announcement: message, ...extra };
}

/** What the page shows for a state at a given time. Only Ready has links. */
export function toBoardViewModel(state: BoardState, nowMs: number): BoardViewModel {
  if (state.kind === 'ready') {
    const handoff = state.handoff;
    const note = timezoneNote(handoff.sessions.map((s) => s.startsAt));
    return {
      heading: MESSAGES.readyHeading,
      message: MESSAGES.readyMessage,
      busy: false,
      canRetry: false,
      actions: actionsOf(handoff),
      sessions: rowsOf(handoff, note === null),
      expiresText: expiryText(handoff, nowMs),
      timezoneNote: note,
      deviceHint: MESSAGES.deviceHint,
      announcement: `${MESSAGES.readyHeading}. ${String(handoff.sessions.length)} ${
        handoff.sessions.length === 1 ? 'session' : 'sessions'
      }.`,
    };
  }
  if (state.kind === 'reading') {
    return plain(MESSAGES.readingHeading, MESSAGES.readingMessage, { busy: true });
  }
  if (state.kind === 'loading') {
    return plain(MESSAGES.readingHeading, MESSAGES.loadingMessage, { busy: true });
  }
  if (state.kind === 'invalidLink') {
    return plain(MESSAGES.invalidHeading, MESSAGES.invalidMessage);
  }
  if (state.kind === 'expired') {
    return plain(MESSAGES.expiredHeading, MESSAGES.expiredMessage);
  }
  if (state.kind === 'rateLimited') {
    return plain(MESSAGES.rateLimitedHeading, MESSAGES.rateLimitedMessage, { canRetry: true });
  }
  return plain(MESSAGES.unavailableHeading, MESSAGES.unavailableMessage, { canRetry: true });
}
