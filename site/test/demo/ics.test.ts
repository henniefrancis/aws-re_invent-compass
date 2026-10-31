import ICAL from 'ical.js';
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { DEMO_EVENT, DEMO_SESSIONS } from '../../src/lib/demo/demo-catalog';
import type { DemoState, DemoAction } from '../../src/lib/demo/demo-state';
import {
  PRODID,
  UID_DOMAIN,
  demoCalendarEvents,
  demoCalendarText,
  escapeText,
  foldLine,
  serialiseCalendar,
} from '../../src/lib/demo/ics';
import { neighboursOf } from '../../src/lib/demo/neighbours';
import { commitmentRef } from '../../src/lib/demo/schedule';
import { toUtcStamp } from '../../src/lib/time/iso';
import { makeDeps, run, runStates, richWeek } from '../support/demo-harness';

const deps = makeDeps();
const starter = richWeek();
const octets = (text: string): number => new TextEncoder().encode(text).length;
const BACKSLASH = String.fromCharCode(92);

function parse(text: string): ICAL.Component {
  return new ICAL.Component(ICAL.parse(text) as unknown[]);
}

describe('toUtcStamp', () => {
  test('writes the instant in UTC, or null for a value that is not a date-time', () => {
    expect(toUtcStamp('2026-11-30T18:00:00-08:00')).toBe('20261201T020000Z');
    expect(toUtcStamp('2026-12-01T10:00:00Z')).toBe('20261201T100000Z');
    expect(toUtcStamp('2026-02-30T10:00:00Z')).toBeNull();
  });
});

describe('escapeText and foldLine', () => {
  test('escape backslash, semicolon, comma and every kind of line break', () => {
    expect(escapeText(`a${BACKSLASH}b;c,d\ne\r\nf\rg`)).toBe(
      `a${BACKSLASH}${BACKSLASH}b${BACKSLASH};c${BACKSLASH},d${BACKSLASH}ne${BACKSLASH}nf${BACKSLASH}ng`,
    );
    expect(escapeText('plain')).toBe('plain');
  });

  test('fold at 75 octets with a leading space, never inside a character', () => {
    expect(foldLine('short')).toEqual(['short']);
    expect(foldLine('')).toEqual(['']);
    const folded = foldLine('x'.repeat(200));
    expect(folded.map(octets)).toEqual([75, 75, 52]);
    expect(folded[1]?.startsWith(' ')).toBe(true);
    const wide = foldLine('é'.repeat(100));
    for (const line of wide) {
      expect(octets(line)).toBeLessThanOrEqual(75);
    }
    expect(wide.map((l) => l.trim()).join('')).toBe('é'.repeat(100));
  });
});

