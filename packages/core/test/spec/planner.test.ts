import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { CommitmentSchema } from '@compass/contracts';
import type { Commitment, NormalisedSession, Verdict } from '@compass/contracts';
import { eventDay, planWeek } from '../../src/spec/planner.js';
import type { PlannerFinding, PlannerInput, PlannerSession } from '../../src/spec/planner.js';
import { DASH_PATTERN } from '../support/dashes.js';
import { FakePlannerRules, WINDOW, session } from '../support/planner-fakes.js';

const LABELS = ['compute', 'storage', 'database', 'Amazon S3'];
const FINDINGS: PlannerFinding[] = [
  { displayName: 'Amazon S3', depth: 2, level: 300, labels: ['amazon s3', 'storage'] },
  { displayName: 'AWS Lambda', depth: 1, level: 200, labels: ['compute'] },
  { displayName: 'Amazon DynamoDB', depth: 3, level: 400, labels: ['database'] },
];

describe('eventDay', () => {
  test('is the calendar day in the event timezone', () => {
    expect(eventDay('2026-12-01T03:00:00.000Z', 'America/Los_Angeles')).toBe('2026-11-30');
    expect(eventDay('2026-12-01T09:00:00.000Z', 'America/Los_Angeles')).toBe('2026-12-01');
  });
});

function input(sessions: PlannerSession[], overrides: Partial<PlannerInput> = {}): PlannerInput {
  return {
    sessions,
    confirmed: [],
    findings: FINDINGS,
    goals: [],
    maxPerDay: 4,
    eventWindow: WINDOW,
    ...overrides,
  };
}

function entry(id: string, services: string[], overrides: Partial<NormalisedSession> = {}) {
  return { session: session(id, overrides), services };
}

