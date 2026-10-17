// Week and catalog views (showcase-site, Component 7).
//
// Turns the demo state and the rules port's answers into display strings. Every connection
// class, reason, boarding time and layover line is the engine's own text, shown as returned.
// Where the engine says "unknown" the page shows the reason it gives and hides nothing.

import type { Commitment, NormalisedSession } from '@compass/contracts';
import { DEMO_EVENT } from './demo-catalog';
import type { DemoDeps } from './demo-deps';
import type { DemoState } from './demo-state';
import type { BoardingResult, ConnectionResult } from './rules-port';
import { commitmentRef, dayOfIso, toScheduleInput } from './schedule';
import { dayHeading, formatInZone, offsetLabel } from '../time/time-format';

export const VENUE_NOT_PUBLISHED = 'Venue not published';

export interface WeekItemView {
  readonly ref: string;
  readonly kind: 'reservedSession' | 'personalTime';
  readonly code: string | null;
  readonly title: string;
  /** What names the item to a screen reader: the code, or the title with the start time. */
  readonly label: string;
  /** "Venue, Room", or "Venue not published". */
  readonly gate: string;
  /** Event local wall clock, such as "10:00 AM to 11:00 AM". */
  readonly timeRange: string;
  /** "Seat released at 10:20 AM", or the reason the engine gives. */
  readonly boarding: string;
}

export interface ConnectionView {
  readonly classification: ConnectionResult['classification'];
  /** The class in words, the two stops and the engine's reason. */
  readonly text: string;
  /** "Walk plus buffer: 40 minutes.", or "Walk time unknown." */
  readonly walk: string;
}

export interface LayoverView {
  readonly lines: readonly string[];
  readonly suggestions: readonly { start: string; end: string; label: string }[];
}

export interface WeekDayView {
  readonly date: string;
  readonly heading: string;
  readonly items: readonly WeekItemView[];
  readonly connections: readonly ConnectionView[];
  readonly layovers: LayoverView;
}

export interface CatalogItemView {
  readonly sessionId: string;
  readonly code: string;
  readonly title: string;
  readonly type: string | null;
  readonly level: string | null;
  readonly gate: string;
  readonly timeRange: string;
  readonly boarding: string;
  readonly reservable: boolean;
  readonly inWeek: boolean;
}

export interface CatalogDayView {
  readonly date: string;
  readonly heading: string;
  readonly sessions: readonly CatalogItemView[];
}

const zone = DEMO_EVENT.timezone;

/** "Venue, Room", or the venue alone, or "Venue not published". */
export function gateText(venue: string | undefined, room: string | undefined): string {
  if (venue === undefined) {
    return VENUE_NOT_PUBLISHED;
  }
  return room === undefined ? venue : `${venue}, ${room}`;
}

function timeRange(startsAt: string, endsAt: string): string {
  return `${formatInZone(startsAt, zone)} to ${formatInZone(endsAt, zone)}`;
}

/** The boarding line for a session, from the engine's answer. */
export function boardingText(result: BoardingResult): string {
  return result.status === 'closes'
    ? `Seat released at ${formatInZone(result.at, zone)}`
    : result.reason;
}

/** One line stating the event timezone, shown once per view. */
export function timezoneStatement(): string {
  return `All times are in ${zone} (${offsetLabel(DEMO_EVENT.windowStart)}).`;
}

