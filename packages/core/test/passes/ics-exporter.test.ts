import fc from 'fast-check';
import ICAL from 'ical.js';
import { describe, expect, test } from 'vitest';
import { createAppDataResolver, joinInFolder } from '../../src/passes/app-data.js';
import {
  BOARDING_CLOSES_MINUTES,
  boardingClosesAt,
  parseInstant,
} from '../../src/passes/boarding.js';
import { createIcsExporter } from '../../src/passes/ics-exporter.js';
import type { Itinerary } from '../../src/passes/models.js';
import { PassError } from '../../src/passes/redaction.js';
import { itineraryArb, validateRfc5545 } from './ics-support.js';
import { memoryFs } from './memory-fs.js';
import { NUM_RUNS, WINDOW, fakeClock } from './support.js';

// Tests for Ics_Exporter and the Boarding_Closes helper (boarding-passes, S4, Requirement 6
// and 1.2). Properties 19 and 20 run through fast-check; the RFC 5545 validator is wired into
// Property 19 (Requirement 9.3).

const appData = createAppDataResolver({
  platform: 'linux',
  env: { XDG_DATA_HOME: '/home/ada/.local/share' },
  homeDir: '/home/ada',
});

function exporter() {
  const fs = memoryFs();
  return { fs, exporter: createIcsExporter({ fs, appData, clock: fakeClock() }) };
}

/** Parse calendar text into its VEVENT components. */
function eventsOf(text: string) {
  return new ICAL.Component(ICAL.parse(text) as unknown[]).getAllSubcomponents('vevent');
}

function controlsToSpaces(text: string): string {
  return text
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\p{Cf}/gu, '')
    .trim();
}