describe('planWeek examples', () => {
  test('picks matching sessions, marks walk-ups and builds commitments', async () => {
    const rules = new FakePlannerRules();
    rules.layovers = () => [
      {
        start: '2026-12-01T20:00:00.000Z',
        end: '2026-12-01T20:30:00.000Z',
        reason: `Lunch ${String.fromCharCode(0x2013)} eat`,
      },
    ];
    const result = await planWeek(
      input([
        entry('a', ['storage'], { level: '300', isReservable: false, venue: 'Encore' }),
        entry('b', ['unrelated']),
      ]),
      rules,
    );
    expect(result.picks.map((p) => p.session.sessionId)).toEqual(['a']);
    expect(result.picks[0]).toMatchObject({ walkUp: true });
    expect(result.picks[0]?.reason).toContain('Amazon S3');
    expect(result.picks[0]?.reason).toContain('Its level fits you.');
    expect(result.layovers).toEqual([
      {
        day: '2026-12-01',
        start: '2026-12-01T20:00:00.000Z',
        end: '2026-12-01T20:30:00.000Z',
        reason: 'Lunch - eat',
      },
    ]);
    expect(result.commitments.map((c) => c.kind)).toEqual(['reservedSession', 'personalTime']);
    expect(result.commitments[0]).toMatchObject({ venue: 'Encore' });
  });

  test('goal words alone can match, and the level override decides the level bonus', async () => {
    const rules = new FakePlannerRules();
    const sessions = [
      entry('g', ['other'], { title: 'Serverless patterns for builders', level: '200' }),
      entry('h', ['storage'], { level: '200' }),
    ];
    const result = await planWeek(
      input(sessions, { goals: ['learn serverless', 'ab'], level: 'Level 200 please' }),
      rules,
    );
    expect(result.picks.map((p) => p.session.sessionId).sort()).toEqual(['g', 'h']);
    const goalPick = result.picks.find((p) => p.session.sessionId === 'g');
    expect(goalPick?.reason).toContain('Matches a goal you gave');
    const finding = result.picks.find((p) => p.session.sessionId === 'h');
    expect(finding?.reason).toContain('Its level fits you.');
  });

  test('skips blocked candidates and confirmed sessions and respects the day cap', async () => {
    const rules = new FakePlannerRules();
    rules.decide = (candidate) =>
      candidate.sessionId === 'blocked'
        ? { decision: 'block', reasons: ['x'] }
        : { decision: 'warn', reasons: ['w'] };
    const confirmed: Commitment[] = [
      {
        kind: 'reservedSession',
        sessionId: 'done',
        startsAt: '2026-12-01T15:00:00.000Z',
        endsAt: '2026-12-01T16:00:00.000Z',
      },
      {
        kind: 'personalTime',
        title: 'Mine',
        startsAt: '2026-12-01T12:00:00.000Z',
        endsAt: '2026-12-01T12:30:00.000Z',
      },
    ];
    const result = await planWeek(
      input(
        [
          entry('blocked', ['storage']),
          entry('done', ['storage']),
          entry('one', ['storage'], {
            startsAt: '2026-12-01T20:00:00.000Z',
            endsAt: '2026-12-01T21:00:00.000Z',
          }),
          entry('two', ['storage'], {
            startsAt: '2026-12-01T22:00:00.000Z',
            endsAt: '2026-12-01T23:00:00.000Z',
          }),
        ],
        { confirmed, maxPerDay: 1 },
      ),
      rules,
    );
    expect(result.picks.map((p) => p.session.sessionId)).toEqual(['one']);
    expect(result.picks[0]?.verdict.decision).toBe('warn');
  });

  test('standby comes from a repeat first, then from a similar session, and is never reused', async () => {
    const rules = new FakePlannerRules();
    const repeat = session('a-r', {
      startsAt: '2026-12-02T18:00:00.000Z',
      endsAt: '2026-12-02T19:00:00.000Z',
    });
    const noTimes: NormalisedSession = { ...repeat, sessionId: 'no-times' };
    delete noTimes.startsAt;
    rules.repeats = (s) => (s.sessionId === 'a' ? [noTimes, repeat] : []);
    const result = await planWeek(
      input(
        [
          entry('a', ['storage'], { level: '300' }),
          entry('b', ['storage'], {
            startsAt: '2026-12-03T18:00:00.000Z',
            endsAt: '2026-12-03T19:00:00.000Z',
          }),
          entry('c', ['storage'], {
            startsAt: '2026-12-03T20:00:00.000Z',
            endsAt: '2026-12-03T21:00:00.000Z',
          }),
          entry('far', ['storage'], {
            startsAt: '2026-12-04T20:00:00.000Z',
            endsAt: '2026-12-04T21:00:00.000Z',
          }),
        ],
        { maxPerDay: 1 },
      ),
      rules,
    );
    const standbys = result.picks.map((p) => p.standby?.session.sessionId);
    expect(standbys[0]).toBe('a-r');
    expect(new Set(standbys.filter((id) => id !== undefined)).size).toBe(
      standbys.filter((id) => id !== undefined).length,
    );
    expect(result.picks.find((p) => p.session.sessionId === 'b')?.standby?.reason).toContain(
      'similar',
    );
  });

  test('a blocked repeat and a blocked similar session give no standby', async () => {
    const rules = new FakePlannerRules();
    let selection = true;
    rules.decide = (candidate) =>
      selection && !candidate.sessionId.startsWith('x')
        ? { decision: 'allow', reasons: [] }
        : { decision: 'block', reasons: ['b'] };
    rules.repeats = () => {
      selection = false;
      return [
        session('rep', {
          startsAt: '2026-12-02T18:00:00.000Z',
          endsAt: '2026-12-02T19:00:00.000Z',
        }),
      ];
    };
    const result = await planWeek(
      input([
        entry('only', ['storage']),
        entry('x1', ['storage'], {
          startsAt: '2026-12-03T18:00:00.000Z',
          endsAt: '2026-12-03T19:00:00.000Z',
        }),
      ]),
      rules,
    );
    expect(result.picks).toHaveLength(1);
    expect(result.picks[0]?.standby).toBeUndefined();
  });

  test('a very long service name still gives a reason of at most 200 characters', async () => {
    const result = await planWeek(
      input([entry('a', ['storage'])], {
        findings: [{ displayName: 'x'.repeat(400), depth: 0, labels: ['storage'] }],
      }),
      new FakePlannerRules(),
    );
    const reason = result.picks[0]?.reason ?? '';
    expect(reason.length).toBe(200);
  });

  test('with no usable input there are no picks', async () => {
    const result = await planWeek(input([]), new FakePlannerRules());
    expect(result).toEqual({
      picks: [],
      layovers: [],
      commitments: [],
      excludedForMissingTimes: 0,
    });
  });
});

