import fc from 'fast-check';
import { describe, expect, test, vi } from 'vitest';
import {
  DISCLAIMER,
  INDEPENDENT_NOTICE,
  boardingClosesAt,
  buildPassJson,
  relevantInterval,
  type PassTemplateInput,
} from '../../src/apple/pass-template.js';
import { formatEventDayTime, formatEventTime, timezoneName } from '../../src/apple/format-time.js';
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

/** An independent formatter for the expected values. */
function expectedTime(ms: number): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })
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
});

describe('Feature: pass-service, pass template', () => {
  test('boarding closes 10 minutes before the start and the interval runs 40 minutes before to the end', () => {
    expect(boardingClosesAt('2026-12-02T10:00:00-08:00')).toBe('2026-12-02T17:50:00.000Z');
    expect(relevantInterval(samplePassFields())).toEqual({
      startDate: '2026-12-02T17:20:00.000Z',
      endDate: '2026-12-02T19:00:00.000Z',
    });
  });

  test('an empty venue reads Venue not published and an empty room is left out', () => {
    const json = buildPassJson(input(samplePassFields({ venue: '', room: '' })));
    const gate = json.boardingPass.primaryFields.find((f) => f.key === 'gate');
    expect(gate?.value).toBe('Venue not published');
    expect(json.boardingPass.auxiliaryFields.some((f) => f.key === 'room')).toBe(false);
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
      'NXT101 at Wed 12:00 PM, venue not published, 7 min walk',
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
          expect(json.boardingPass.auxiliaryFields.some((f) => f.value === DISCLAIMER)).toBe(true);
          expect(json.boardingPass.backFields.some((f) => f.value === DISCLAIMER)).toBe(true);
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
            {
              key: 'boardingCloses',
              label: 'BOARDING CLOSES',
              value: expectedTime(startMs - 10 * MINUTE),
            },
          ]);
          const gate = json.boardingPass.primaryFields.find((f) => f.key === 'gate');
          expect(gate?.value).toBe(fields.venue === '' ? 'Venue not published' : fields.venue);
          expect(json.boardingPass.primaryFields.find((f) => f.key === 'session')?.value).toBe(
            fields.sessionCode,
          );
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
