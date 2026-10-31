import fc from 'fast-check';
import { describe, expect, test, vi } from 'vitest';
import {
  ARROW,
  EVENT_REGION,
  INDEPENDENT_NOTICE,
  PASS_COLOURS,
  PLANS_NOTICE,
  PRIVACY_NOTICE,
  SEAT_RULE,
  UNOFFICIAL_NOTICE,
  WALLET_GROUP_ID,
  boardingClosesAt,
  buildPassJson,
  NO_ROOM,
  NO_VENUE,
  passSemantics,
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

  test('the Apple pass uses 24-hour times and a day, month and year date (tasks 32 and 36)', () => {
    expect(formatEventTime24('2026-12-03T13:00:00-08:00', TZ)).toBe('13:00');
    expect(formatEventTime24('2026-11-30T09:50:00-08:00', TZ)).toBe('09:50');
    expect(formatEventTime24('2026-12-01T08:05:00Z', TZ)).toBe('00:05');
    expect(formatEventDayTime24('2026-12-02T12:00:00-08:00', TZ)).toBe('Wed 12:00');
    expect(formatEventDate('2026-12-03T13:00:00-08:00', TZ)).toBe('3 Dec 2026');
    // 07:30 UTC on 1 December is still 30 November in Las Vegas.
    expect(formatEventDate('2026-12-01T07:30:00Z', TZ)).toBe('30 Nov 2026');
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
    const [terminal, , gate] = json.eventTicket.secondaryFields;
    expect(gate).toEqual({
      key: 'gate',
      label: 'GATE',
      value: NO_ROOM,
      textAlignment: 'PKTextAlignmentRight',
    });
    expect(terminal).toEqual({
      key: 'terminal',
      label: 'TERMINAL',
      value: 'Venue not published',
      textAlignment: 'PKTextAlignmentLeft',
    });
    expect(json.eventTicket.backFields.some((f) => f.key === 'roomFull')).toBe(false);
  });

  test("the front is the owner's Pass Designer layout (task 44)", () => {
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
    const row = (fields: { label?: string; value: string; textAlignment?: string }[]) =>
      fields.map((f) => `${f.label ?? ''}=${f.value} (${f.textAlignment ?? 'none'})`);
    expect('logoText' in json).toBe(false);
    expect('posterGeneric' in json).toBe(false);
    expect('preferredStyleSchemes' in json).toBe(false);
    expect(json.organizationName).toBe('AWS Community South Africa');
    expect(json.description).toBe('Unofficial Boarding Pass');
    expect(row(json.eventTicket.headerFields)).toEqual(['SESSION=MAM411 (PKTextAlignmentNatural)']);
    expect(row(json.eventTicket.primaryFields)).toEqual([
      'FLIGHT NAME=Best Practices for .NET modernization with AWS Transform (PKTextAlignmentNatural)',
    ]);
    expect(ARROW).toBe('→');
    expect(row(json.eventTicket.secondaryFields)).toEqual([
      'TERMINAL=Caesars Palace (PKTextAlignmentLeft)',
      `=${ARROW} (PKTextAlignmentCenter)`,
      'GATE=Octavius 4 (PKTextAlignmentRight)',
    ]);
    // The arrow carries no label at all, as in the design.
    expect('label' in (json.eventTicket.secondaryFields[1] ?? {})).toBe(false);
    expect(row(json.eventTicket.auxiliaryFields)).toEqual([
      'DATE=3 Dec 2026 | 13:00-14:00 (PKTextAlignmentLeft)',
      'BOARDING CLOSES=12:50 (PKTextAlignmentNatural)',
    ]);
  });

  test("the back is the owner's Pass Designer order with the per-pass fields (task 44)", () => {
    const full = buildPassJson(
      input(
        samplePassFields({
          room: 'Promenade South, Octavius 4',
          walkFromPrevious: { minutes: 12, fromVenue: 'Caesars Forum' },
          nextConnection: {
            sessionCode: 'DVT323-R',
            startsAt: '2026-12-02T14:30:00-08:00',
            venue: 'Caesars Forum',
            walkMinutes: 8,
          },
          attendeeName: 'Sam Example',
        }),
      ),
    );
    expect(full.eventTicket.backFields.map((f) => f.key)).toEqual([
      'about',
      'unofficial',
      'seatRule',
      'roomFull',
      'walk',
      'next',
      'name',
      'timezone',
      'plans',
      'privacy',
    ]);
    const value = (key: string) => full.eventTicket.backFields.find((f) => f.key === key)?.value;
    expect(value('about')).toBe(INDEPENDENT_NOTICE);
    expect(value('unofficial')).toBe(UNOFFICIAL_NOTICE);
    expect(value('seatRule')).toBe(SEAT_RULE);
    expect(value('plans')).toBe(PLANS_NOTICE);
    expect(value('privacy')).toBe(PRIVACY_NOTICE);
    expect(value('roomFull')).toBe('Promenade South, Octavius 4');
    expect(value('walk')).toBe('12 min from Caesars Forum');
    expect(UNOFFICIAL_NOTICE).toContain('This is not a ticket');
    expect(INDEPENDENT_NOTICE).toContain('re:Invent Catalog API Builder Challenge');
    // Without the per-pass data the fixed fields stay, in the same order.
    const bare = buildPassJson(input(samplePassFields({ room: '' })));
    const keys = bare.eventTicket.backFields.map((f) => f.key);
    expect(keys.slice(0, 3)).toEqual(['about', 'unofficial', 'seatRule']);
    expect(keys.slice(-3)).toEqual(['timezone', 'plans', 'privacy']);
    expect(keys).not.toContain('roomFull');
  });

  test('the poster semantics name the event, venue, Las Vegas and the full room (task 42)', () => {
    const fields = samplePassFields({
      title: 'Building agents',
      venue: 'Caesars Palace',
      room: 'Promenade South, Octavius 4',
      startsAt: '2026-12-03T13:00:00-08:00',
      endsAt: '2026-12-03T14:00:00-08:00',
    });
    expect(passSemantics(fields)).toEqual({
      eventType: 'PKEventTypeGeneric',
      eventName: 'Building agents',
      venueName: 'Caesars Palace',
      venueRegionName: 'Las Vegas',
      venueRoom: 'Promenade South, Octavius 4',
      eventStartDate: '2026-12-03T21:00:00.000Z',
      eventEndDate: '2026-12-03T22:00:00.000Z',
    });
    const unknown = passSemantics(samplePassFields({ venue: '', room: '' }));
    expect(unknown.venueName).toBe('Venue not published');
    expect(unknown.venueRoom).toBe('Room not published');
    const json = buildPassJson(input(fields));
    expect(json.semantics).toEqual(passSemantics(fields));
  });

  test("the colours are the owner's Pass Designer choice: black, white values, orange labels (task 44)", () => {
    const json = buildPassJson(input());
    expect(json.backgroundColor).toBe('rgb(0, 0, 0)');
    expect(json.foregroundColor).toBe('rgb(254, 255, 255)');
    expect(json.labelColor).toBe('rgb(240, 151, 64)');
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
    // Both pass WCAG AA 4.5:1 on black: white values about 21:1, the orange labels about 9.2:1.
    expect(contrast(json.foregroundColor, json.backgroundColor)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(json.labelColor, json.backgroundColor)).toBeGreaterThanOrEqual(4.5);
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
    const back = buildPassJson(input(fields)).eventTicket.backFields;
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
    ).eventTicket.backFields;
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

          // Task 44: the owner's Pass Designer event ticket only: no poster style, no transit type.
          expect(Object.keys(json.eventTicket).sort()).toEqual([
            'auxiliaryFields',
            'backFields',
            'headerFields',
            'primaryFields',
            'secondaryFields',
          ]);
          expect('posterGeneric' in json).toBe(false);
          expect('boardingPass' in json).toBe(false);
          expect(text).not.toContain('transitType');
          expect('preferredStyleSchemes' in json).toBe(false);
          expect(json.semantics).toEqual({
            eventType: 'PKEventTypeGeneric',
            eventName: fields.title,
            venueName: fields.venue === '' ? NO_VENUE : fields.venue,
            venueRegionName: EVENT_REGION,
            venueRoom: fields.room === '' ? NO_ROOM : fields.room,
            eventStartDate: new Date(startMs).toISOString(),
            eventEndDate: new Date(endMs).toISOString(),
          });
          // Requirement 9.2 as amended (task 44): the unofficial notice and the independence
          // line are on the back; the issuer is the owner's company.
          expect(json.eventTicket.backFields.some((f) => f.value === UNOFFICIAL_NOTICE)).toBe(true);
          expect(json.eventTicket.backFields.some((f) => f.value === INDEPENDENT_NOTICE)).toBe(
            true,
          );
          expect(json.organizationName).toBe('AWS Community South Africa');
          expect(json.description).toMatch(/unofficial/i);
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
          expect('logoText' in json).toBe(false);
          expect(json.eventTicket.headerFields).toEqual([
            {
              key: 'session',
              label: 'SESSION',
              value: fields.sessionCode,
              textAlignment: 'PKTextAlignmentNatural',
            },
          ]);
          expect(json.eventTicket.primaryFields).toEqual([
            {
              key: 'title',
              label: 'FLIGHT NAME',
              value: fields.title,
              textAlignment: 'PKTextAlignmentNatural',
            },
          ]);
          expect(json.eventTicket.secondaryFields).toEqual([
            {
              key: 'terminal',
              label: 'TERMINAL',
              value: fields.venue === '' ? 'Venue not published' : fields.venue,
              textAlignment: 'PKTextAlignmentLeft',
            },
            { key: 'arrow', value: ARROW, textAlignment: 'PKTextAlignmentCenter' },
            {
              key: 'gate',
              label: 'GATE',
              value: shortRoom(fields.room) === '' ? NO_ROOM : shortRoom(fields.room),
              textAlignment: 'PKTextAlignmentRight',
            },
          ]);
          const aux = json.eventTicket.auxiliaryFields;
          expect(aux.map((f) => f.key)).toEqual(['date', 'boardingCloses']);
          expect(aux[1]).toEqual({
            key: 'boardingCloses',
            label: 'BOARDING CLOSES',
            value: expectedTime(startMs - 10 * MINUTE),
            textAlignment: 'PKTextAlignmentNatural',
          });
          const [datePart, timePart] = (aux[0]?.value ?? '').split(' | ');
          expect(datePart).toMatch(/^\d{1,2} [A-Z][a-z]{2} 2026$/);
          expect(timePart).toBe(`${expectedTime(startMs)}-${expectedTime(endMs)}`);
          const name = json.eventTicket.backFields.find((f) => f.key === 'name');
          expect(name?.value).toBe(fields.attendeeName);
          expect(name === undefined).toBe(fields.attendeeName === undefined);
          const keys = [
            ...json.eventTicket.headerFields,
            ...json.eventTicket.primaryFields,
            ...json.eventTicket.secondaryFields,
            ...json.eventTicket.auxiliaryFields,
            ...json.eventTicket.backFields,
          ].map((f) => f.key);
          expect(new Set(keys).size).toBe(keys.length);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('Feature: pass-service, one wallet group for the week (task 55)', () => {
  test('the group constant is fixed and holds no attendee data', () => {
    expect(WALLET_GROUP_ID).toBe('reinvent-2026-compass');
    expect(WALLET_GROUP_ID).toMatch(/^[a-z0-9-]+$/);
  });

  test('every pass carries the same top-level groupingIdentifier, active or voided', () => {
    fc.assert(
      fc.property(passFieldsArb, (fields) => {
        const active = buildPassJson(input(fields));
        const voided = buildPassJson({
          ...input(fields),
          status: 'voided',
          voidedAt: '2026-12-01T00:00:00.000Z',
        });
        expect(active.groupingIdentifier).toBe(WALLET_GROUP_ID);
        expect(voided.groupingIdentifier).toBe(WALLET_GROUP_ID);
        expect(Object.keys(active)).toContain('groupingIdentifier');
      }),
      { numRuns: 50 },
    );
  });
});
