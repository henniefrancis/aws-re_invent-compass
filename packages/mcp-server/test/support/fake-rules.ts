import type { Commitment, NormalisedSession, Verdict } from '@compass/contracts';
import type { CatalogView } from '../../src/ports/events-port.js';
import type {
  ClashSummary,
  ConnectionLine,
  EnergyLine,
  LayoverSummary,
  RebookOption,
  RulesPort,
  SwapPlan,
} from '../../src/ports/rules-port.js';
import type { RecordedCall } from './fake-events.js';

function range(commitment: Commitment): [number, number] {
  return [Date.parse(commitment.startsAt), Date.parse(commitment.endsAt)];
}

function titleOf(commitment: Commitment, lookup: CatalogView): string {
  if (commitment.kind === 'personalTime') {
    return commitment.title;
  }
  return lookup.byId.get(commitment.sessionId)?.session.title ?? commitment.title ?? 'a session';
}

/** Turns catalog-known reserved session ids into commitments. */
export function commitmentFor(session: NormalisedSession): Commitment {
  return {
    kind: 'reservedSession',
    sessionId: session.sessionId,
    startsAt: session.startsAt ?? '1970-01-01T00:00:00Z',
    endsAt: session.endsAt ?? '1970-01-01T00:00:00Z',
    title: session.title,
    ...(session.venue === undefined ? {} : { venue: session.venue }),
  };
}

/**
 * A recording RulesPort with simple, deterministic behaviour: a candidate that overlaps
 * any commitment in time is blocked, everything else is allowed. Scripts can override
 * each member. Every call is recorded.
 */
export class FakeRules implements RulesPort {
  readonly calls: RecordedCall[] = [];
  verdictFor:
    ((candidate: NormalisedSession, commitments: readonly Commitment[]) => Verdict) | undefined;
  swapOutcome: SwapPlan = {
    outcome: 'safe',
    explanation: 'The repeat is held, so cancelling is safe.',
  };
  layoverSuggestions: LayoverSummary = { suggestions: [] };
  overloadedDays = new Set<string>();
  walk: number | undefined = 5;

  checkReservation(
    candidate: NormalisedSession,
    commitments: readonly Commitment[],
    lookup: CatalogView,
  ): Promise<Verdict> {
    this.calls.push({
      method: 'checkReservation',
      args: [candidate.sessionId, commitments.length],
    });
    if (this.verdictFor !== undefined) {
      return Promise.resolve(this.verdictFor(candidate, commitments));
    }
    if (candidate.startsAt === undefined || candidate.endsAt === undefined) {
      return Promise.resolve({ decision: 'allow', reasons: [] });
    }
    const start = Date.parse(candidate.startsAt);
    const end = Date.parse(candidate.endsAt);
    for (const commitment of commitments) {
      const [otherStart, otherEnd] = range(commitment);
      if (start < otherEnd && otherStart < end) {
        return Promise.resolve({
          decision: 'block',
          reasons: [`It overlaps ${titleOf(commitment, lookup)}.`],
        });
      }
    }
    return Promise.resolve({ decision: 'allow', reasons: [] });
  }

  findClashes(commitments: readonly Commitment[], lookup: CatalogView): Promise<ClashSummary> {
    this.calls.push({ method: 'findClashes', args: [commitments.length] });
    const clashes: ClashSummary['clashes'] = [];
    for (let i = 0; i < commitments.length; i += 1) {
      for (let j = i + 1; j < commitments.length; j += 1) {
        const a = commitments[i];
        const b = commitments[j];
        if (a === undefined || b === undefined) continue;
        const [aStart, aEnd] = range(a);
        const [bStart, bEnd] = range(b);
        if (aStart < bEnd && bStart < aEnd) {
          clashes.push({
            firstTitle: titleOf(a, lookup),
            secondTitle: titleOf(b, lookup),
            reason: 'These two overlap in time.',
          });
        }
      }
    }
    return Promise.resolve({ clashes });
  }

  suggestLayovers(commitments: readonly Commitment[]): Promise<LayoverSummary> {
    this.calls.push({ method: 'suggestLayovers', args: [commitments.length] });
    return Promise.resolve(this.layoverSuggestions);
  }

  connections(commitments: readonly Commitment[]): Promise<ReadonlyMap<string, ConnectionLine>> {
    this.calls.push({ method: 'connections', args: [commitments.length] });
    const map = new Map<string, ConnectionLine>();
    for (const commitment of commitments) {
      if (commitment.kind === 'reservedSession') {
        map.set(commitment.sessionId, {
          classification: 'comfortable',
          walkingMinutes: 5,
          reason: 'Plenty of time to walk.',
        });
      }
    }
    return Promise.resolve(map);
  }

  energy(commitments: readonly Commitment[]): Promise<ReadonlyMap<string, EnergyLine>> {
    this.calls.push({ method: 'energy', args: [commitments.length] });
    const map = new Map<string, EnergyLine>();
    for (const commitment of commitments) {
      const day = commitment.startsAt.slice(0, 10);
      map.set(day, {
        overloaded: this.overloadedDays.has(day),
        explanation: this.overloadedDays.has(day)
          ? 'This day is heavy.'
          : 'This day looks manageable.',
      });
    }
    return Promise.resolve(map);
  }

  rebooking(baseCode: string, lookup: CatalogView): Promise<RebookOption[]> {
    this.calls.push({ method: 'rebooking', args: [baseCode] });
    const options: RebookOption[] = [];
    for (const { session } of lookup.byId.values()) {
      const base = session.code.replace(/-R\d?$/, '');
      if (base === baseCode.replace(/-R\d?$/, '') && session.code !== baseCode) {
        options.push({ kind: 'repeat', session, reason: 'Same session at another time.' });
      }
    }
    return Promise.resolve(options);
  }

  planSafeSwap(original: Commitment, repeat: NormalisedSession): Promise<SwapPlan> {
    this.calls.push({
      method: 'planSafeSwap',
      args: [original.kind === 'reservedSession' ? original.sessionId : 'other', repeat.sessionId],
    });
    return Promise.resolve(this.swapOutcome);
  }

  walkMinutes(fromVenue: string, toVenue: string): number | undefined {
    this.calls.push({ method: 'walkMinutes', args: [fromVenue, toVenue] });
    return this.walk;
  }
}