function capitalise(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function walkText(minutes: number | undefined): string {
  return minutes === undefined
    ? 'Walk time unknown.'
    : `Walk plus buffer: ${String(minutes)} minutes.`;
}

function itemView(commitment: Commitment, deps: DemoDeps): WeekItemView {
  if (commitment.kind === 'personalTime') {
    return {
      ref: commitmentRef(commitment),
      kind: 'personalTime',
      code: null,
      title: commitment.title,
      label: `${commitment.title} at ${formatInZone(commitment.startsAt, zone)}`,
      gate: commitment.location ?? VENUE_NOT_PUBLISHED,
      timeRange: timeRange(commitment.startsAt, commitment.endsAt),
      boarding: 'Personal time. No boarding.',
    };
  }
  const session = deps.catalog.get(commitment.sessionId);
  if (session === undefined) {
    return {
      ref: commitmentRef(commitment),
      kind: 'reservedSession',
      code: null,
      title: commitment.title ?? commitment.sessionId,
      label: commitment.title ?? commitment.sessionId,
      gate: gateText(commitment.venue, undefined),
      timeRange: timeRange(commitment.startsAt, commitment.endsAt),
      boarding: 'Boarding time not available.',
    };
  }
  return {
    ref: commitmentRef(commitment),
    kind: 'reservedSession',
    code: session.code,
    title: session.title,
    label: session.code,
    gate: gateText(session.venue, session.room),
    timeRange: timeRange(commitment.startsAt, commitment.endsAt),
    boarding: boardingText(deps.rules.computeBoarding(session, deps.context)),
  };
}

function layoverView(day: string, state: DemoState, deps: DemoDeps): LayoverView {
  const report = deps.rules.checkLayovers(
    toScheduleInput(state.commitments, deps.catalog),
    deps.context,
    day,
  );
  if (report.status !== 'ok') {
    return { lines: [report.reason], suggestions: [] };
  }
  const entry = report.days.find((d) => d.day === day);
  if (entry === undefined) {
    return { lines: [], suggestions: [] };
  }
  return {
    lines: [
      ...entry.reasons,
      ...(entry.noPlacementReason === undefined ? [] : [entry.noPlacementReason]),
    ],
    suggestions: entry.suggestions.map((s) => ({
      start: s.start,
      end: s.end,
      label: `${formatInZone(s.start, zone)} to ${formatInZone(s.end, zone)}: ${s.reason}`,
    })),
  };
}

function connectionViews(day: string, state: DemoState, deps: DemoDeps): readonly ConnectionView[] {
  const report = deps.rules.connectionsForDay(
    toScheduleInput(state.commitments, deps.catalog),
    deps.context,
    day,
  );
  if (report.status !== 'ok') {
    return [{ classification: 'unknown', text: report.reason, walk: walkText(undefined) }];
  }
  return report.connections.map(({ from, to, result }) => ({
    classification: result.classification,
    text: `${capitalise(result.classification)}: ${from} to ${to}. ${result.reason}`,
    walk: walkText(result.walkingMinutes),
  }));
}

/** The Demo_Week grouped by event day, with each day's connections and layover report. */
export function buildWeekView(state: DemoState, deps: DemoDeps): readonly WeekDayView[] {
  const days = [...new Set(state.commitments.map((c) => dayOfIso(c.startsAt)))].sort();
  return days.map((date) => ({
    date,
    heading: dayHeading(date),
    items: state.commitments
      .filter((c) => dayOfIso(c.startsAt) === date)
      .map((c) => itemView(c, deps)),
    connections: connectionViews(date, state, deps),
    layovers: layoverView(date, state, deps),
  }));
}

function catalogItem(session: NormalisedSession, inWeek: boolean, deps: DemoDeps): CatalogItemView {
  return {
    sessionId: session.sessionId,
    code: session.code,
    title: session.title,
    type: session.type ?? null,
    level: session.level ?? null,
    gate: gateText(session.venue, session.room),
    timeRange: timeRange(session.startsAt as string, session.endsAt as string),
    boarding: boardingText(deps.rules.computeBoarding(session, deps.context)),
    reservable: session.isReservable,
    inWeek,
  };
}

/** The Demo_Catalog grouped by event day (Requirement 8.1). */
export function buildCatalogView(state: DemoState, deps: DemoDeps): readonly CatalogDayView[] {
  const held = new Set(
    state.commitments.flatMap((c) => (c.kind === 'reservedSession' ? [c.sessionId] : [])),
  );
  // Every demo session has a start and an end time; a test checks it.
  const sessions = [...deps.catalog.values()];
  const days = [...new Set(sessions.map((s) => dayOfIso(s.startsAt as string)))].sort();
  return days.map((date) => ({
    date,
    heading: dayHeading(date),
    sessions: sessions
      .filter((s) => dayOfIso(s.startsAt as string) === date)
      .map((s) => catalogItem(s, held.has(s.sessionId), deps)),
  }));
}
