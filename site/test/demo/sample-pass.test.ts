import {
  createPassFieldsSchema,
  normalisePassText,
  type NormalisedSession,
} from '@compass/contracts';
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { DEMO_EVENT, DEMO_SESSIONS } from '../../src/lib/demo/demo-catalog';
import { createDemoRuntime } from '../../src/lib/demo/demo-deps';
import {
  EMPTY_DEMO,
  reduceDemo,
  type DemoAction,
  type DemoState,
} from '../../src/lib/demo/demo-state';
import { normalisePassText as localNormalise } from '../../src/lib/demo/pass-text';
import { neighboursOf } from '../../src/lib/demo/neighbours';
import {
  PASS_DISCLAIMER,
  SAMPLE_LABEL,
  buildSamplePass,
  clampWalk,
  fitTitle,
  shortRoom,
} from '../../src/lib/demo/sample-pass';
import { PASS_COLOURS } from '../../src/lib/demo/pass-layout';
import { contrastRatio } from '../../src/lib/design/contrast';
import { formatDateInZone, formatInZone24 } from '../../src/lib/time/time-format';
import { createFakeEngine } from '../doubles/rules-double';
import { VENUE_DATA, heldIds, makeDeps, run, runStates, richWeek } from '../support/demo-harness';

const schema = createPassFieldsSchema({
  start: DEMO_EVENT.windowStart,
  end: DEMO_EVENT.windowEnd,
  timezone: DEMO_EVENT.timezone,
});
const deps = makeDeps();
const starter = richWeek();

describe('fitTitle and clampWalk', () => {
  test('a title of 80 characters or fewer is only normalised', () => {
    expect(fitTitle('Short title')).toBe('Short title');
    expect(fitTitle('A'.repeat(80))).toBe('A'.repeat(80));
    const curly = String.fromCharCode(0x2019);
    const dash = String.fromCharCode(0x2014);
    const ellipsis = String.fromCharCode(0x2026);
    expect(fitTitle(`  Don${curly}t ${dash} stop${ellipsis}  `)).toBe("Don't - stop...");
  });

  test('a longer title becomes 77 characters plus three ASCII dots', () => {
    const fitted = fitTitle('B'.repeat(81));
    expect(fitted).toBe(`${'B'.repeat(77)}...`);
    expect(fitted).toHaveLength(80);
    expect(fitTitle(`${'word '.repeat(20)}end`).endsWith('...')).toBe(true);
    // Exactly the first 77 characters, even when the 77th is a space (S4 and Requirement 11.2).
    expect(fitTitle(`${'x'.repeat(76)} ${'y'.repeat(20)}`)).toBe(`${'x'.repeat(76)} ...`);
    expect(fitTitle(`${'x'.repeat(76)} ${'y'.repeat(20)}`)).toHaveLength(80);
  });

  test('walk minutes are clamped to 0 to 90 and rounded', () => {
    expect(clampWalk(-5)).toBe(0);
    expect(clampWalk(120)).toBe(90);
    expect(clampWalk(12.4)).toBe(12);
    expect(clampWalk(90)).toBe(90);
  });
});

