// A test double for the rules engine (showcase-site, execution rule 8).
//
// The real engine, `@compass/core/rules` (S2), is not merged into this branch yet. This double
// follows the same shapes as the S2 design and gives plain, deterministic answers, so the demo
// reducer, the week view, the sample pass and the calendar can be tested. It is NOT rules code
// for the site: it lives in test/ only, its answers are simple on purpose, and the demo tests
// check that the demo reproduces whatever the port returns.
//
// `createFakeEngine(overrides)` returns an engine; a test replaces any function to script an
// answer. `createRecordingEngine` wraps an engine and records every call.

import type { Commitment, NormalisedSession, Verdict } from '@compass/contracts';
import type {
  BoardingResult,
  ClashReport,
  ConnectionResult,
  Context,
  ContextInput,
  DayConnection,
  DayConnections,
  DayLayover,
  LayoverReport,
  RebookResult,
  RulesEngine,
  ScheduleInput,
  SwapPlan,
} from '../../src/lib/demo/rules-port';

const MINUTE = 60_000;
const WALK_BETWEEN_VENUES = 30;
const BUFFER = 10;
const TIGHT_MARGIN = 5;
const MEAL_START = 11 * 60 + 30;
const MEAL_END = 14 * 60;
const MEAL_NEED = 30;

interface Slot {
  readonly index: number;
  readonly commitment: Commitment;
  readonly ref: string;
  readonly venue: string | undefined;
  readonly reservable: boolean;
  readonly start: number;
  readonly end: number;
  readonly startsAt: string;
}

function slotOf(commitment: Commitment, index: number, schedule: ScheduleInput): Slot {
  if (commitment.kind === 'personalTime') {
    return {
      index,
      commitment,
      ref: commitment.title,
      venue: commitment.location,
      reservable: false,
      start: Date.parse(commitment.startsAt),
      end: Date.parse(commitment.endsAt),
      startsAt: commitment.startsAt,
    };
  }
  const session = schedule.sessions[commitment.sessionId];
  return {
    index,
    commitment,
    ref: session?.code ?? commitment.sessionId,
    venue: session?.venue ?? commitment.venue,
    reservable: session?.isReservable ?? true,
    start: Date.parse(session?.startsAt ?? commitment.startsAt),
    end: Date.parse(session?.endsAt ?? commitment.endsAt),
    startsAt: session?.startsAt ?? commitment.startsAt,
  };
}

function slotsOf(schedule: ScheduleInput): Slot[] {
  return schedule.commitments.map((c, i) => slotOf(c, i, schedule));
}

function sessionSlot(session: NormalisedSession, index: number): Slot {
  return {
    index,
    commitment: {
      kind: 'reservedSession',
      sessionId: session.sessionId,
      startsAt: session.startsAt ?? '',
      endsAt: session.endsAt ?? '',
    },
    ref: session.code,
    venue: session.venue,
    reservable: session.isReservable,
    start: Date.parse(session.startsAt ?? ''),
    end: Date.parse(session.endsAt ?? ''),
    startsAt: session.startsAt ?? '',
  };
}

const overlaps = (a: Slot, b: Slot): boolean => a.start < b.end && b.start < a.end;
const dayOf = (iso: string): string => iso.slice(0, 10);

/** The wall clock minutes of an ISO string, from its own local part. */
const minutesOfDay = (iso: string): number =>
  Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));

/** An ISO string shifted by whole minutes, keeping its own offset. */
function shifted(iso: string, minutes: number): string {
  const offset = iso.slice(19);
  const local = Date.parse(`${iso.slice(0, 19)}Z`) + minutes * MINUTE;
  return `${new Date(local).toISOString().slice(0, 19)}${offset}`;
}

function walkMinutes(from: Slot, to: Slot): number {
  return (
    (from.venue !== undefined && to.venue !== undefined && from.venue !== to.venue
      ? WALK_BETWEEN_VENUES
      : 0) + BUFFER
  );
}

function connectionBetween(from: Slot, to: Slot): ConnectionResult {
  if (from.venue === undefined || to.venue === undefined) {
    return {
      classification: 'unknown',
      reason: `The venue of ${from.venue === undefined ? from.ref : to.ref} is not published, so the walk is unknown.`,
    };
  }
  const due = to.reservable ? to.start - 10 * MINUTE : to.start;
  const walk = walkMinutes(from, to);
  const spare = Math.round((due - from.end) / MINUTE) - walk;
  const classification = spare < 0 ? 'impossible' : spare < TIGHT_MARGIN ? 'tight' : 'comfortable';
  return {
    classification,
    walkingMinutes: walk,
    spareMinutes: spare,
    reason: `Walk from ${from.venue} to ${to.venue} is about ${String(walk)} minutes (estimate), with ${String(spare)} spare.`,
  };
}

