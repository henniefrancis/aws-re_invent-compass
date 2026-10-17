// The RulesPort adapter over the real S2 rules (`@compass/core/rules`). It builds the rules
// Context for every call (now from the injected clock, the timezone from the event window, venue
// data from data/venues.json parsed by the caller) and maps S2's reports onto the plain
// records the tools use. Nothing here reads the clock or the network.
//
// Fail closed: a throw from any rule, or an unusable report, never becomes an allow.
// checkReservation never throws by design, and a throw is turned into a block here anyway.

import type { Commitment, NormalisedSession, Verdict } from '@compass/contracts';
import {
  checkLayovers,
  checkReservation,
  classifyConnection,
  boardingFor,
  connectionsForDay,
  energyForDay,
  findClashes,
  findRebookingOptions,
  planSafeSwap,
  resolveCommitment,
  withContextDefaults,
} from '@compass/core/rules';
import type { Context, ScheduleInput, VenueData } from '@compass/core/rules';
import { eventDay } from '@compass/core/spec';
import type { Clock } from '../ports/clock.js';
import type { CatalogView, EventWindow } from '../ports/events-port.js';
import type {
  ClashSummary,
  ConnectionLine,
  EnergyLine,
  LayoverSummary,
  RebookOption,
  RulesPort,
  SwapPlan,
} from '../ports/rules-port.js';

/** What the adapter needs. */
export interface RulesAdapterDeps {
  clock: Clock;
  venueData: VenueData;
  eventWindow(): Promise<EventWindow>;
}

const FAIL_CLOSED: Verdict = {
  decision: 'block',
  reasons: ['Compass could not check this booking, so it is blocked.'],
};

function scheduleFor(
  commitments: readonly Commitment[],
  lookup: CatalogView,
  extra: readonly NormalisedSession[] = [],
): ScheduleInput {
  const sessions: Record<string, NormalisedSession> = {};
  for (const commitment of commitments) {
    if (commitment.kind === 'reservedSession') {
      const entry = lookup.byId.get(commitment.sessionId);
      if (entry !== undefined) {
        sessions[commitment.sessionId] = entry.session;
      }
    }
  }
  for (const session of extra) {
    sessions[session.sessionId] = session;
  }
  return { commitments, sessions };
}