describe('the sample calendar of the starter week', () => {
  const text = demoCalendarText(starter, deps);

  test('is a CRLF file with the version, the product id and one event per commitment', () => {
    expect(text.endsWith('\r\n')).toBe(true);
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(text).toContain('VERSION:2.0\r\n');
    expect(text).toContain(`PRODID:${PRODID}\r\n`);
    expect(parse(text).getAllSubcomponents('vevent')).toHaveLength(4);
  });

  test('uses the fixed demo instant and .invalid UIDs', () => {
    expect(text.match(/DTSTAMP:(\S+)/g)).toEqual(
      Array.from({ length: 4 }, () => 'DTSTAMP:20261130T020000Z'),
    );
    for (const event of demoCalendarEvents(starter, deps)) {
      expect(event.uid.endsWith(`@${UID_DOMAIN}`)).toBe(true);
    }
    expect(UID_DOMAIN.endsWith('.invalid')).toBe(true);
    expect(demoCalendarText(starter, deps)).toBe(text);
  });

  test('gives each reserved session a Boarding closes alarm and a Leave now alarm when the walk is known', () => {
    const events = demoCalendarEvents(starter, deps);
    const byUid: Record<string, (typeof events)[number]> = {};
    for (const e of events) {
      byUid[e.uid.split('@')[0] as string] = e;
    }
    expect(byUid['INV530-R1']?.alarms).toEqual([
      { minutesBeforeStart: 10, description: 'Boarding closes' },
    ]);
    const comfortable = makeDeps({
      connectionsForDay: () => ({
        status: 'ok',
        connections: [
          {
            from: 'INV530-R1',
            to: 'CMP325-R',
            result: { classification: 'comfortable', walkingMinutes: 10, reason: 'x' },
          },
          {
            from: 'CMP325-R',
            to: 'AIM433',
            result: { classification: 'comfortable', walkingMinutes: 40, reason: 'y' },
          },
        ],
        skipped: [],
      }),
    });
    const walked = demoCalendarEvents(starter, comfortable);
    const leaving = walked.find((e) => e.uid.startsWith('AIM433@'));
    expect(leaving?.alarms).toEqual([
      { minutesBeforeStart: 10, description: 'Boarding closes' },
      { minutesBeforeStart: 50, description: 'Leave now' },
    ]);
    expect(leaving?.description).toContain('walk plus buffer: 40 minutes');
    expect(byUid['INV530-R1']?.description).toContain(
      'The walk from the previous session is unknown',
    );
    expect(byUid['INV530-R1']?.description).toContain('Real session');
    expect(byUid['INV530-R1']?.description).toContain('Unofficial. Your badge is your ticket.');
  });

  test('no Leave now alarm when the connection is impossible, and the description says so (QA L4)', () => {
    const impossible = makeDeps({
      connectionsForDay: () => ({
        status: 'ok',
        connections: [
          {
            from: 'INV530-R1',
            to: 'CMP325-R',
            result: { classification: 'impossible', walkingMinutes: 75, reason: 'x' },
          },
          {
            from: 'CMP325-R',
            to: 'AIM433',
            result: { classification: 'tight', walkingMinutes: 75, reason: 'y' },
          },
        ],
        skipped: [],
      }),
    });
    const events = demoCalendarEvents(starter, impossible);
    const byCode = (code: string) => events.find((e) => e.summary.startsWith(code));
    expect(byCode('CMP325-R')?.alarms).toEqual([
      { minutesBeforeStart: 10, description: 'Boarding closes' },
    ]);
    expect(byCode('CMP325-R')?.description).toContain(
      'does not fit in the time available, so there is no Leave now alarm',
    );
    expect(byCode('AIM433')?.alarms.map((a) => a.description)).toEqual([
      'Boarding closes',
      'Leave now',
    ]);
  });

  test('summary, location and personal time', () => {
    const withLayover = run(
      [
        { type: 'loadStarter' },
        {
          type: 'addLayover',
          start: '2026-12-04T14:00:00-08:00',
          end: '2026-12-04T14:30:00-08:00',
        },
        { type: 'add', sessionId: 'ACT053' },
      ],
      deps,
    );
    const events = demoCalendarEvents(withLayover, deps);
    const layover = events.find((e) => e.summary === 'Layover');
    expect(layover?.alarms).toEqual([]);
    expect(layover?.uid).toBe(`layover-2026-12-04T14-00-00-08-00@${UID_DOMAIN}`);
    expect(layover?.location).toBe('Venue not published');
    expect(layover?.description).toContain('Sample layover');
    const lone = demoCalendarEvents(run([{ type: 'add', sessionId: 'ACT053' }], deps), deps);
    expect(lone[0]?.location).toBe('Venue not published');
    expect(events.find((e) => e.summary.startsWith('TNC334-R'))?.location).toContain(
      'Caesars Palace',
    );
  });

  test('sessions missing from the catalog still make an event named by title or key', () => {
    const state: DemoState = {
      commitments: [
        {
          kind: 'reservedSession',
          sessionId: 'gone',
          startsAt: '2026-12-01T09:00:00-08:00',
          endsAt: '2026-12-01T09:30:00-08:00',
          title: 'Titled',
          venue: 'Wynn',
        },
        {
          kind: 'reservedSession',
          sessionId: 'gone2',
          startsAt: '2026-12-01T10:00:00-08:00',
          endsAt: '2026-12-01T10:30:00-08:00',
        },
      ],
      pending: null,
      swap: null,
      selectedPassSessionId: null,
      announcement: '',
    };
    const events = demoCalendarEvents(state, deps);
    expect(events.map((e) => e.summary)).toEqual(['Titled', 'gone2']);
    expect(events[0]?.location).toBe('Wynn');
  });

  test('an empty week is a valid calendar with no event', () => {
    const empty = serialiseCalendar([], '20261130T020000Z');
    expect(parse(empty).getAllSubcomponents('vevent')).toHaveLength(0);
  });
});