describe('pass text normalisation', () => {
  test('equals normalisePassText of @compass/contracts for any text', () => {
    const marks = [
      0x2013, 0x2014, 0x2018, 0x2019, 0x2032, 0x201c, 0x201d, 0x2033, 0x2026, 0xa0, 0x20, 0x9, 0xa,
      0x7c,
    ].map((c) => String.fromCharCode(c));
    fc.assert(
      fc.property(
        fc
          .array(fc.oneof(fc.constantFrom(...marks), fc.string({ maxLength: 3 })), {
            maxLength: 30,
          })
          .map((p) => p.join('')),
        (text) => {
          expect(localNormalise(text)).toBe(normalisePassText(text));
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('buildSamplePass examples', () => {
  test('is null for a session that is not in the week or not in the catalog', () => {
    expect(buildSamplePass('CMP340', starter, deps)).toBeNull();
    expect(buildSamplePass('nope', starter, deps)).toBeNull();
    expect(buildSamplePass('INV530-R1', EMPTY_DEMO, deps)).toBeNull();
  });

  test('shows every field of Requirement 11.2 for the first session of a day', () => {
    const pass = buildSamplePass('INV530-R1', starter, deps);
    expect(pass).toMatchObject({
      session: 'INV530-R1',
      title: 'EC2 at 20: Rebuilding the control plane while it is running',
      terminal: 'MGM Grand',
      gate: 'Room 350',
      boardingCloses: '11:20',
      boardingNote: null,
      walkFromPrevious: null,
      nextConnection: 'CMP325-R at 12:30 PM, 10 min walk',
      label: SAMPLE_LABEL,
      disclaimer: PASS_DISCLAIMER,
    });
    expect(pass?.date).toMatch(/^\d{1,2} [A-Z][a-z]{2} 2026 \| \d{2}:\d{2}-\d{2}:\d{2}$/);
    expect(pass?.accessibleName).toContain('Terminal: MGM Grand. Gate: Room 350.');
    expect(pass?.accessibleName).toContain('Boarding closes: 11:20.');
    expect(pass?.accessibleName).toContain('Walk from the previous session: not known.');
    expect(pass?.accessibleName).toContain('Next connection: CMP325-R at 12:30 PM, 10 min walk.');
    expect(pass?.accessibleName).toContain(
      'Sample pass. Not a real booking. Unofficial. Your badge is your ticket.',
    );
  });

  test('shows the walk from the previous session and no next connection for the last one', () => {
    const pass = buildSamplePass('AIM433', starter, deps);
    expect(pass?.walkFromPrevious).toBe('10 min walk from MGM Grand, Level 3, Premier 310');
    expect(pass?.nextConnection).toBeNull();
    expect(pass?.passFields.walkFromPrevious).toEqual({ minutes: 10, fromVenue: 'MGM Grand' });
    expect(pass?.passFields.nextConnection).toBeUndefined();
    const first = buildSamplePass('CMP325-R', starter, deps);
    expect(first?.passFields.nextConnection).toMatchObject({
      sessionCode: 'AIM433',
      walkMinutes: 10,
      venue: 'MGM Grand',
    });
  });

  test('has no barcode, no QR code and no logo field', () => {
    const pass = buildSamplePass('INV530-R1', starter, deps) as NonNullable<
      ReturnType<typeof buildSamplePass>
    >;
    expect(Object.keys(pass).sort()).toEqual([
      'accessibleName',
      'boardingCloses',
      'boardingNote',
      'date',
      'disclaimer',
      'gate',
      'label',
      'nextConnection',
      'passFields',
      'session',
      'terminal',
      'title',
      'walkFromPrevious',
    ]);
    expect(JSON.stringify(pass).toLowerCase()).not.toMatch(/barcode|qr|aws|amazon/);
  });

  test('a session with no venue shows "Venue not published" and an empty venue in the fields', () => {
    const state = run([{ type: 'add', sessionId: 'ACT053' }], deps);
    const pass = buildSamplePass('ACT053', state, deps);
    expect(pass?.terminal).toBe('Venue not published');
    expect(pass?.gate).toBe('Allegiant Stadium');
    expect(pass?.passFields.venue).toBe('');
    expect(pass?.passFields.room).toBe('Allegiant Stadium');
    expect(schema.safeParse(pass?.passFields).success).toBe(true);
  });

  test('a session with no venue and no room shows "Room not published" and empty fields', () => {
    const bare = { ...(deps.catalog.get('ACT053') as NormalisedSession) };
    delete (bare as { room?: string }).room;
    const custom = { ...deps, catalog: new Map([['ACT053', bare]]) };
    const state = run([{ type: 'add', sessionId: 'ACT053' }], custom);
    const pass = buildSamplePass('ACT053', state, custom);
    expect(pass?.gate).toBe('Room not published');
    expect(pass?.passFields.room).toBe('');
  });

  test('a walk the engine cannot give is left out, and a long walk is clamped', () => {
    const unknown = makeDeps({
      connectionsForDay: () => ({ status: 'unknown', reason: 'No timezone.' }),
    });
    const noWalk = buildSamplePass('AIM433', starter, unknown);
    expect(noWalk?.walkFromPrevious).toBeNull();
    expect(noWalk?.passFields.walkFromPrevious).toBeUndefined();
    const long = makeDeps({
      connectionsForDay: () => ({
        status: 'ok',
        connections: [
          {
            from: 'CMP325-R',
            to: 'AIM433',
            result: { classification: 'impossible', walkingMinutes: 140, reason: 'x' },
          },
        ],
        skipped: [],
      }),
    });
    expect(buildSamplePass('AIM433', starter, long)?.passFields.walkFromPrevious?.minutes).toBe(90);
  });

  test('personal time next to a session has no next connection code', () => {
    const state = run(
      [
        { type: 'add', sessionId: 'ANT414' },
        {
          type: 'addLayover',
          start: '2026-12-01T17:00:00-08:00',
          end: '2026-12-01T17:30:00-08:00',
        },
      ],
      deps,
    );
    expect(buildSamplePass('ANT414', state, deps)?.nextConnection).toBeNull();
    const after = neighboursOf('ANT414', state, deps).next;
    expect(after?.sessionCode).toBeNull();
    expect(after?.gate).toBe('Venue not published');
  });
});

describe('shortRoom and the label colour', () => {
  test('the gate is the part of the room after the first comma', () => {
    expect(shortRoom('Level 1, Octavius 4')).toBe('Octavius 4');
    expect(shortRoom('Room 118')).toBe('Room 118');
    expect(shortRoom('A, B, C')).toBe('B');
    expect(shortRoom(' , ')).toBe('Room not published');
    expect(shortRoom('')).toBe('Room not published');
    expect(shortRoom(undefined)).toBe('Room not published');
  });

  test('a session with no boarding time says why and shows "Not needed"', () => {
    const pass = DEMO_SESSIONS.find((x) => !x.isReservable);
    const id = pass?.sessionId as string;
    const state = run([{ type: 'add', sessionId: id }], deps);
    const built = buildSamplePass(id, state, deps);
    expect(built?.boardingCloses).toBe('Not needed');
    expect(built?.boardingNote).toBe(`${pass?.code} needs no reservation.`);
  });

  test('the label colour reaches 4.5:1 on the card and the value is white', () => {
    for (const card of [PASS_COLOURS.background, PASS_COLOURS.backgroundEnd]) {
      expect(contrastRatio(PASS_COLOURS.label, card)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(PASS_COLOURS.value, card)).toBeGreaterThanOrEqual(4.5);
    }
    expect(PASS_COLOURS.value).toBe('#FFFFFF');
    expect(PASS_COLOURS.background).toBe('#05052E');
  });
});

describe('neighbours', () => {
  test('are empty for a ref that is not in the week', () => {
    expect(neighboursOf('nope', starter, deps)).toEqual({ previous: null, next: null });
  });

  test('name unknown sessions by id and layovers by title and place', () => {
    const state: DemoState = {
      ...EMPTY_DEMO,
      commitments: [
        {
          kind: 'reservedSession',
          sessionId: 'gone',
          startsAt: '2026-12-01T09:00:00-08:00',
          endsAt: '2026-12-01T09:30:00-08:00',
          venue: 'Wynn',
        },
        {
          kind: 'reservedSession',
          sessionId: 'gone2',
          startsAt: '2026-12-01T10:00:00-08:00',
          endsAt: '2026-12-01T10:30:00-08:00',
        },
        {
          kind: 'personalTime',
          title: 'Rest',
          startsAt: '2026-12-01T11:00:00-08:00',
          endsAt: '2026-12-01T11:30:00-08:00',
          location: 'Encore',
        },
      ],
    };
    const result = neighboursOf('gone2', state, deps);
    expect(result.previous).toMatchObject({
      ref: 'gone',
      sessionCode: null,
      venue: 'Wynn',
      gate: 'Wynn',
    });
    expect(result.next).toMatchObject({ ref: 'Rest', venue: 'Encore', gate: 'Encore' });
    expect(result.previous?.walkMinutes).toBeNull();
  });
});

describe('Property 14: Sample pass fields follow the pass rules', () => {
  // Feature: showcase-site, Property 14: Sample pass fields follow the pass rules
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
  );
  const titleArb = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ,:;'"!?()&+#-]{0,149}$/);

  function withTitles(titles: readonly string[]) {
    const catalog = DEMO_SESSIONS.map((s, i): NormalisedSession => ({
      ...s,
      title: titles[i % titles.length] as string,
    }));
    const runtime = createDemoRuntime(createFakeEngine(), VENUE_DATA);
    return {
      ...(runtime as NonNullable<typeof runtime>),
      catalog: new Map(catalog.map((s) => [s.sessionId, s])),
    };
  }

  test('every pass of a reachable week validates, fits the title rules and shows the fixed texts', () => {
    fc.assert(
      fc.property(
        fc.array(titleArb, { minLength: 1, maxLength: 4 }),
        fc.array(actionArb, { maxLength: 14 }),
        (titles, actions) => {
          const longDeps = withTitles(titles);
          const state = runStates(actions, longDeps).at(-1) ?? EMPTY_DEMO;
          for (const id of heldIds(state)) {
            const pass = buildSamplePass(id, state, longDeps);
            expect(pass).not.toBeNull();
            const p = pass as NonNullable<typeof pass>;
            expect(schema.safeParse(p.passFields).success, JSON.stringify(p.passFields)).toBe(true);
            const original = longDeps.catalog.get(id)?.title as string;
            const normalised = normalisePassText(original);
            expect(p.title.length).toBeLessThanOrEqual(80);
            expect(p.title.endsWith('...')).toBe(normalised.length > 80);
            expect(p.title).not.toContain('…');
            if (normalised.length <= 80) {
              expect(p.title).toBe(normalised);
            }
            const session = longDeps.catalog.get(id) as NormalisedSession;
            expect(p.terminal === 'Venue not published' || session.venue !== undefined).toBe(true);
            expect(p.gate === 'Room not published' || session.room !== undefined).toBe(true);
            expect(p.date).toBe(
              `${formatDateInZone(session.startsAt as string, DEMO_EVENT.timezone)} | ${formatInZone24(session.startsAt as string, DEMO_EVENT.timezone)}-${formatInZone24(session.endsAt as string, DEMO_EVENT.timezone)}`,
            );
            expect(p.passFields.venue).toBe(session.venue ?? '');
            const closes = formatInZone24(
              new Date(Date.parse(session.startsAt as string) - 10 * 60_000).toISOString(),
              DEMO_EVENT.timezone,
            );
            expect(p.boardingCloses).toBe(session.isReservable ? closes : 'Not needed');
            expect(p.boardingNote).toBe(
              session.isReservable ? null : `${session.code} needs no reservation.`,
            );
            expect(p.label).toBe('Sample pass. Not a real booking.');
            expect(p.disclaimer).toBe('Unofficial. Your badge is your ticket.');
            for (const walk of [
              p.passFields.walkFromPrevious?.minutes,
              p.passFields.nextConnection?.walkMinutes,
            ]) {
              expect(walk === undefined || (walk >= 0 && walk <= 90)).toBe(true);
            }
          }
        },
      ),
      { numRuns: 150 },
    );
  });

  test('a week with the sample week loaded always yields passes', () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 10 }), (actions) => {
        const state = actions.reduce((s, a) => reduceDemo(s, a, deps), starter);
        expect(heldIds(state).length).toBeGreaterThan(0);
      }),
      { numRuns: 50 },
    );
  });
});
