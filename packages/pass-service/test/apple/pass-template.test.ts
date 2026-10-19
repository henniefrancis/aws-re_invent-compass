import fc from 'fast-check';
import { describe, expect, test, vi } from 'vitest';
import {
  DISCLAIMER,
  INDEPENDENT_NOTICE,
  PASS_COLOURS,
  boardingClosesAt,
  buildPassJson,
  NO_ROOM,
  relevantInterval,
  shortRoom,
  type PassTemplateInput,
} from '../../src/apple/pass-template.js';
import {
  formatEventDate,
  formatEventDayTime,
  formatEventDayTime24,
  formatEventTime,
  formatEventTime24,
  timezoneAbbreviation,
  timezoneName,
} from '../../src/apple/format-time.js';
import { deriveAuthToken } from '../../src/security/auth-token.js';
import { passFieldsArb, samplePassFields, TEST_WINDOW } from '../helpers/pass-fields.js';

const TZ = TEST_WINDOW.timezone;
const URL_BASE = 'https://d111111abcdef8.cloudfront.net/api/passkit';
const APPLE = { passTypeIdentifier: 'pass.test.compass', teamIdentifier: 'TESTTEAM01' };
const MINUTE = 60_000;

function input(
  fields = samplePassFields(),
  extra: Partial<PassTemplateInput> = {},
): PassTemplateInput {
  return {
    serialNumber: '11111111-1111-4111-8111-111111111111',
    fields,
    authToken: deriveAuthToken(
      'pepper-pepper-pepper',
      '11111111-1111-4111-8111-111111111111',
      'salt',
    ),
    webServiceUrl: URL_BASE,
    timezone: TZ,
    apple: APPLE,
    status: 'active',
    ...extra,
  } as PassTemplateInput;
}

/** An independent 24-hour formatter for the expected values. */
function expectedTime(ms: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(new Date(ms))
    .replace(/ /g, ' ');
}

// Property tests do real work (signing, TLS, many records) and the machine may be busy.
vi.setConfig({ testTimeout: 120_000 });

describe('Feature: pass-service, time formatting', () => {
  test('times are in the event timezone, and the zone is named generically', () => {
    expect(formatEventTime('2026-12-02T10:20:00-08:00', TZ)).toBe('10:20 AM');
    expect(formatEventTime('2026-12-02T18:20:00Z', TZ)).toBe('10:20 AM');
    expect(formatEventDayTime('2026-12-02T10:30:00-08:00', TZ)).toBe('Wed 10:30 AM');
    expect(timezoneName('2026-12-02T10:30:00-08:00', TZ)).toBe('Pacific Time');
    expect(formatEventTime('2026-12-02T12:00:00Z', 'Africa/Johannesburg')).toBe('2:00 PM');
  });

  test('the Apple pass uses 24-hour times, a full date and the zone abbreviation (tasks 32 and 35)', () => {
    expect(formatEventTime24('2026-12-03T13:00:00-08:00', TZ)).toBe('13:00');
    expect(formatEventTime24('2026-11-30T09:50:00-08:00', TZ)).toBe('09:50');
    expect(formatEventTime24('2026-12-01T08:05:00Z', TZ)).toBe('00:05');
    expect(formatEventDayTime24('2026-12-02T12:00:00-08:00', TZ)).toBe('Wed 12:00');
    expect(formatEventDate('2026-12-03T13:00:00-08:00', TZ)).toBe('Thu, 3 Dec 2026');
    // 07:30 UTC on 1 December is still 30 November in Las Vegas.
    expect(formatEventDate('2026-12-01T07:30:00Z', TZ)).toBe('Mon, 30 Nov 2026');
    expect(timezoneAbbreviation('2026-12-03T13:00:00-08:00', TZ)).toBe('PST');
  });
});