function checkReservation(candidate: NormalisedSession, schedule: ScheduleInput): Verdict {
  const held = slotsOf(schedule).filter((s) => s.commitment.kind === 'reservedSession');
  const me = sessionSlot(candidate, held.length);
  const others = held.filter(
    (s) =>
      s.commitment.kind === 'reservedSession' && s.commitment.sessionId !== candidate.sessionId,
  );
  const clash = others.find((s) => overlaps(me, s));
  if (clash !== undefined) {
    return { decision: 'block', reasons: [`${me.ref} overlaps ${clash.ref}.`] };
  }
  const neighbours = others
    .filter((s) => dayOf(s.startsAt) === dayOf(me.startsAt))
    .flatMap((s): string[] => {
      const [from, to] = s.end <= me.start ? [s, me] : [me, s];
      const result = connectionBetween(from, to);
      return result.classification === 'tight' || result.classification === 'impossible'
        ? [`The walk from ${from.ref} to ${to.ref} is ${result.classification}.`]
        : [];
    });
  return neighbours.length > 0
    ? { decision: 'warn', reasons: neighbours }
    : { decision: 'allow', reasons: [] };
}

function computeBoarding(session: NormalisedSession): BoardingResult {
  if (!session.isReservable) {
    return { status: 'notApplicable', reason: `${session.code} needs no reservation.` };
  }
  if (session.startsAt === undefined) {
    return { status: 'unknown', reason: `${session.code} has no start time.` };
  }
  return {
    status: 'closes',
    at: shifted(session.startsAt, -10),
    reason: `Boarding closes 10 minutes before ${session.code} starts.`,
  };
}

const unknownZone = (context: Context): string | null =>
  typeof context['eventTimezone'] === 'string' ? null : 'The event timezone is not set.';

function connectionsForDay(
  schedule: ScheduleInput,
  context: Context,
  day?: string,
): DayConnections {
  const problem = unknownZone(context);
  if (problem !== null) {
    return { status: 'unknown', reason: problem };
  }
  const slots = slotsOf(schedule)
    .filter((s) => day === undefined || dayOf(s.startsAt) === day)
    .sort((a, b) => a.start - b.start);
  const connections: DayConnection[] = [];
  for (let i = 1; i < slots.length; i += 1) {
    const from = slots[i - 1] as Slot;
    const to = slots[i] as Slot;
    connections.push({ from: from.ref, to: to.ref, result: connectionBetween(from, to) });
  }
  return { status: 'ok', connections, skipped: [] };
}

function findClashes(schedule: ScheduleInput, context: Context): ClashReport {
  const problem = unknownZone(context);
  if (problem !== null) {
    return { status: 'unknown', reason: problem };
  }
  const slots = slotsOf(schedule);
  const clashes: Extract<ClashReport, { status: 'ok' }>['clashes'][number][] = [];
  for (let i = 0; i < slots.length; i += 1) {
    for (let j = i + 1; j < slots.length; j += 1) {
      const a = slots[i] as Slot;
      const b = slots[j] as Slot;
      if (overlaps(a, b)) {
        clashes.push({
          a: a.ref,
          b: b.ref,
          overlap: `${a.ref} and ${b.ref} run at the same time.`,
          reason: `${a.ref} overlaps ${b.ref}.`,
          aIndex: i,
          bIndex: j,
        });
      }
    }
  }
  return { status: 'ok', clashes, unknown: [] };
}

function checkLayovers(schedule: ScheduleInput, context: Context, onlyDay?: string): LayoverReport {
  const problem = unknownZone(context);
  if (problem !== null) {
    return { status: 'unknown', reason: problem };
  }
  const slots = slotsOf(schedule);
  const days = [...new Set(slots.map((s) => dayOf(s.startsAt)))]
    .filter((d) => onlyDay === undefined || d === onlyDay)
    .sort();
  const report: DayLayover[] = days.map((day) => {
    const mine = slots.filter((s) => dayOf(s.startsAt) === day);
    let free = 0;
    for (let minute = MEAL_START; minute < MEAL_END; minute += 1) {
      const busy = mine.some(
        (s) =>
          minutesOfDay(s.startsAt) <= minute &&
          minute < minutesOfDay(s.startsAt) + (s.end - s.start) / MINUTE,
      );
      free += busy ? 0 : 1;
    }
    const missing = free < MEAL_NEED;
    return {
      day,
      mealLayoverMissing: missing,
      freeMealMinutes: free,
      reasons: missing ? [`Only ${String(free)} free minutes in the meal window on ${day}.`] : [],
      suggestions: missing
        ? [
            {
              start: `${day}T14:00:00-08:00`,
              end: `${day}T14:30:00-08:00`,
              reason: 'A free gap just after the meal window.',
            },
          ]
        : [],
    };
  });
  return { status: 'ok', days: report, skipped: [] };
}

