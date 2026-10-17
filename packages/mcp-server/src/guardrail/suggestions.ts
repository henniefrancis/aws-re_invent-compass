// Suggestions for a blocked reservation (Requirements 12.3 and 13.1, design Component 7).
//
// Rebooking: repeats of the blocked session that do not themselves block against the
// confirmed schedule, plus any similar sessions S2 offers. Safe swap: for a confirmed
// reservation that clashes with the blocked session, the first repeat of that reservation
// that is not blocked against "confirmed minus the original plus the blocked session". The
// swap is: reserve the repeat, confirm it, cancel the original, then reserve the blocked
// session, so the attendee never holds neither seat.

import type { Commitment, NormalisedSession } from '@compass/contracts';
import type { CatalogView } from '../ports/events-port.js';
import type { RebookOption, RulesPort } from '../ports/rules-port.js';
import { commitmentFor } from '../tools/common.js';

/** A proposed swap. The steps name catalog codes and titles, so they are catalog text. */
export interface SwapSuggestion {
  originalId: string;
  repeatId: string;
  blockedId: string;
  steps: string[];
}

/** What to offer instead of a blocked reservation. */
export interface Suggestions {
  rebooking: RebookOption[];
  swap?: SwapSuggestion;
}

function describe(session: NormalisedSession): string {
  return `${session.code} "${session.title}"`;
}

/** Suggests alternatives for a blocked session. Never writes. */
export async function suggestForBlock(
  blocked: NormalisedSession,
  confirmed: readonly Commitment[],
  rules: RulesPort,
  lookup: CatalogView,
  favorites: readonly string[],
): Promise<Suggestions> {
  const rebooking: RebookOption[] = [];
  for (const option of await rules.rebooking(blocked.code, lookup, favorites)) {
    if (
      option.kind === 'similar' ||
      (await rules.checkReservation(option.session, confirmed, lookup)).decision !== 'block'
    ) {
      rebooking.push(option);
    }
  }

  for (const original of confirmed) {
    if (
      original.kind === 'reservedSession' &&
      (await rules.checkReservation(blocked, [original], lookup)).decision === 'block'
    ) {
      const originalSession = lookup.byId.get(original.sessionId)?.session;
      const repeats =
        originalSession === undefined
          ? []
          : (await rules.rebooking(originalSession.code, lookup, favorites)).filter(
              (option) => option.kind === 'repeat',
            );
      const without = [...confirmed.filter((c) => c !== original), commitmentFor(blocked)];
      for (const { session: repeat } of repeats) {
        if (
          originalSession !== undefined &&
          (await rules.checkReservation(repeat, without, lookup)).decision !== 'block'
        ) {
          return {
            rebooking,
            swap: {
              originalId: original.sessionId,
              repeatId: repeat.sessionId,
              blockedId: blocked.sessionId,
              steps: [
                `Reserve ${describe(repeat)} first, so you hold a seat at a different time.`,
                'Check your schedule to confirm that seat.',
                `Cancel ${describe(originalSession)}.`,
                `Reserve ${describe(blocked)}.`,
              ],
            },
          };
        }
      }
    }
  }
  return { rebooking };
}