// ---- property generators ----

type TimeKind = 'ok' | 'missingStart' | 'missingEnd' | 'badStart' | 'zeroLength' | 'outside';

interface SessionSpec {
  id: number;
  kind: TimeKind;
  day: number;
  hour: number;
  length: number;
  services: string[];
  level: string;
  code: string;
  reservable: boolean;
  repeats: boolean;
}

const specArb: fc.Arbitrary<Omit<SessionSpec, 'id'>> = fc.record({
  kind: fc.constantFrom<TimeKind>(
    'ok',
    'ok',
    'ok',
    'ok',
    'missingStart',
    'missingEnd',
    'badStart',
    'zeroLength',
    'outside',
  ),
  day: fc.integer({ min: 0, max: 4 }),
  hour: fc.integer({ min: 0, max: 13 }),
  length: fc.integer({ min: 1, max: 3 }),
  services: fc.subarray(LABELS),
  level: fc.constantFrom('100', '200', '300', '400', 'Level 300', ''),
  code: fc.constantFrom('AAA1', 'AAA2', 'BBB1'),
  reservable: fc.boolean(),
  repeats: fc.boolean(),
});

const BASE = Date.parse('2026-11-30T16:00:00.000Z');

function build(spec: SessionSpec): PlannerSession {
  const hours = (n: number): number => n * 3600000;
  const startMs = BASE + hours(spec.day * 24 + spec.hour);
  const overrides: Partial<NormalisedSession> = {
    code: spec.code,
    level: spec.level === '' ? undefined : spec.level,
    isReservable: spec.reservable,
    startsAt: new Date(startMs).toISOString(),
    endsAt: new Date(startMs + hours(spec.length)).toISOString(),
  };
  if (spec.kind === 'missingStart') delete overrides.startsAt;
  if (spec.kind === 'missingEnd') delete overrides.endsAt;
  if (spec.kind === 'badStart') overrides.startsAt = 'not a date';
  if (spec.kind === 'zeroLength') overrides.endsAt = overrides.startsAt;
  if (spec.kind === 'outside') {
    overrides.startsAt = new Date(BASE + hours(24 * 9)).toISOString();
    overrides.endsAt = new Date(BASE + hours(24 * 9 + 1)).toISOString();
  }
  const base = session(`s${spec.id}`, overrides);
  if (overrides.startsAt === undefined) delete base.startsAt;
  if (overrides.endsAt === undefined) delete base.endsAt;
  if (overrides.level === undefined) delete base.level;
  return { session: base, services: spec.services };
}

const casesArb = fc.record({
  specs: fc.array(specArb, { maxLength: 24 }),
  maxPerDay: fc.integer({ min: 1, max: 8 }),
  goals: fc.array(fc.constantFrom('title', 'sion', 'xyz', 'go'), { maxLength: 2 }),
  level: fc.constantFrom<string | undefined>(undefined, '200', 'level 300', 'none'),
  confirmedCount: fc.integer({ min: 0, max: 3 }),
  verdicts: fc.array(fc.constantFrom<Verdict['decision']>('allow', 'warn', 'block'), {
    minLength: 24,
    maxLength: 24,
  }),
});