function findRebookingOptions(
  baseCode: string,
  candidates: readonly NormalisedSession[],
  _favorites: readonly NormalisedSession[],
  context: Context,
): RebookResult {
  const now = Date.parse(String(context['now']));
  const options = candidates
    .filter((s) => s.repeatOf === baseCode && Date.parse(s.startsAt ?? '') > now)
    .map((s) => ({
      kind: 'repeat' as const,
      sessionId: s.sessionId,
      startsAt: s.startsAt ?? '',
      reason: `${s.code} repeats ${baseCode}.`,
    }));
  return {
    status: 'ok',
    options,
    message:
      options.length > 0
        ? `Found ${String(options.length)} repeat.`
        : `No alternative found for ${baseCode}.`,
  };
}

function planSafeSwap(
  original: Commitment,
  repeat: NormalisedSession,
  confirmation: ScheduleInput,
  context: Context,
): SwapPlan {
  const started = Date.parse(repeat.startsAt ?? '') <= Date.parse(String(context['now']));
  const slots = slotsOf(confirmation);
  const steps: SwapPlan['steps'] = [
    {
      order: 1,
      action: 'reserveRepeat',
      blockedUntilConfirmed: false,
      reason: 'Reserve the repeat first.',
    },
    {
      order: 2,
      action: 'confirmHeld',
      blockedUntilConfirmed: false,
      reason: 'Confirm the repeat is held.',
    },
    {
      order: 3,
      action: 'cancelOriginal',
      blockedUntilConfirmed: true,
      reason: 'Cancel the original last.',
    },
  ];
  if (started) {
    return {
      outcome: 'failed',
      steps,
      clashesWith: [],
      reason: `${repeat.code} has already started.`,
    };
  }
  const held = slots.find(
    (s) => s.commitment.kind === 'reservedSession' && s.commitment.sessionId === repeat.sessionId,
  );
  if (held === undefined) {
    return {
      outcome: 'failed',
      steps,
      clashesWith: [],
      reason: `The schedule does not show ${repeat.code} as held.`,
    };
  }
  const originalId = original.kind === 'reservedSession' ? original.sessionId : '';
  const clashing = slots.filter(
    (s) =>
      s !== held &&
      !(s.commitment.kind === 'reservedSession' && s.commitment.sessionId === originalId) &&
      overlaps(held, s),
  );
  return clashing.length > 0
    ? {
        outcome: 'unsafe',
        steps,
        clashesWith: clashing.map((s) => s.ref),
        reason: `${repeat.code} overlaps another commitment.`,
      }
    : {
        outcome: 'safe',
        steps,
        clashesWith: [],
        reason: `${repeat.code} is held and clashes with nothing.`,
      };
}

function withContextDefaults(input: ContextInput): Context {
  return { ...input, defaults: 'fake' };
}

/** A working engine with simple answers. Pass overrides to script any function. */
export function createFakeEngine(overrides: Partial<RulesEngine> = {}): RulesEngine {
  return {
    checkReservation,
    computeBoarding,
    connectionsForDay,
    findClashes,
    checkLayovers,
    findRebookingOptions,
    planSafeSwap,
    withContextDefaults,
    ...overrides,
  };
}

/** The engine wrapped so that every call is recorded as [function name, arguments]. */
export function createRecordingEngine(engine: RulesEngine): {
  engine: RulesEngine;
  calls: [string, unknown[]][];
} {
  const calls: [string, unknown[]][] = [];
  const wrapped = Object.fromEntries(
    (Object.keys(engine) as (keyof RulesEngine)[]).map((name) => [
      name,
      (...args: unknown[]) => {
        calls.push([name, args]);
        return (engine[name] as (...a: unknown[]) => unknown)(...args);
      },
    ]),
  ) as unknown as RulesEngine;
  return { engine: wrapped, calls };
}