describe('Property 15: The sample calendar is valid RFC 5545 with the right alarms', () => {
  // Feature: showcase-site, Property 15: The sample calendar is valid RFC 5545 with the right alarms
  const actionArb: fc.Arbitrary<DemoAction> = fc.oneof(
    { weight: 1, arbitrary: fc.constant<DemoAction>({ type: 'loadStarter' }) },
    {
      weight: 4,
      arbitrary: fc
        .constantFrom(...DEMO_SESSIONS.map((s) => s.sessionId))
        .map((sessionId): DemoAction => ({ type: 'add', sessionId })),
    },
    { weight: 2, arbitrary: fc.constant<DemoAction>({ type: 'confirmWarn' }) },
    { weight: 1, arbitrary: fc.constant<DemoAction>({ type: 'advanceSwap' }) },
    { weight: 1, arbitrary: fc.constant<DemoAction>({ type: 'startSwap' }) },
    {
      weight: 1,
      arbitrary: fc
        .constantFrom('2026-12-04T14:00:00-08:00', '2026-12-01T13:00:00-08:00')
        .map((start): DemoAction => ({
          type: 'addLayover',
          start,
          end: start.replace(':00:00-', ':30:00-'),
        })),
    },
  );

  test('the file parses, uses CRLF only and never exceeds 75 octets a line', () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 16 }), (actions) => {
        const state = runStates(actions, deps).at(-1) ?? starter;
        const text = demoCalendarText(state, deps);
        expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
        for (const line of text.split('\r\n')) {
          expect(octets(line)).toBeLessThanOrEqual(75);
        }
        const events = parse(text).getAllSubcomponents('vevent');
        expect(events).toHaveLength(state.commitments.length);
        for (const event of events) {
          expect(event.getFirstPropertyValue('dtstamp')?.toString()).toBe('2026-11-30T02:00:00Z');
          expect(String(event.getFirstPropertyValue('uid')).endsWith('.invalid')).toBe(true);
        }
      }),
      { numRuns: 150 },
    );
  });

  test('alarms: Boarding closes at 10, Leave now at 10 plus the walk exactly when it is known, none for personal time', () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 16 }), (actions) => {
        const state = runStates(actions, deps).at(-1) ?? starter;
        const events = parse(demoCalendarText(state, deps)).getAllSubcomponents('vevent');
        state.commitments.forEach((commitment, index) => {
          const alarms = events[index]?.getAllSubcomponents('valarm') ?? [];
          const seen = alarms.map((a) => [
            String(a.getFirstPropertyValue('description')),
            -(a.getFirstPropertyValue('trigger') as ICAL.Duration).toSeconds() / 60,
          ]);
          if (commitment.kind === 'personalTime') {
            expect(seen).toEqual([]);
            return;
          }
          const previous = neighboursOf(commitmentRef(commitment), state, deps).previous;
          const walk = previous?.walkMinutes ?? null;
          const impossible = previous?.walkClass === 'impossible';
          expect(seen).toEqual(
            walk === null || impossible
              ? [['Boarding closes', 10]]
              : [
                  ['Boarding closes', 10],
                  ['Leave now', 10 + walk],
                ],
          );
          const description = String(events[index]?.getFirstPropertyValue('description'));
          expect(description.includes('The walk from the previous session is unknown')).toBe(
            walk === null,
          );
          expect(description.includes('does not fit in the time available')).toBe(
            walk !== null && impossible,
          );
        });
      }),
      { numRuns: 150 },
    );
  });

  test('summaries round trip through escaping, for any text', () => {
    const alphabet = ['a', 'Z', '0', ' ', ',', ';', BACKSLASH, '\n', 'é', '中', '😀', ':', '-'];
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...alphabet), { minLength: 1, maxLength: 120 }),
        (chars) => {
          const summary = chars.join('');
          const text = serialiseCalendar(
            [
              {
                uid: 'x@demo.invalid',
                start: DEMO_EVENT.windowStart,
                end: '2026-12-01T01:00:00-08:00',
                summary,
                location: summary,
                description: summary,
                alarms: [],
              },
            ],
            '20261130T020000Z',
          );
          expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
          for (const line of text.split('\r\n')) {
            expect(octets(line)).toBeLessThanOrEqual(75);
          }
          const event = parse(text).getFirstSubcomponent('vevent');
          expect(event?.getFirstPropertyValue('summary')).toBe(summary);
          expect(event?.getFirstPropertyValue('description')).toBe(summary);
        },
      ),
      { numRuns: 300 },
    );
  });
});