describe('Feature: pass-service, pass template', () => {
  test('boarding closes 10 minutes before the start and the interval runs 40 minutes before to the end', () => {
    expect(boardingClosesAt('2026-12-02T10:00:00-08:00')).toBe('2026-12-02T17:50:00.000Z');
    expect(relevantInterval(samplePassFields())).toEqual({
      startDate: '2026-12-02T17:20:00.000Z',
      endDate: '2026-12-02T19:00:00.000Z',
    });
  });

  test('an empty room reads Room not published as the gate and an empty venue Venue not published', () => {
    const json = buildPassJson(input(samplePassFields({ venue: '', room: '' })));
    const gate = json.boardingPass.primaryFields.find((f) => f.key === 'gate');
    expect(gate).toEqual({ key: 'gate', label: 'GATE', value: NO_ROOM });
    const venue = json.boardingPass.auxiliaryFields.find((f) => f.key === 'venue');
    expect(venue?.value).toBe('Venue not published');
    expect(json.boardingPass.backFields.some((f) => f.key === 'roomFull')).toBe(false);
  });

  test('the front reads session code, boarding closes and the room as gate, title, then date, time and venue (task 35)', () => {
    const json = buildPassJson(
      input(
        samplePassFields({
          sessionCode: 'MAM411',
          title: 'Best Practices for .NET modernization with AWS Transform',
          venue: 'Caesars Palace',
          room: 'Promenade South, Octavius 4',
          startsAt: '2026-12-03T13:00:00-08:00',
          endsAt: '2026-12-03T14:00:00-08:00',
        }),
      ),
    );
    const row = (fields: { label: string; value: string }[]) =>
      fields.map((f) => `${f.label}=${f.value}`);
    expect(row(json.boardingPass.headerFields)).toEqual(['SESSION=MAM411']);
    expect(row(json.boardingPass.primaryFields)).toEqual([
      'BOARDING CLOSES=12:50',
      'GATE=Octavius 4',
    ]);
    expect(row(json.boardingPass.secondaryFields)).toEqual([
      'TITLE=Best Practices for .NET modernization with AWS Transform',
    ]);
    expect(row(json.boardingPass.auxiliaryFields)).toEqual([
      'DATE=Thu, 3 Dec 2026',
      'TIME=13:00-14:00 PST',
      'VENUE=Caesars Palace',
    ]);
    expect(json.boardingPass.auxiliaryFields.map((f) => f.textAlignment)).toEqual([
      undefined,
      'PKTextAlignmentCenter',
      'PKTextAlignmentRight',
    ]);
    expect('logoText' in json).toBe(false);
    expect(json.boardingPass.backFields[0]).toEqual({
      key: 'roomFull',
      label: 'ROOM',
      value: 'Promenade South, Octavius 4',
    });
  });

  test('the colours are the owner choice: #232F3F, white values, #A166FF labels (task 35)', () => {
    const json = buildPassJson(input());
    expect(json.backgroundColor).toBe('rgb(35, 47, 63)');
    expect(json.foregroundColor).toBe('rgb(255, 255, 255)');
    expect(json.labelColor).toBe('rgb(161, 102, 255)');
    const rgb = (value: string) => value.match(/\d+/g)!.map(Number);
    const channel = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (value: string) => {
      const [r, g, b] = rgb(value) as [number, number, number];
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
      return (hi + 0.05) / (lo + 0.05);
    };
    // White values measure 13.6:1; the #A166FF labels 3.78:1, under WCAG AA 4.5:1 and
    // accepted by the owner (design, "Post-SP3 change: pass review 3"). The pins make any
    // further drop a visible change.
    expect(contrast(json.foregroundColor, json.backgroundColor)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(json.labelColor, json.backgroundColor)).toBeCloseTo(3.78, 1);
    expect(PASS_COLOURS.background).toBe(json.backgroundColor);
  });

  test('the short room is the part after the first comma, or the whole room', () => {
    expect(shortRoom('Level 1, Academy 409')).toBe('Academy 409');
    expect(shortRoom('Promenade South, Octavius 4, Content Hub')).toBe('Octavius 4');
    expect(shortRoom('Ballroom E')).toBe('Ballroom E');
    expect(shortRoom(' , Hall B')).toBe('Hall B');
    expect(shortRoom('')).toBe('');
  });

  test('walk and next connection appear on the back, with fallbacks for empty venues', () => {
    const fields = samplePassFields({
      walkFromPrevious: { minutes: 12, fromVenue: '' },
      nextConnection: {
        sessionCode: 'NXT101',
        startsAt: '2026-12-02T12:00:00-08:00',
        venue: '',
        walkMinutes: 7,
      },
    });
    const back = buildPassJson(input(fields)).boardingPass.backFields;
    expect(back.find((f) => f.key === 'walk')?.value).toBe('12 min from the previous venue');
    expect(back.find((f) => f.key === 'next')?.value).toBe(
      'NXT101 at Wed 12:00, venue not published, 7 min walk',
    );
    const named = buildPassJson(
      input(
        samplePassFields({
          walkFromPrevious: { minutes: 3, fromVenue: 'Hall A' },
          nextConnection: {
            sessionCode: 'NXT101',
            startsAt: '2026-12-02T12:00:00-08:00',
            venue: 'Hall B',
            walkMinutes: 4,
          },
        }),
      ),
    ).boardingPass.backFields;
    expect(named.find((f) => f.key === 'walk')?.value).toBe('3 min from Hall A');
    expect(named.find((f) => f.key === 'next')?.value).toContain('Hall B');
  });

  test('a voided pass is marked voided and expires at the void instant', () => {
    const json = buildPassJson(
      input(samplePassFields(), { status: 'voided', voidedAt: '2026-12-01T09:00:00.123Z' }),
    );
    expect(json.voided).toBe(true);
    expect(json.expirationDate).toBe('2026-12-01T09:00:00.123Z');
    expect('voided' in buildPassJson(input())).toBe(false);
  });

  // Feature: pass-service, Property 13: Every Apple pass.json follows the fixed template
  test('Property 13: every pass.json follows the fixed template', () => {
    fc.assert(
      fc.property(
        passFieldsArb,
        fc.boolean(),
        fc.integer({
          min: Date.parse('2026-11-01T00:00:00Z'),
          max: Date.parse('2026-12-20T00:00:00Z'),
        }),
        fc.stringMatching(/^[a-z0-9]{8}$/),
        (fields, voided, voidMs, salt) => {
          const serial = '22222222-2222-4222-8222-222222222222';
          const authToken = deriveAuthToken('pepper-pepper-pepper', serial, salt);
          const template = {
            serialNumber: serial,
            fields,
            authToken,
            webServiceUrl: URL_BASE,
            timezone: TZ,
            apple: APPLE,
            ...(voided
              ? { status: 'voided' as const, voidedAt: new Date(voidMs).toISOString() }
              : { status: 'active' as const }),
          };
          const json = buildPassJson(template);
          const text = JSON.stringify(json);
          const startMs = Date.parse(fields.startsAt);
          const endMs = Date.parse(fields.endsAt);

          expect(Object.keys(json.boardingPass).sort()).toEqual([
            'auxiliaryFields',
            'backFields',
            'headerFields',
            'primaryFields',
            'secondaryFields',
            'transitType',
          ]);
          expect(json.boardingPass.transitType).toBe('PKTransitTypeGeneric');
          // Requirement 9.2 as amended (task 34): the disclaimer is on the back, not the front.
          expect(json.boardingPass.auxiliaryFields.some((f) => f.value === DISCLAIMER)).toBe(false);
          expect(json.boardingPass.backFields.some((f) => f.value === DISCLAIMER)).toBe(true);
          expect(json.organizationName).toMatch(/unofficial/i);
          expect(json.description).toMatch(/unofficial/i);
          expect(json.boardingPass.backFields.some((f) => f.value === INDEPENDENT_NOTICE)).toBe(
            true,
          );
          expect(text).not.toMatch(/barcode/i);
          expect(json.sharingProhibited).toBe(true);
          expect(json.formatVersion).toBe(1);
          expect(json.passTypeIdentifier).toBe(APPLE.passTypeIdentifier);
          expect(json.teamIdentifier).toBe(APPLE.teamIdentifier);
          expect(json.serialNumber).toBe(serial);
          expect(json.webServiceURL).toBe(URL_BASE);
          expect(json.authenticationToken).toBe(authToken);
          expect(json.authenticationToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

          const expectedExpiry = new Date(voided ? voidMs : endMs).toISOString();
          expect(json.expirationDate).toBe(expectedExpiry);
          expect(json.expirationDate).toHaveLength(24);
          expect(json.voided).toBe(voided ? true : undefined);

          expect(json.relevantDates).toEqual([
            {
              startDate: new Date(startMs - 40 * MINUTE).toISOString(),
              endDate: new Date(endMs).toISOString(),
            },
          ]);
          expect(json.boardingPass.headerFields).toEqual([
            { key: 'session', label: 'SESSION', value: fields.sessionCode },
          ]);
          expect(json.boardingPass.primaryFields).toEqual([
            {
              key: 'boardingCloses',
              label: 'BOARDING CLOSES',
              value: expectedTime(startMs - 10 * MINUTE),
            },
            {
              key: 'gate',
              label: 'GATE',
              value: shortRoom(fields.room) === '' ? NO_ROOM : shortRoom(fields.room),
            },
          ]);
          const aux = json.boardingPass.auxiliaryFields;
          expect(aux.map((f) => f.key)).toEqual(['date', 'time', 'venue']);
          expect(aux[2]?.value).toBe(fields.venue === '' ? 'Venue not published' : fields.venue);
          expect(aux[0]?.value).toMatch(/^[A-Z][a-z]{2}, \d{1,2} [A-Z][a-z]{2} 2026$/);
          // An independent zone name: early November sessions can still be in daylight time.
          const zone = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'short' })
            .formatToParts(new Date(startMs))
            .find((part) => part.type === 'timeZoneName')?.value;
          expect(aux[1]?.value).toBe(`${expectedTime(startMs)}-${expectedTime(endMs)} ${zone}`);
          expect(json.boardingPass.secondaryFields[0]?.value).toBe(fields.title);
          const name = json.boardingPass.backFields.find((f) => f.key === 'name');
          expect(name?.value).toBe(fields.attendeeName);
          expect(name === undefined).toBe(fields.attendeeName === undefined);
          const keys = [
            ...json.boardingPass.headerFields,
            ...json.boardingPass.primaryFields,
            ...json.boardingPass.secondaryFields,
            ...json.boardingPass.auxiliaryFields,
            ...json.boardingPass.backFields,
          ].map((f) => f.key);
          expect(new Set(keys).size).toBe(keys.length);
        },
      ),
      { numRuns: 300 },
    );
  });
});
