import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { createPassFieldsSchema } from '@compass/contracts';
import { buildPass, type BuildPassInput } from '../../src/passes/pass-builder.js';
import { PassError } from '../../src/passes/redaction.js';
import {
  NUM_RUNS,
  WINDOW,
  fakeConnections,
  hostileTextArb,
  layoverCommitment,
  makeSession,
  reservedCommitment,
  safeTextArb,
  sessionCodeArb,
  timesArb,
  visibleTextArb,
} from './support.js';

// Tests for Pass_Builder (boarding-passes, S4, Requirement 1).
//
// Properties 1, 3, 4, 5, 6 and 7 run through fast-check for at least 100 iterations
// each. Example and snapshot tests cover the fallbacks and the invalid-input errors.

const schema = createPassFieldsSchema(WINDOW);

const PREV_VENUE = 'Wynn';
const SESSION_VENUE = 'Venetian';
const NEXT_VENUE = 'MGM Grand';

const FORBIDDEN_KEYS = [
  'boardingClosesAt',
  'disclaimer',
  'expirationDate',
  'relevantDates',
  'transitType',
  'sharingProhibited',
  'barcodes',
  'barcode',
];

/** Build with no connection data unless a table is supplied. */
function build(
  input: Partial<BuildPassInput> = {},
  table: Record<string, number | undefined> = {},
) {
  return buildPass(
    { session: makeSession(), eventWindow: WINDOW, ...input },
    { connections: fakeConnections(table) },
  ).fields;
}

/** The expected walk, as the builder must produce it from a provider value. */
function clampWalk(value: number): number {
  return Math.min(90, Math.max(0, Math.round(value)));
}