describe('Feature: boarding-passes, Property 19: calendar is valid RFC 5545 with one event per commitment', () => {
  test('every itinerary builds valid iCalendar text with one VEVENT per commitment', () => {
    const { exporter: ics } = exporter();
    fc.assert(
      fc.property(itineraryArb, (itinerary) => {
        const text = ics.buildCalendar(itinerary, WINDOW);

        expect(validateRfc5545(text)).toEqual([]);
        const events = eventsOf(text);
        expect(events).toHaveLength(itinerary.commitments.length);

        events.forEach((event, index) => {
          const { commitment } = itinerary.commitments[index] ?? { commitment: undefined };
          const start = event.getFirstPropertyValue('dtstart') as { toJSDate(): Date };
          const end = event.getFirstPropertyValue('dtend') as { toJSDate(): Date };
          expect(start.toJSDate().getTime()).toBe(Date.parse(commitment?.startsAt ?? ''));
          expect(end.toJSDate().getTime()).toBe(Date.parse(commitment?.endsAt ?? ''));
        });

        // Building again gives the same text: UIDs and everything else are stable.
        expect(ics.buildCalendar(itinerary, WINDOW)).toBe(text);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test('summaries and locations round trip once control characters are made spaces', () => {
    const { exporter: ics } = exporter();
    fc.assert(
      fc.property(itineraryArb, (itinerary) => {
        const events = eventsOf(ics.buildCalendar(itinerary, WINDOW));
        events.forEach((event, index) => {
          const { commitment } = itinerary.commitments[index] ?? { commitment: undefined };
          const fallback = commitment?.kind === 'reservedSession' ? 'Reserved session' : 'Layover';
          const title = commitment?.title ?? '';
          const expected = controlsToSpaces(title) === '' ? fallback : controlsToSpaces(title);
          expect(event.getFirstPropertyValue('summary')).toBe(expected);
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('Feature: boarding-passes, Property 20: alarm rules', () => {
  test('every reserved session has a boarding-closes alarm, and a leave-now alarm only with a walk', () => {
    const { exporter: ics } = exporter();
    fc.assert(
      fc.property(itineraryArb, (itinerary) => {
        const events = eventsOf(ics.buildCalendar(itinerary, WINDOW));
        events.forEach((event, index) => {
          const entry = itinerary.commitments[index];
          const alarms = event.getAllSubcomponents('valarm').map((alarm) => ({
            seconds: (
              alarm.getFirstPropertyValue('trigger') as { toSeconds(): number }
            ).toSeconds(),
            text: alarm.getFirstPropertyValue('description') as string,
          }));
          if (entry?.commitment.kind !== 'reservedSession') {
            expect(alarms).toEqual([]);
            return;
          }
          const boarding = alarms.filter((alarm) => alarm.text.startsWith('Boarding closes'));
          const leave = alarms.filter((alarm) => alarm.text.startsWith('Leave now'));
          expect(boarding.map((alarm) => alarm.seconds)).toEqual([-BOARDING_CLOSES_MINUTES * 60]);
          if (entry.walkMinutes === undefined) {
            expect(leave).toEqual([]);
          } else {
            expect(leave.map((alarm) => alarm.seconds)).toEqual([
              -(BOARDING_CLOSES_MINUTES + entry.walkMinutes) * 60,
            ]);
          }
          expect(alarms).toHaveLength(boarding.length + leave.length);
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

const SAMPLE: Itinerary = {
  commitments: [
    {
      commitment: {
        kind: 'reservedSession',
        sessionId: 'sess-0001',
        title: 'Build on AWS, the boarding pass pattern',
        venue: 'Venetian',
        startsAt: '2026-12-01T10:30:00-08:00',
        endsAt: '2026-12-01T11:30:00-08:00',
      },
    },
    {
      commitment: {
        kind: 'personalTime',
        title: 'Lunch and a walk',
        personalTimeId: 'pt-1',
        location: 'Lounge',
        startsAt: '2026-12-01T12:00:00-08:00',
        endsAt: '2026-12-01T13:00:00-08:00',
      },
    },
    {
      commitment: {
        kind: 'reservedSession',
        sessionId: 'sess-0002',
        title: 'Networking deep dive',
        venue: 'Caesars Forum',
        startsAt: '2026-12-01T14:00:00-08:00',
        endsAt: '2026-12-01T15:00:00-08:00',
      },
      walkMinutes: 12,
    },
  ],
};

describe('Feature: boarding-passes, calendar snapshot and structure (Requirement 9.1)', () => {
  test('the representative itinerary matches its snapshot', () => {
    const { exporter: ics } = exporter();
    expect(ics.buildCalendar(SAMPLE, WINDOW).split('\r\n').join('\n')).toMatchSnapshot();
  });

  test('all times are UTC with Z and there is no TZID or VTIMEZONE', () => {
    const { exporter: ics } = exporter();
    const text = ics.buildCalendar(SAMPLE, WINDOW);
    expect(text).toContain('DTSTART:20261201T183000Z');
    expect(text).toContain('DTSTAMP:20261201T080000Z');
    expect(text).not.toContain('TZID');
    expect(text).not.toContain('VTIMEZONE');
    expect(validateRfc5545(text)).toEqual([]);
  });

  test('the validator itself rejects broken calendars', () => {
    expect(validateRfc5545('BEGIN:VCALENDAR\nEND:VCALENDAR')).toContain('bare LF');
    expect(validateRfc5545('not a calendar\r\n')).toContain('does not parse');
    const { exporter: ics } = exporter();
    const good = ics.buildCalendar(SAMPLE, WINDOW);
    expect(validateRfc5545(good.slice(0, -2))).toContain('missing final CRLF');
    expect(
      validateRfc5545(good.replace('TRIGGER:-PT10M', 'TRIGGER:-PT10M\r\nX-LONG:' + 'y'.repeat(80))),
    ).toContain('line longer than 75 octets');
    expect(validateRfc5545(good.replace('VERSION:2.0', 'VERSION:1.0'))).toContain(
      'VERSION is not 2.0',
    );
    expect(
      validateRfc5545(good.split('PRODID:-//reinvent-compass//boarding-passes//EN\r\n').join('')),
    ).toContain('missing PRODID');
    expect(
      validateRfc5545(
        good.replace(
          'UID:session-sess-0002@reinvent-compass',
          'UID:session-sess-0001@reinvent-compass',
        ),
      ),
    ).toContain('duplicate UID');
    expect(
      validateRfc5545(good.replace('UID:session-sess-0002@reinvent-compass', 'UID:')),
    ).toContain('event without UID');
    expect(
      validateRfc5545(good.replace('DTSTAMP:20261201T080000Z', 'DTSTAMP;X-A=b:20261201T080000')),
    ).toContain('dtstamp is not UTC');
    expect(validateRfc5545(good.replace('DTEND:20261201T193000Z', 'X-GONE:1'))).toContain(
      'event without dtend',
    );
    expect(validateRfc5545(good.replace('ACTION:DISPLAY', 'ACTION:AUDIO'))).toContain(
      'alarm is not DISPLAY',
    );
    expect(validateRfc5545(good.replace('TRIGGER:-PT10M', 'X-NO-TRIGGER:1'))).toContain(
      'alarm without TRIGGER',
    );
    expect(
      validateRfc5545(
        good.replace('DESCRIPTION:Boarding closes: Networking deep dive', 'X-NO-DESC:1'),
      ),
    ).toContain('alarm without DESCRIPTION');
    expect(
      validateRfc5545(
        good.replace('BEGIN:VCALENDAR', 'BEGIN:VEVENTS').replace('END:VCALENDAR', 'END:VEVENTS'),
      ),
    ).toContain('root is not VCALENDAR');
  });
});

describe('Feature: boarding-passes, Boarding_Closes is the start minus ten minutes (Requirement 1.2)', () => {
  test('over representative starts, with offsets, fractions and a day boundary', () => {
    const cases: [string, string][] = [
      ['2026-12-01T10:30:00-08:00', '2026-12-01T18:20:00.000Z'],
      ['2026-12-01T00:05:00Z', '2026-11-30T23:55:00.000Z'],
      ['2026-12-01T10:30:00.500+02:00', '2026-12-01T08:20:00.500Z'],
      ['2026-12-02T09:00:00+00:00', '2026-12-02T08:50:00.000Z'],
    ];
    for (const [start, expected] of cases) {
      expect(boardingClosesAt(start).toISOString()).toBe(expected);
      expect(parseInstant(start).getTime() - boardingClosesAt(start).getTime()).toBe(10 * 60_000);
    }
  });

  test('a text that is not an ISO instant with an offset is refused without echo', () => {
    for (const bad of [
      '',
      'tomorrow',
      '2026-12-01T10:30:00',
      '2026-13-45T99:99:99Z',
      '2026-12-01',
    ]) {
      let caught: unknown;
      try {
        boardingClosesAt(bad);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(PassError);
      expect((caught as PassError).code).toBe('time.invalid_instant');
      expect((caught as PassError).message).not.toContain('tomorrow');
    }
  });
});

describe('Feature: boarding-passes, stable UID and output path (Requirement 6.5)', () => {
  const uidsOf = (text: string) =>
    eventsOf(text).map((event) => event.getFirstPropertyValue('uid') as string);

  test('building twice yields identical UIDs for a reserved session and for both layover kinds', () => {
    const { exporter: ics } = exporter();
    const itinerary: Itinerary = {
      commitments: [
        SAMPLE.commitments[0],
        SAMPLE.commitments[1],
        {
          commitment: {
            kind: 'personalTime',
            title: 'Coffee',
            startsAt: '2026-12-01T16:00:00-08:00',
            endsAt: '2026-12-01T16:30:00-08:00',
          },
        },
      ],
    };
    const first = uidsOf(ics.buildCalendar(itinerary, WINDOW));
    const second = uidsOf(ics.buildCalendar(itinerary, WINDOW));
    expect(second).toEqual(first);
    expect(first[0]).toBe('session-sess-0001@reinvent-compass');
    expect(first[1]).toBe('layover-pt-1@reinvent-compass');
    expect(first[2]).toMatch(/^layover-[0-9a-f]{24}@reinvent-compass$/);
  });

  test('a layover with no id keys on its title and start, so a different start is a different UID', () => {
    const { exporter: ics } = exporter();
    const at = (start: string, end: string) => ({
      commitment: { kind: 'personalTime' as const, title: 'Coffee', startsAt: start, endsAt: end },
    });
    const uids = uidsOf(
      ics.buildCalendar(
        {
          commitments: [
            at('2026-12-01T16:00:00-08:00', '2026-12-01T16:30:00-08:00'),
            at('2026-12-01T17:00:00-08:00', '2026-12-01T17:30:00-08:00'),
          ],
        },
        WINDOW,
      ),
    );
    expect(new Set(uids).size).toBe(2);
  });

  test('two commitments that would share a UID get a numeric suffix', () => {
    const { exporter: ics } = exporter();
    const uids = uidsOf(
      ics.buildCalendar(
        { commitments: [SAMPLE.commitments[0], SAMPLE.commitments[0], SAMPLE.commitments[0]] },
        WINDOW,
      ),
    );
    expect(uids).toEqual([
      'session-sess-0001@reinvent-compass',
      'session-sess-0001-2@reinvent-compass',
      'session-sess-0001-3@reinvent-compass',
    ]);
  });

  test('writeCalendar writes only inside the app-data output folder with mode 0600', async () => {
    const { fs, exporter: ics } = exporter();
    const path = await ics.writeCalendar(SAMPLE, WINDOW);
    const folder = joinInFolder(appData.resolve(), 'output');
    expect(path).toBe(joinInFolder(folder, 'reinvent.ics'));
    expect(path.startsWith(`${appData.resolve()}/output/`)).toBe(true);
    expect(fs.dirs).toEqual([folder]);
    expect([...fs.files.keys()]).toEqual([path]);
    expect(fs.modes.get(path)).toBe(0o600);
    expect(validateRfc5545(fs.files.get(path) ?? '')).toEqual([]);
  });

  test('a filesystem failure is a fixed PassError that names no path', async () => {
    for (const operation of ['ensureDir', 'writeFile'] as const) {
      const { fs, exporter: ics } = exporter();
      fs.failing.add(operation);
      await expect(ics.writeCalendar(SAMPLE, WINDOW)).rejects.toMatchObject({
        code: 'ics.write_failed',
        message: 'The calendar file could not be written.',
      });
    }
  });
});

describe('Feature: boarding-passes, calendar text safety and invalid itineraries', () => {
  test('control characters in text become spaces and empty text falls back', () => {
    const { exporter: ics } = exporter();
    const text = ics.buildCalendar(
      {
        commitments: [
          {
            commitment: {
              kind: 'reservedSession',
              sessionId: 's1',
              title: 'Line one\r\nBEGIN:VEVENT\u{7}\u{7F}',
              venue: '\n',
              startsAt: '2026-12-01T10:30:00-08:00',
              endsAt: '2026-12-01T11:30:00-08:00',
            },
          },
          {
            commitment: {
              kind: 'reservedSession',
              sessionId: 's2',
              startsAt: '2026-12-01T12:30:00-08:00',
              endsAt: '2026-12-01T13:30:00-08:00',
            },
          },
          {
            commitment: {
              kind: 'personalTime',
              title: ' ',
              startsAt: '2026-12-01T14:30:00-08:00',
              endsAt: '2026-12-01T15:30:00-08:00',
            },
          },
        ],
      },
      WINDOW,
    );
    expect(validateRfc5545(text)).toEqual([]);
    const summaries = eventsOf(text).map((event) => event.getFirstPropertyValue('summary'));
    expect(summaries).toEqual(['Line one  BEGIN:VEVENT', 'Reserved session', 'Layover']);
    expect(eventsOf(text)).toHaveLength(3);
  });

  test('an empty itinerary is still a valid calendar', () => {
    const { exporter: ics } = exporter();
    const text = ics.buildCalendar({ commitments: [] }, WINDOW);
    expect(validateRfc5545(text)).toEqual([]);
    expect(eventsOf(text)).toHaveLength(0);
  });

  test('a bad time, an end before the start or a bad walk is a PassError that echoes nothing', () => {
    const { exporter: ics } = exporter();
    const reserved = (overrides: Record<string, unknown>, walkMinutes?: number) => ({
      commitments: [
        {
          commitment: {
            kind: 'reservedSession' as const,
            sessionId: 's1',
            title: 'Secret session title',
            startsAt: '2026-12-01T10:30:00-08:00',
            endsAt: '2026-12-01T11:30:00-08:00',
            ...overrides,
          },
          walkMinutes,
        },
      ],
    });
    const cases: [Itinerary, string][] = [
      [reserved({ startsAt: 'later' }), 'time.invalid_instant'],
      [reserved({ endsAt: 'soon' }), 'time.invalid_instant'],
      [reserved({ endsAt: '2026-12-01T10:30:00-08:00' }), 'ics.invalid_commitment'],
      [reserved({ endsAt: '2026-12-01T09:00:00-08:00' }), 'ics.invalid_commitment'],
      [reserved({}, Number.NaN), 'ics.invalid_commitment'],
      [reserved({}, -1), 'ics.invalid_commitment'],
      [reserved({}, 91), 'ics.invalid_commitment'],
    ];
    for (const [itinerary, code] of cases) {
      let caught: unknown;
      try {
        ics.buildCalendar(itinerary, WINDOW);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(PassError);
      expect((caught as PassError).code).toBe(code);
      expect((caught as PassError).message).not.toContain('Secret');
    }
  });

  test('a fractional walk is rounded to whole minutes', () => {
    const { exporter: ics } = exporter();
    const text = ics.buildCalendar(
      { commitments: [{ ...(SAMPLE.commitments[2] as object), walkMinutes: 12.6 } as never] },
      WINDOW,
    );
    expect(text).toContain('TRIGGER:-PT23M');
  });
});

describe('Feature: boarding-passes, calendar injection safety (security M1, QA L2, QA L6)', () => {
  const KNOWN_PROPERTIES = new Set([
    'BEGIN',
    'END',
    'VERSION',
    'PRODID',
    'NAME',
    'X-WR-CALNAME',
    'X-WR-CALDESC',
    'UID',
    'SEQUENCE',
    'DTSTAMP',
    'DTSTART',
    'DTEND',
    'SUMMARY',
    'LOCATION',
    'DESCRIPTION',
    'ACTION',
    'TRIGGER',
  ]);

  test('every emitted line starts with a known property name or is a fold continuation, whatever the text', () => {
    const { exporter: ics } = exporter();
    fc.assert(
      fc.property(itineraryArb, (itinerary) => {
        const text = ics.buildCalendar(itinerary, WINDOW);
        const lines = text.split('\r\n');
        expect(lines.pop()).toBe('');
        for (const line of lines) {
          if (line.startsWith(' ')) continue;
          expect(KNOWN_PROPERTIES.has(line.split(/[:;]/)[0] ?? '')).toBe(true);
        }
        expect(lines.filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(
          itinerary.commitments.length,
        );
        const injected = lines.filter((line) => /^(X-INJECTED|ATTENDEE|UID:evil)/.test(line));
        expect(injected).toEqual([]);
        expect(validateRfc5545(text)).toEqual([]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test('UIDs only ever hold safe characters, whatever the identifiers were', () => {
    const { exporter: ics } = exporter();
    fc.assert(
      fc.property(itineraryArb, (itinerary) => {
        const uids = eventsOf(ics.buildCalendar(itinerary, WINDOW)).map(
          (event) => event.getFirstPropertyValue('uid') as string,
        );
        for (const uid of uids) {
          expect(uid).toMatch(/^(session|layover)-[A-Za-z0-9_-]{1,64}(-\d+)?@reinvent-compass$/);
        }
        expect(new Set(uids).size).toBe(uids.length);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test('an unsafe identifier is replaced by a hash of itself, a safe one is kept', () => {
    const { exporter: ics } = exporter();
    const at = { startsAt: '2026-12-01T10:30:00-08:00', endsAt: '2026-12-01T11:30:00-08:00' };
    const uids = eventsOf(
      ics.buildCalendar(
        {
          commitments: [
            { commitment: { kind: 'reservedSession', sessionId: 'ok_id-1', ...at } },
            { commitment: { kind: 'reservedSession', sessionId: 'bad\r\nid', ...at } },
            { commitment: { kind: 'reservedSession', sessionId: 'a'.repeat(65), ...at } },
            { commitment: { kind: 'personalTime', title: 't', personalTimeId: 'x;y', ...at } },
          ],
        },
        WINDOW,
      ),
    ).map((event) => event.getFirstPropertyValue('uid') as string);
    expect(uids[0]).toBe('session-ok_id-1@reinvent-compass');
    expect(uids[1]).toMatch(/^session-[0-9a-f]{24}@reinvent-compass$/);
    expect(uids[2]).toMatch(/^session-[0-9a-f]{24}@reinvent-compass$/);
    expect(uids[3]).toMatch(/^layover-[0-9a-f]{24}@reinvent-compass$/);
    expect(new Set(uids).size).toBe(4);
  });

  test('the UID stays the same when a session moves (requirement 6.5)', () => {
    const { exporter: ics } = exporter();
    const at = (startsAt: string, endsAt: string) => ({
      commitments: [
        { commitment: { kind: 'reservedSession' as const, sessionId: 's1', startsAt, endsAt } },
      ],
    });
    const uid = (itinerary: Itinerary) =>
      eventsOf(ics.buildCalendar(itinerary, WINDOW))[0]?.getFirstPropertyValue('uid');
    const original = uid(at('2026-12-01T10:30:00-08:00', '2026-12-01T11:30:00-08:00'));
    expect(original).toBe('session-s1@reinvent-compass');
    expect(uid(at('2026-12-01T11:30:00-08:00', '2026-12-01T12:30:00-08:00'))).toBe(original);
    expect(uid(at('2026-12-03T09:00:00-08:00', '2026-12-03T10:00:00-08:00'))).toBe(original);
  });

  test('duplicate ids are numbered by start time, and moving one past the other swaps the suffixes', () => {
    const { exporter: ics } = exporter();
    const dup = (startsAt: string, endsAt: string, title: string) => ({
      commitment: { kind: 'reservedSession' as const, sessionId: 's1', title, startsAt, endsAt },
    });
    const early = dup('2026-12-01T09:00:00-08:00', '2026-12-01T10:00:00-08:00', 'early');
    const middle = dup('2026-12-01T11:00:00-08:00', '2026-12-01T12:00:00-08:00', 'middle');
    const late = dup('2026-12-01T13:00:00-08:00', '2026-12-01T14:00:00-08:00', 'late');
    const byTitle = (itinerary: Itinerary) =>
      Object.fromEntries(
        eventsOf(ics.buildCalendar(itinerary, WINDOW)).map((event) => [
          event.getFirstPropertyValue('summary') as string,
          event.getFirstPropertyValue('uid') as string,
        ]),
      );
    // Input order does not matter: the start time decides.
    expect(byTitle({ commitments: [late, early, middle] })).toEqual({
      early: 'session-s1@reinvent-compass',
      middle: 'session-s1-2@reinvent-compass',
      late: 'session-s1-3@reinvent-compass',
    });
    // Moving the early one after the late one swaps the suffixes between them.
    const moved = dup('2026-12-01T15:00:00-08:00', '2026-12-01T16:00:00-08:00', 'early');
    expect(byTitle({ commitments: [moved, middle, late] })).toEqual({
      middle: 'session-s1@reinvent-compass',
      late: 'session-s1-2@reinvent-compass',
      early: 'session-s1-3@reinvent-compass',
    });
  });

  test('bidirectional and format characters are removed, separators become spaces', () => {
    const { exporter: ics } = exporter();
    const text = ics.buildCalendar(
      {
        commitments: [
          {
            commitment: {
              kind: 'reservedSession',
              sessionId: 's1',
              title:
                'A\u{202E}B\u{202C}C\u{200B}D\u{FEFF}E\u{2066}F\u{2069}G\u{200E}H\u{2028}I\u{2029}J',
              venue: 'Ha\u{200F}ll',
              startsAt: '2026-12-01T10:30:00-08:00',
              endsAt: '2026-12-01T11:30:00-08:00',
            },
          },
        ],
      },
      WINDOW,
    );
    const event = eventsOf(text)[0];
    expect(event?.getFirstPropertyValue('summary')).toBe('ABCDEFGH I J');
    expect(event?.getFirstPropertyValue('location')).toBe('Hall');
    expect(text).not.toMatch(
      /[\u{200B}-\u{200F}\u{202A}-\u{202E}\u{2066}-\u{2069}\u{FEFF}\u{2028}\u{2029}]/u,
    );
    // Text that is only format characters has nothing left and falls back.
    const empty = ics.buildCalendar(
      {
        commitments: [
          {
            commitment: {
              kind: 'reservedSession',
              sessionId: 's1',
              title: '\u{200B}\u{202E}',
              startsAt: '2026-12-01T10:30:00-08:00',
              endsAt: '2026-12-01T11:30:00-08:00',
            },
          },
        ],
      },
      WINDOW,
    );
    expect(eventsOf(empty)[0]?.getFirstPropertyValue('summary')).toBe('Reserved session');
  });

  test('a timezone that is not a real zone is refused and never reaches the calendar text', () => {
    const { exporter: ics } = exporter();
    for (const timezone of ['Not/AZone', 'x\r\nBEGIN:VEVENT', '']) {
      let caught: unknown;
      try {
        ics.buildCalendar(SAMPLE, { ...WINDOW, timezone });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(PassError);
      expect((caught as PassError).code).toBe('ics.invalid_window');
      expect((caught as PassError).message).not.toContain('AZone');
    }
  });
});
