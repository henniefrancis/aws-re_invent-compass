// Sanitising a whole wire session (events-client, S1, finding N1).
//
// Every free-text field of a wire session is passed through sanitiseText: the title,
// abbreviation, type, level, venue and room and each speaker name as single-line text,
// the abstract as multi-line text up to 5000 code points, and every string in the
// list fields (topics, services and the others) as single-line text. Nothing else is
// touched and nothing is rejected: an over-long value is truncated.

import type { SessionWire } from '@compass/contracts';
import { MAX_ABSTRACT_CODE_POINTS, sanitiseText } from '../api/sanitise-text.js';

const LIST_FIELDS = [
  'tracks',
  'topics',
  'industries',
  'areasOfInterest',
  'roles',
  'services',
  'segments',
  'features',
  'customerPersonas',
  'experiences',
  'additionalActivities',
  'focusAreas',
] as const;

const SINGLE_LINE_FIELDS = ['abbreviation', 'type', 'level', 'venue', 'room'] as const;

/** Return a copy of the wire session with all of its free text sanitised. */
export function sanitiseWire(wire: SessionWire): SessionWire {
  const clean: SessionWire = { ...wire, title: sanitiseText(wire.title) };
  for (const key of SINGLE_LINE_FIELDS) {
    const value = wire[key];
    if (value !== undefined) {
      clean[key] = sanitiseText(value);
    }
  }
  if (wire.abstract !== undefined) {
    clean.abstract = sanitiseText(wire.abstract, {
      multiline: true,
      maxCodePoints: MAX_ABSTRACT_CODE_POINTS,
    });
  }
  if (wire.speakers !== undefined) {
    clean.speakers = wire.speakers.map((speaker) =>
      speaker.name === undefined ? speaker : { ...speaker, name: sanitiseText(speaker.name) },
    );
  }
  for (const key of LIST_FIELDS) {
    const list = wire[key];
    if (list !== undefined) {
      clean[key] = list.map((item) => sanitiseText(item));
    }
  }
  return clean;
}