type Case = typeof casesArb extends fc.Arbitrary<infer T> ? T : never;

function realise(c: Case) {
  const sessions = c.specs.map((spec, id) => build({ ...spec, id }));
  const confirmed: Commitment[] = sessions.slice(0, c.confirmedCount).flatMap(({ session: s }) =>
    s.startsAt !== undefined && s.endsAt !== undefined
      ? [
          {
            kind: 'reservedSession' as const,
            sessionId: s.sessionId,
            startsAt: s.startsAt,
            endsAt: s.endsAt,
          },
        ]
      : [],
  );
  const rules = new FakePlannerRules();
  rules.decide = (candidate) => {
    const index = Number(candidate.sessionId.slice(1));
    const decision = c.verdicts[index] ?? 'allow';
    return decision === 'allow' ? { decision, reasons: [] } : { decision, reasons: ['reason'] };
  };
  rules.repeats = (s) => {
    const next = sessions[(Number(s.sessionId.slice(1)) + 1) % Math.max(sessions.length, 1)];
    return next === undefined ? [] : [next.session];
  };
  const plannerInput: PlannerInput = {
    sessions,
    confirmed,
    findings: FINDINGS,
    goals: c.goals,
    ...(c.level === undefined ? {} : { level: c.level }),
    maxPerDay: c.maxPerDay,
    eventWindow: WINDOW,
  };
  return { sessions, confirmed, rules, plannerInput };
}

function levelNumber(text: string | undefined): number | undefined {
  const match = /\b([1-4]00)\b/.exec(text ?? '');
  return match === null ? undefined : Number(match[1]);
}

function oracleScore(item: PlannerSession, plannerInput: PlannerInput): number {
  const lowered = new Set(item.services.map((s) => s.toLowerCase()));
  const matched = plannerInput.findings.filter((f) =>
    f.labels.some((l) => lowered.has(l.toLowerCase())),
  );
  const level = levelNumber(item.session.level);
  const override = levelNumber(plannerInput.level);
  const fits =
    level !== undefined &&
    (override === undefined ? matched.some((f) => f.level === level) : override === level);
  const words = [...new Set(plannerInput.goals.filter((g) => g.length >= 3))];
  return (
    matched.reduce((sum, f) => sum + 3 * (f.depth + 1), 0) +
    (fits ? 2 : 0) +
    words.filter((w) => item.session.title.toLowerCase().includes(w)).length
  );
}

const unusable = (s: NormalisedSession): boolean => {
  const start = Date.parse(s.startsAt ?? '');
  const end = Date.parse(s.endsAt ?? '');
  return Number.isNaN(start) || Number.isNaN(end) || end <= start;
};

// Feature: compass-power, Property 16: Planned picks respect the day cap, the guardrail and usable times
describe('Property 16: planned picks respect the day cap, the guardrail and usable times', () => {
  test('caps, guardrail, usable times, exclusion count and commitment shape', async () => {
    await fc.assert(
      fc.asyncProperty(casesArb, async (c) => {
        const { sessions, rules, plannerInput } = realise(c);
        const result = await planWeek(plannerInput, rules);
        const perDay = new Map<string, number>();
        for (const pick of result.picks) {
          const s = pick.session;
          expect(unusable(s)).toBe(false);
          expect(Date.parse(String(s.startsAt))).toBeGreaterThanOrEqual(Date.parse(WINDOW.start));
          expect(Date.parse(String(s.endsAt))).toBeLessThanOrEqual(Date.parse(WINDOW.end));
          expect(rules.checked.get(s.sessionId)).not.toBe('block');
          const day = eventDay(String(s.startsAt), WINDOW.timezone);
          perDay.set(day, (perDay.get(day) ?? 0) + 1);
        }
        for (const count of perDay.values()) expect(count).toBeLessThanOrEqual(c.maxPerDay);
        expect(result.excludedForMissingTimes).toBe(
          sessions.filter((s) => unusable(s.session)).length,
        );
        for (const commitment of result.commitments) {
          expect(CommitmentSchema.safeParse(commitment).success).toBe(true);
        }
      }),
      { numRuns: 150 },
    );
  });
});

