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
  return Array.from(text, (character) => {
    const code = character.codePointAt(0) as number;
    return code < 0x20 || code === 0x7f ? ' ' : character;
  })
    .join('')
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
      validateRfc5545(good.replace('UID:session-sess-0002', 'UID:session-sess-0001')),
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
      'session-sess-0001-1@reinvent-compass',
      'session-sess-0001-2@reinvent-compass',
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
