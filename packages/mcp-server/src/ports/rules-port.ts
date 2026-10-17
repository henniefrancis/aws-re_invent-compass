// The S2 itinerary-rules seam (design, Component 6). The context (now, timezone, venue
// data) is bound by the adapter per call, so handlers never build it.

import type { Commitment, NormalisedSession, Verdict } from '@compass/contracts';
import type { CatalogView } from './events-port.js';

/** How comfortable the walk into a session is. */
export interface ConnectionLine {
  classification: 'comfortable' | 'tight' | 'impossible' | 'unknown';
  walkingMinutes?: number;
  reason: string;
}

/** The energy result for one day. */
export interface EnergyLine {
  overloaded: boolean;
  explanation: string;
}

/** One pair of commitments that overlap, in plain English. */
export interface ClashSummary {
  clashes: { firstTitle: string; secondTitle: string; reason: string }[];
}

/** Suggested layover windows for the commitments given. */
export interface LayoverSummary {
  suggestions: { start: string; end: string; reason: string }[];
}

/** One way to rebook a session: another time of the same session, or a similar one. */
export interface RebookOption {
  kind: 'repeat' | 'similar';
  session: NormalisedSession;
  reason: string;
}

/** The outcome of S2 planSafeSwap for hold-the-repeat-then-cancel-the-original. */
export interface SwapPlan {
  outcome: 'safe' | 'unsafe' | 'failed';
  explanation: string;
}

/** S2 as the server sees it. */
export interface RulesPort {
  checkReservation(
    candidate: NormalisedSession,
    commitments: readonly Commitment[],
    lookup: CatalogView,
  ): Promise<Verdict>;
  findClashes(commitments: readonly Commitment[], lookup: CatalogView): Promise<ClashSummary>;
  suggestLayovers(commitments: readonly Commitment[], lookup: CatalogView): Promise<LayoverSummary>;
  connections(
    commitments: readonly Commitment[],
    lookup: CatalogView,
  ): Promise<ReadonlyMap<string, ConnectionLine>>;
  energy(
    commitments: readonly Commitment[],
    lookup: CatalogView,
  ): Promise<ReadonlyMap<string, EnergyLine>>;
  rebooking(
    baseCode: string,
    lookup: CatalogView,
    favorites: readonly string[],
  ): Promise<RebookOption[]>;
  planSafeSwap(
    original: Commitment,
    repeat: NormalisedSession,
    confirmed: readonly Commitment[],
    lookup: CatalogView,
  ): Promise<SwapPlan>;
  walkMinutes(fromVenue: string, toVenue: string): number | undefined;
}