// Feature: compass-power, Property 17: Planning is deterministic and ranked as documented
describe('Property 17: planning is deterministic and ranked as documented', () => {
  test('two runs agree and candidates are examined in documented order', async () => {
    await fc.assert(
      fc.asyncProperty(casesArb, async (c) => {
        const first = realise(c);
        const second = realise(c);
        const a = await planWeek(first.plannerInput, first.rules);
        const b = await planWeek(second.plannerInput, second.rules);
        expect(b).toEqual(a);

        const confirmedIds = new Set(
          first.confirmed.flatMap((x) => (x.kind === 'reservedSession' ? [x.sessionId] : [])),
        );
        const expected = first.sessions
          .filter(
            (s) =>
              !unusable(s.session) &&
              Date.parse(String(s.session.startsAt)) >= Date.parse(WINDOW.start) &&
              Date.parse(String(s.session.endsAt)) <= Date.parse(WINDOW.end) &&
              !confirmedIds.has(s.session.sessionId),
          )
          .map((s) => ({ s, score: oracleScore(s, first.plannerInput) }))
          .sort(
            (x, y) =>
              y.score - x.score ||
              Date.parse(String(x.s.session.startsAt)) - Date.parse(String(y.s.session.startsAt)) ||
              (x.s.session.code < y.s.session.code
                ? -1
                : x.s.session.code > y.s.session.code
                  ? 1
                  : 0) ||
              (x.s.session.sessionId < y.s.session.sessionId ? -1 : 1),
          )
          .map((x) => x.s.session.sessionId);
        const firstRepeat = first.rules.log.findIndex((line) => line.startsWith('repeats:'));
        const selection = (
          firstRepeat === -1 ? first.rules.log : first.rules.log.slice(0, firstRepeat)
        )
          .filter((line) => line.startsWith('check:'))
          .map((line) => line.slice(6));
        let last = -1;
        for (const id of selection) {
          const position = expected.indexOf(id);
          expect(position).toBeGreaterThan(last);
          last = position;
        }
      }),
      { numRuns: 150 },
    );
  });
});

// Feature: compass-power, Property 18: Every pick carries a valid reason, at most one standby and the walk-up mark
describe('Property 18: every pick carries a valid reason, at most one standby and the walk-up mark', () => {
  test('reasons, standby timing and walk-up marks', async () => {
    await fc.assert(
      fc.asyncProperty(casesArb, async (c) => {
        const { rules, plannerInput } = realise(c);
        const result = await planWeek(plannerInput, rules);
        const standbyIds: string[] = [];
        for (const pick of result.picks) {
          expect(pick.reason.length).toBeGreaterThanOrEqual(1);
          expect(pick.reason.length).toBeLessThanOrEqual(200);
          expect(pick.reason).not.toMatch(DASH_PATTERN);
          const lowered = new Set(
            plannerInput.sessions
              .find((s) => s.session.sessionId === pick.session.sessionId)
              ?.services.map((x) => x.toLowerCase()),
          );
          const matched = FINDINGS.find((f) => f.labels.some((l) => lowered.has(l.toLowerCase())));
          if (matched !== undefined) expect(pick.reason).toContain(matched.displayName);
          expect(pick.walkUp).toBe(!pick.session.isReservable);
          if (pick.standby !== undefined) {
            expect(pick.standby.session.startsAt).not.toBe(pick.session.startsAt);
            standbyIds.push(pick.standby.session.sessionId);
          }
        }
        expect(new Set(standbyIds).size).toBe(standbyIds.length);
      }),
      { numRuns: 150 },
    );
  });
});
