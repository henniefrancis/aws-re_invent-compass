// Plain-English reasons for the Events API bulk failure codes (Requirements 12.5 and 14.1).
// An unrecognised code is reported as a refusal without echoing the code.

import type { BulkFailure } from '@compass/contracts';
import type { CatalogView } from '../ports/events-port.js';

const REASONS: Record<string, string> = {
  sessionNotReservable: 'This session cannot be reserved. It may be walk-up only.',
  alreadyScheduled: 'You already have this session on your schedule.',
  sessionFull: 'This session is full.',
  insufficientAccess: 'Your registration does not give you access to this session.',
  timePassed: 'This session has already started or finished.',
  alreadyFavorited: 'This session is already on your standby list.',
  notFavorited: 'This session was not on your standby list.',
  other: 'The Events service refused this session.',
};

/** The reason for one refusal, naming clashing sessions from the catalog when it knows them. */
export function explainFailure(failure: BulkFailure, lookup: CatalogView): string {
  if (failure.code === 'scheduleConflict') {
    const clashes = (failure.conflictsWith ?? []).flatMap((id) => {
      const entry = lookup.byId.get(id);
      return entry === undefined ? [] : [`${entry.session.code} "${entry.session.title}"`];
    });
    return clashes.length === 0
      ? 'This session overlaps something already on your schedule.'
      : `This session overlaps ${clashes.join(', ')}.`;
  }
  return (
    REASONS[failure.code] ??
    'The Events service refused this session for a reason Compass does not recognise.'
  );
}