describe('Feature: boarding-passes, Property 1: built fields always validate for the current window', () => {
  test('hostile text, times and adjacency always build fields the window schema accepts', () => {
    fc.assert(
      fc.property(
        hostileTextArb,
        hostileTextArb,
        hostileTextArb,
        hostileTextArb,
        sessionCodeArb,
        timesArb,
        fc.option(hostileTextArb, { nil: undefined }),
        fc.boolean(),
        fc.boolean(),
        (title, venue, room, otherVenue, code, times, name, hasPrevious, hasNext) => {
          const fields = buildPass(
            {
              session: makeSession({ title, venue, room, code, ...times }),
              previous: hasPrevious
                ? { commitment: reservedCommitment({ venue: otherVenue }) }
                : undefined,
              next: hasNext
                ? { sessionCode: 'NEXT01', startsAt: times.endsAt, venue: otherVenue }
                : undefined,
              attendeeName: name,
              eventWindow: WINDOW,
            },
            { connections: { walkMinutes: () => 7 } },
          ).fields;
          expect(schema.safeParse(fields).success).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('Feature: boarding-passes, Property 3: adjacency fields present exactly when the adjacent commitment exists', () => {
  const walkArb = fc.oneof(
    fc.constant(undefined),
    fc.integer({ min: -50, max: 200 }),
    fc.double({ min: -50, max: 200, noNaN: true }),
    fc.constant(Number.NaN),
    fc.constant(Number.POSITIVE_INFINITY),
  );

  test('walk fields appear with clamped minutes exactly when the adjacent side is known', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        walkArb,
        walkArb,
        (hasPrev, hasNext, prevWalk, nextWalk) => {
          const fields = build(
            {
              previous: hasPrev
                ? { commitment: reservedCommitment({ venue: PREV_VENUE }) }
                : undefined,
              next: hasNext
                ? {
                    sessionCode: 'NET204-R',
                    startsAt: '2026-12-01T12:00:00-08:00',
                    venue: NEXT_VENUE,
                  }
                : undefined,
            },
            {
              [`${PREV_VENUE}|${SESSION_VENUE}`]: prevWalk,
              [`${SESSION_VENUE}|${NEXT_VENUE}`]: nextWalk,
            },
          );

          const prevKnown = hasPrev && prevWalk !== undefined && Number.isFinite(prevWalk);
          if (prevKnown) {
            expect(fields.walkFromPrevious).toEqual({
              minutes: clampWalk(prevWalk),
              fromVenue: PREV_VENUE,
            });
          } else {
            expect(fields.walkFromPrevious).toBeUndefined();
          }

          const nextKnown = hasNext && nextWalk !== undefined && Number.isFinite(nextWalk);
          if (nextKnown) {
            expect(fields.nextConnection).toEqual({
              sessionCode: 'NET204-R',
              startsAt: '2026-12-01T12:00:00-08:00',
              venue: NEXT_VENUE,
              walkMinutes: clampWalk(nextWalk),
            });
          } else {
            expect(fields.nextConnection).toBeUndefined();
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('Feature: boarding-passes, Property 4: title length and ASCII ellipsis truncation', () => {
  const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
  const titleArb = fc
    .array(
      fc.oneof(
        { weight: 12, arbitrary: fc.constantFrom('a', 'B', '7', ' ', ',', '-', '(', ')', '!') },
        { weight: 1, arbitrary: fc.constantFrom('\u{1D49C}', 'é', '中', '\u{2014}', '\u{201C}') },
      ),
      { minLength: 1, maxLength: 200 },
    )
    .map((chars) => chars.join(''))
    .filter((raw) => raw.trim().length > 0);

  test('titles are at most eighty, truncated to the cut plus three ASCII full stops', () => {
    fc.assert(
      fc.property(titleArb, (raw) => {
        const normalised = raw
          .replace(/[\u{2013}\u{2014}]/gu, '-')
          .replace(/[\u{201C}\u{201D}]/gu, '"')
          .replace(/\s+/g, ' ')
          .trim();
        const { title } = build({ session: makeSession({ title: raw }) });

        expect(title.length).toBeLessThanOrEqual(80);
        expect(title).not.toContain('\u{2026}');
        expect(LONE_SURROGATE.test(title)).toBe(false);
        if (normalised.length <= 80) {
          expect(title).toBe(normalised);
        } else {
          expect(title.endsWith('...')).toBe(true);
          expect([79, 80]).toContain(title.length);
          expect(normalised.startsWith(title.slice(0, -3))).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test('a title of exactly eighty characters is kept whole', () => {
    const title = 'a'.repeat(80);
    expect(build({ session: makeSession({ title }) }).title).toBe(title);
  });

  test('a title of eighty-one characters is cut to seventy-seven plus three full stops', () => {
    const title = build({ session: makeSession({ title: 'a'.repeat(81) }) }).title;
    expect(title).toBe(`${'a'.repeat(77)}...`);
    expect(title).toHaveLength(80);
  });

  test('the cut never splits a surrogate pair', () => {
    // A 76 unit prefix then an astral letter straddles the cut at 77 units.
    const raw = `${'a'.repeat(76)}\u{1D49C}${'b'.repeat(10)}`;
    const title = build({ session: makeSession({ title: raw }) }).title;
    expect(title).toBe(`${'a'.repeat(76)}...`);
    expect(LONE_SURROGATE.test(title)).toBe(false);
  });
});

describe('Feature: boarding-passes, Property 5: attendee name present exactly when opt-in is recorded', () => {
  test('the name is present within one to forty characters only with an opt-in', () => {
    fc.assert(
      fc.property(fc.option(visibleTextArb(1, 80), { nil: undefined }), (name) => {
        const fields = build({ attendeeName: name });
        if (name === undefined) {
          expect(fields).not.toHaveProperty('attendeeName');
        } else {
          expect(fields.attendeeName).toBeDefined();
          expect(fields.attendeeName?.length).toBeGreaterThanOrEqual(1);
          expect(fields.attendeeName?.length).toBeLessThanOrEqual(40);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test('a name that is refused after normalisation is omitted, never echoed', () => {
    const fields = build({ attendeeName: 'visit https://evil.example now' });
    expect(fields).not.toHaveProperty('attendeeName');
    expect(JSON.stringify(fields)).not.toContain('evil');
  });

  test('a name that normalises to nothing is omitted', () => {
    expect(build({ attendeeName: '   ' })).not.toHaveProperty('attendeeName');
  });

  test('a long name is cut to forty characters', () => {
    expect(build({ attendeeName: 'n'.repeat(60) }).attendeeName).toBe('n'.repeat(40));
  });
});

describe('Feature: boarding-passes, Property 6: empty venue and room are sent as empty strings', () => {
  const emptyOrUndefined = fc.constantFrom('', undefined);

  test('empty or missing venue and room give empty strings and never the render-time text', () => {
    fc.assert(
      fc.property(emptyOrUndefined, emptyOrUndefined, safeTextArb(0, 40), (venue, room, other) => {
        const fields = build({
          session: makeSession({ venue, room }),
          previous: { commitment: reservedCommitment({ venue: other }) },
        });
        expect(fields.venue).toBe('');
        expect(fields.room).toBe('');
        expect(JSON.stringify(fields)).not.toContain('Venue not published');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test('a venue or room that is refused falls back to an empty string', () => {
    const fields = build({
      session: makeSession({ venue: 'Hall \u{1F600}', room: 'r'.repeat(41) }),
    });
    expect(fields.venue).toBe('');
    expect(fields.room).toBe('');
  });
});

describe('Feature: boarding-passes, Property 7: no server-derived or barcode fields in builder output', () => {
  test('none of the server-owned keys is ever present', () => {
    fc.assert(
      fc.property(
        hostileTextArb,
        timesArb,
        fc.option(visibleTextArb(1, 20), { nil: undefined }),
        (title, times, name) => {
          const fields = build(
            {
              session: makeSession({ title, ...times }),
              previous: { commitment: reservedCommitment({ venue: PREV_VENUE }) },
              next: { sessionCode: 'NET204-R', startsAt: times.endsAt, venue: NEXT_VENUE },
              attendeeName: name,
            },
            { [`${PREV_VENUE}|${SESSION_VENUE}`]: 5, [`${SESSION_VENUE}|${NEXT_VENUE}`]: 6 },
          );
          for (const key of FORBIDDEN_KEYS) {
            expect(fields).not.toHaveProperty(key);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('Feature: boarding-passes, builder snapshots (Requirement 9.1)', () => {
  test('a full pass with a previous walk, a next connection and a displayed name', () => {
    expect(
      build(
        {
          previous: { commitment: reservedCommitment({ venue: PREV_VENUE }) },
          next: {
            sessionCode: 'NET204-R',
            startsAt: '2026-12-01T12:00:00-08:00',
            venue: NEXT_VENUE,
          },
          attendeeName: 'First Timer',
        },
        { [`${PREV_VENUE}|${SESSION_VENUE}`]: 12, [`${SESSION_VENUE}|${NEXT_VENUE}`]: 9 },
      ),
    ).toMatchSnapshot();
  });

  test('a minimal pass with no venue, no room and no adjacency', () => {
    expect(
      build({ session: makeSession({ venue: undefined, room: undefined, code: 'OPS101' }) }),
    ).toMatchSnapshot();
  });

  test('a pass whose title is normalised, truncated and kept', () => {
    expect(
      build({
        session: makeSession({
          title: `Modern \u{201C}serverless\u{201D} patterns \u{2014} ${'deep dive '.repeat(10)}`,
        }),
      }),
    ).toMatchSnapshot();
  });
});

describe('Feature: boarding-passes, builder example tests', () => {
  test('a title that still fails the text rules becomes Title not shown and keeps the code', () => {
    const rejected = 'Visit https://evil.example for details';
    const fields = build({ session: makeSession({ title: rejected, code: 'SEC201' }) });
    expect(fields.title).toBe('Title not shown');
    expect(fields.sessionCode).toBe('SEC201');
    expect(JSON.stringify(fields)).not.toContain('evil');
  });

  test('a title with an emoji and one that normalises to nothing both fall back', () => {
    expect(build({ session: makeSession({ title: 'Party \u{1F389}' }) }).title).toBe(
      'Title not shown',
    );
    expect(build({ session: makeSession({ title: '  \u{A0} ' }) }).title).toBe('Title not shown');
  });

  test('an over-long title judged unsafe on its full text falls back, even when the cut would be safe', () => {
    const title = `${'a'.repeat(100)} https://evil.example`;
    expect(build({ session: makeSession({ title }) }).title).toBe('Title not shown');
  });

  test('a cut that forms a refused domain falls back to Title not shown', () => {
    // "ab.company" is safe whole, but the cut at 77 units leaves "ab.com", a domain.
    const title = `${'x'.repeat(70)} ab.company and then some more words`;
    expect(title.slice(0, 77)).toBe(`${'x'.repeat(70)} ab.com`);
    expect(build({ session: makeSession({ title }) }).title).toBe('Title not shown');
  });

  test('typographic punctuation is normalised before validation', () => {
    const fields = build({
      session: makeSession({ title: 'Don\u{2019}t \u{201C}panic\u{201D} \u{2014} plan\u{2026}' }),
    });
    expect(fields.title).toBe('Don\'t "panic" - plan...');
  });

  test('refused text on the previous and next venue falls back to an empty string', () => {
    const fields = build(
      {
        previous: { commitment: reservedCommitment({ venue: 'Hall \u{1F600}' }) },
        next: {
          sessionCode: 'NET204-R',
          startsAt: '2026-12-01T12:00:00-08:00',
          venue: 'www.example.com',
        },
      },
      { [`Hall \u{1F600}|${SESSION_VENUE}`]: 4, [`${SESSION_VENUE}|www.example.com`]: 6 },
    );
    expect(fields.walkFromPrevious).toEqual({ minutes: 4, fromVenue: '' });
    expect(fields.nextConnection).toMatchObject({ venue: '', walkMinutes: 6 });
  });

  test('a layover before the session uses its location, and a missing one is empty', () => {
    const withLocation = build(
      { previous: { commitment: layoverCommitment({ location: 'Lounge' }) } },
      { [`Lounge|${SESSION_VENUE}`]: 3 },
    );
    expect(withLocation.walkFromPrevious).toEqual({ minutes: 3, fromVenue: 'Lounge' });

    const withoutLocation = build(
      { previous: { commitment: layoverCommitment() } },
      { [`|${SESSION_VENUE}`]: 8 },
    );
    expect(withoutLocation.walkFromPrevious).toEqual({ minutes: 8, fromVenue: '' });
  });

  test('a reserved previous session with no venue is looked up with an empty venue', () => {
    const connections = fakeConnections({ [`|${SESSION_VENUE}`]: 2 });
    const { fields } = buildPass(
      {
        session: makeSession(),
        previous: { commitment: reservedCommitment({ venue: undefined }) },
        eventWindow: WINDOW,
      },
      { connections },
    );
    expect(connections.calls).toEqual([`|${SESSION_VENUE}`]);
    expect(fields.walkFromPrevious).toEqual({ minutes: 2, fromVenue: '' });
  });

  test('walks are clamped and rounded to whole minutes in range', () => {
    const next = {
      sessionCode: 'NET204-R',
      startsAt: '2026-12-01T12:00:00-08:00',
      venue: NEXT_VENUE,
    };
    const previous = { commitment: reservedCommitment({ venue: PREV_VENUE }) };
    const high = build(
      { previous, next },
      { [`${PREV_VENUE}|${SESSION_VENUE}`]: 400, [`${SESSION_VENUE}|${NEXT_VENUE}`]: -3 },
    );
    expect(high.walkFromPrevious?.minutes).toBe(90);
    expect(high.nextConnection?.walkMinutes).toBe(0);
    const fractional = build({ previous }, { [`${PREV_VENUE}|${SESSION_VENUE}`]: 12.6 });
    expect(fractional.walkFromPrevious?.minutes).toBe(13);
  });

  test('a session without a venue asks the provider with an empty venue and omits unknown walks', () => {
    const connections = fakeConnections();
    const { fields } = buildPass(
      {
        session: makeSession({ venue: undefined }),
        previous: { commitment: reservedCommitment({ venue: PREV_VENUE }) },
        next: { sessionCode: 'NET204-R', startsAt: '2026-12-01T12:00:00-08:00', venue: NEXT_VENUE },
        eventWindow: WINDOW,
      },
      { connections },
    );
    expect(connections.calls).toEqual([`${PREV_VENUE}|`, `|${NEXT_VENUE}`]);
    expect(fields).not.toHaveProperty('walkFromPrevious');
    expect(fields).not.toHaveProperty('nextConnection');
  });

  test('a session without a start or end time cannot form a pass', () => {
    for (const session of [
      makeSession({ startsAt: undefined }),
      makeSession({ endsAt: undefined }),
    ]) {
      expect(() =>
        buildPass({ session, eventWindow: WINDOW }, { connections: fakeConnections() }),
      ).toThrow(PassError);
    }
  });

  test('a malformed event window is a safe PassError', () => {
    expect.assertions(3);
    try {
      buildPass(
        { session: makeSession(), eventWindow: { ...WINDOW, end: WINDOW.start } },
        { connections: fakeConnections() },
      );
    } catch (error) {
      expect(error).toBeInstanceOf(PassError);
      expect((error as PassError).code).toBe('builder.invalid_input');
      expect((error as PassError).summary).toBe('The event window is not valid.');
    }
  });

  test('a session that cannot be a valid pass throws without echoing the input', () => {
    const secretTitle = 'Confidential title for SECRET-CODE';
    for (const session of [
      makeSession({ title: secretTitle, code: 'not a valid code' }),
      makeSession({
        title: secretTitle,
        startsAt: '2030-01-01T00:00:00-08:00',
        endsAt: '2030-01-01T01:00:00-08:00',
      }),
      makeSession({ title: secretTitle, startsAt: 'tomorrow', endsAt: 'later' }),
    ]) {
      let caught: unknown;
      try {
        buildPass({ session, eventWindow: WINDOW }, { connections: fakeConnections() });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(PassError);
      const message = (caught as PassError).message;
      expect(message).toBe('The session cannot be turned into a valid pass.');
      expect(message).not.toContain('Confidential');
      expect(message).not.toContain('SECRET-CODE');
    }
  });
});