function validInstant(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

/** Creates the rules port over the real S2 engine. */
export function createRulesAdapter(deps: RulesAdapterDeps): RulesPort {
  const context = async (): Promise<Context> => {
    const window = await deps.eventWindow();
    return withContextDefaults({
      now: deps.clock.now().toISOString(),
      eventTimezone: window.timezone,
      venueData: deps.venueData,
    });
  };

  // The event days that hold a commitment. When the timezone is unusable, one undefined day is
  // returned so S2 itself answers "unknown" and the views stay empty.
  const daysOf = (commitments: readonly Commitment[], timezone: string): (string | undefined)[] => {
    try {
      return [
        ...new Set(
          commitments
            .filter((c) => validInstant(c.startsAt))
            .map((c) => eventDay(c.startsAt, timezone)),
        ),
      ];
    } catch {
      return [undefined];
    }
  };

  return {
    checkReservation: async (candidate, commitments, lookup) => {
      try {
        const verdict = checkReservation(
          candidate,
          scheduleFor(commitments, lookup),
          await context(),
        );
        // S2 may flag its own fail-closed block with `internal`; the verdict shape is kept as is.
        return verdict.decision === 'allow'
          ? { decision: 'allow', reasons: verdict.reasons }
          : { decision: verdict.decision, reasons: verdict.reasons };
      } catch {
        return FAIL_CLOSED;
      }
    },

    findClashes: async (commitments, lookup): Promise<ClashSummary> => {
      const report = findClashes(scheduleFor(commitments, lookup), await context());
      return {
        clashes:
          report.status === 'ok'
            ? report.clashes.map((pair) => ({
                firstTitle: pair.a,
                secondTitle: pair.b,
                reason: pair.reason,
              }))
            : [],
      };
    },

    suggestLayovers: async (commitments, lookup): Promise<LayoverSummary> => {
      const report = checkLayovers(scheduleFor(commitments, lookup), await context());
      return {
        suggestions: report.status === 'ok' ? report.days.flatMap((day) => day.suggestions) : [],
      };
    },

    connections: async (commitments, lookup) => {
      const ctx = await context();
      const schedule = scheduleFor(commitments, lookup);
      const idByRef = new Map<string, string>();
      for (const commitment of commitments) {
        if (commitment.kind === 'reservedSession') {
          idByRef.set(resolveCommitment(commitment, schedule.sessions).ref, commitment.sessionId);
        }
      }
      const lines = new Map<string, ConnectionLine>();
      for (const day of daysOf(commitments, String(ctx.eventTimezone))) {
        const view = connectionsForDay(schedule, ctx, day);
        if (view.status === 'ok') {
          for (const connection of view.connections) {
            const id = idByRef.get(connection.to);
            if (id !== undefined) {
              lines.set(id, {
                classification: connection.result.classification,
                ...(connection.result.walkingMinutes === undefined
                  ? {}
                  : { walkingMinutes: connection.result.walkingMinutes }),
                reason: connection.result.reason,
              });
            }
          }
        }
      }
      return lines;
    },

    energy: async (commitments, lookup) => {
      const ctx = await context();
      const schedule = scheduleFor(commitments, lookup);
      const lines = new Map<string, EnergyLine>();
      for (const day of daysOf(commitments, String(ctx.eventTimezone))) {
        const view = energyForDay(schedule, ctx, day);
        if (view.status === 'ok') {
          lines.set(String(day), {
            overloaded: view.energy.overloaded,
            explanation: view.energy.explanation,
          });
        }
      }
      return lines;
    },

    rebooking: async (baseCode, lookup, favorites, originalSessionId): Promise<RebookOption[]> => {
      const sessions = [...lookup.byId.values()].map((entry) => entry.session);
      const favoriteSessions = favorites.flatMap((id) => {
        const entry = lookup.byId.get(id);
        return entry === undefined ? [] : [entry.session];
      });
      const result = findRebookingOptions(
        baseCode,
        sessions,
        favoriteSessions,
        await context(),
        originalSessionId,
      );
      // S2 builds its options only from the candidates it was given, so every id is known here.
      const byId = new Map(sessions.map((session) => [session.sessionId, session]));
      return result.options.map((option) => ({
        kind: option.kind === 'repeat' ? ('repeat' as const) : ('similar' as const),
        session: byId.get(option.sessionId) as NormalisedSession,
        reason: option.reason,
      }));
    },

    planSafeSwap: async (original, repeat, confirmed, lookup): Promise<SwapPlan> => {
      const plan = planSafeSwap(
        original,
        repeat,
        scheduleFor(confirmed, lookup, [repeat]),
        await context(),
      );
      return { outcome: plan.outcome, explanation: plan.reason };
    },

    walkMinutes: (fromVenue, toVenue) => {
      // The two venues are judged as personal time on an arbitrary day in UTC, so the answer does
      // not depend on the event timezone. with a zero buffer S2 reports the venue data's own walking time.
      const ctx = withContextDefaults({
        now: deps.clock.now().toISOString(),
        eventTimezone: 'UTC',
        venueData: deps.venueData,
        bufferMinutes: 0,
      });
      const at = (venue: string, start: string, end: string): Commitment => ({
        kind: 'personalTime',
        title: 'Walk probe',
        location: venue,
        startsAt: start,
        endsAt: end,
      });
      const from = resolveCommitment(
        at(fromVenue, '2030-01-01T10:00:00Z', '2030-01-01T10:30:00Z'),
        {},
      );
      const to = resolveCommitment(at(toVenue, '2030-01-01T12:00:00Z', '2030-01-01T12:30:00Z'), {});
      const result = classifyConnection(
        from,
        to,
        boardingFor({ isReservable: false, startsAt: to.startsAt }, ctx),
        ctx,
      );
      return result.walkingMinutes;
    },
  };
}
