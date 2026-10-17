// Sample calendar file (showcase-site, Component 9).
//
// An RFC 5545 file of the demo week, built in the browser with no request. Lines end with CRLF
// and are folded at 75 octets, text values are escaped, every commitment is one VEVENT, and
// the instants are written in UTC. DTSTAMP is the fixed demo instant and UIDs sit under the
// reserved .invalid domain, so the file is the same every time.
//
// Reserved sessions get a "Boarding closes" alarm 10 minutes before the start and, when the
// engine knows the walk from the previous commitment, a "Leave now" alarm at the boarding
// time minus that walk. The walk is the engine's walk plus its buffer.

import type { DemoDeps } from './demo-deps';
import { DEMO_EVENT } from './demo-catalog';
import type { DemoState } from './demo-state';
import { neighboursOf } from './neighbours';
import { commitmentRef } from './schedule';
import { gateText } from './week-view';
import { toUtcStamp } from '../time/iso';

export const PRODID = '-//re:Invent Compass//Showcase demo//EN';
export const UID_DOMAIN = 'demo.reinvent-compass.invalid';
export const BOARDING_MINUTES = 10;
export const FILE_NAME = 'compass-demo-week.ics';
const MAX_OCTETS = 75;
const DESCRIPTION =
  'Made-up session for the re:Invent Compass demo. Unofficial. Your badge is your ticket.';
const LAYOVER_DESCRIPTION =
  'Made-up layover for the re:Invent Compass demo. Unofficial. Your badge is your ticket.';

const BACKSLASH = String.fromCharCode(92);

export interface IcsAlarm {
  readonly minutesBeforeStart: number;
  readonly description: 'Boarding closes' | 'Leave now';
}

export interface IcsEvent {
  readonly uid: string;
  readonly start: string;
  readonly end: string;
  readonly summary: string;
  readonly location: string;
  readonly description: string;
  readonly alarms: readonly IcsAlarm[];
}

/** Escape a text value: backslash, semicolon, comma and line breaks. */
export function escapeText(value: string): string {
  return value
    .split(BACKSLASH)
    .join(`${BACKSLASH}${BACKSLASH}`)
    .split(';')
    .join(`${BACKSLASH};`)
    .split(',')
    .join(`${BACKSLASH},`)
    .split('\r\n')
    .join('\n')
    .split('\r')
    .join('\n')
    .split('\n')
    .join(`${BACKSLASH}n`);
}

const octets = (text: string): number => new TextEncoder().encode(text).length;

/**
 * Fold one content line at 75 octets. A continuation line starts with one space, which counts
 * towards its 75. A character is never split.
 */
export function foldLine(line: string): readonly string[] {
  const lines: string[] = [];
  let current = '';
  for (const char of line) {
    const limit = lines.length === 0 ? MAX_OCTETS : MAX_OCTETS - 1;
    if (octets(current) + octets(char) > limit) {
      lines.push(lines.length === 0 ? current : ` ${current}`);
      current = '';
    }
    current += char;
  }
  lines.push(lines.length === 0 ? current : ` ${current}`);
  return lines;
}

const sanitiseUid = (ref: string): string => ref.replace(/[^A-Za-z0-9-]/g, '-');

/** The events of the demo week, in order, with their alarms. */
export function demoCalendarEvents(state: DemoState, deps: DemoDeps): readonly IcsEvent[] {
  return state.commitments.map((commitment): IcsEvent => {
    const ref = commitmentRef(commitment);
    if (commitment.kind === 'personalTime') {
      return {
        uid: `${sanitiseUid(ref)}@${UID_DOMAIN}`,
        start: commitment.startsAt,
        end: commitment.endsAt,
        summary: commitment.title,
        location: gateText(commitment.location, undefined),
        description: LAYOVER_DESCRIPTION,
        alarms: [],
      };
    }
    const session = deps.catalog.get(commitment.sessionId);
    const { previous } = neighboursOf(ref, state, deps);
    const walk = previous?.walkMinutes ?? null;
    const alarms: IcsAlarm[] = [
      { minutesBeforeStart: BOARDING_MINUTES, description: 'Boarding closes' },
      ...(walk === null
        ? []
        : [{ minutesBeforeStart: BOARDING_MINUTES + walk, description: 'Leave now' as const }]),
    ];
    const walkNote =
      walk === null
        ? 'The walk from the previous session is unknown, so there is no Leave now alarm.'
        : `The Leave now alarm uses the walk plus buffer: ${String(walk)} minutes.`;
    return {
      uid: `${sanitiseUid(ref)}@${UID_DOMAIN}`,
      start: commitment.startsAt,
      end: commitment.endsAt,
      summary:
        session === undefined ? (commitment.title ?? ref) : `${session.code}: ${session.title}`,
      location: gateText(session?.venue ?? commitment.venue, session?.room),
      description: `${DESCRIPTION} ${walkNote}`,
      alarms,
    };
  });
}

function eventLines(event: IcsEvent, dtstamp: string): string[] {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${toUtcStamp(event.start) as string}`,
    `DTEND:${toUtcStamp(event.end) as string}`,
    `SUMMARY:${escapeText(event.summary)}`,
    `LOCATION:${escapeText(event.location)}`,
    `DESCRIPTION:${escapeText(event.description)}`,
  ];
  for (const alarm of event.alarms) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${alarm.description}`,
      `TRIGGER:-PT${String(alarm.minutesBeforeStart)}M`,
      'END:VALARM',
    );
  }
  lines.push('END:VEVENT');
  return lines;
}

/** The whole file as text: CRLF line endings, lines folded at 75 octets. */
export function serialiseCalendar(events: readonly IcsEvent[], dtstamp: string): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    ...events.flatMap((event) => eventLines(event, dtstamp)),
    'END:VCALENDAR',
  ];
  return `${lines.flatMap((line) => foldLine(line)).join('\r\n')}\r\n`;
}

/** The calendar text for the current demo week, stamped with the fixed demo instant. */
export function demoCalendarText(state: DemoState, deps: DemoDeps): string {
  return serialiseCalendar(demoCalendarEvents(state, deps), toUtcStamp(DEMO_EVENT.now) as string);
}
