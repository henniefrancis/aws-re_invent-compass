import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { mcpTools } from '@compass/contracts';
import type { PersonalTimeInput } from '@compass/contracts';
import { CompassError } from '../../src/ports/errors.js';
import { addLayover } from '../../src/tools/add-layover.js';
import { addStandby } from '../../src/tools/add-standby.js';
import { cancelReservation } from '../../src/tools/cancel-reservation.js';
import { removeStandby } from '../../src/tools/remove-standby.js';
import { reserveWithGuardrails } from '../../src/tools/reserve-with-guardrails.js';
import { contextFor } from '../support/context.js';
import { syntheticCatalogView } from '../support/fake-catalog.js';
import { createFakeRuntime } from '../support/fake-runtime.js';
import { TRIPLE } from '../support/triple.js';

const IDS = [TRIPLE.a, TRIPLE.aRepeat, TRIPLE.b];

type Tool = 'reserve' | 'cancel' | 'favorite' | 'unfavorite' | 'layover';
const METHOD: Record<Tool, string> = {
  reserve: 'reserve',
  cancel: 'cancel',
  favorite: 'favorite',
  unfavorite: 'unfavorite',
  layover: 'createPersonalTime',
};

const failureArb = fc.constantFrom(
  'sessionFull',
  'alreadyScheduled',
  'scheduleConflict',
  'weirdNewCode',
  'timePassed',
);
const scenarioArb = fc.record({
  tool: fc.constantFrom<Tool>('reserve', 'cancel', 'favorite', 'unfavorite', 'layover'),
  ids: fc.subarray(IDS, { minLength: 1 }),
  confirm: fc.constantFrom<'confirmed' | 'unconfirmed'>('confirmed', 'unconfirmed'),
  ignoreWrites: fc.boolean(),
  failures: fc.array(fc.tuple(fc.constantFrom(...IDS), failureArb), { maxLength: 3 }),
  error: fc.constantFrom<undefined | 'RateLimited' | 'Server' | 'Unauthorized'>(
    undefined,
    undefined,
    'RateLimited',
    'Server',
    'Unauthorized',
  ),
  block: fc.boolean(),
});

function arrange(s: typeof scenarioArb extends fc.Arbitrary<infer T> ? T : never) {
  const fake = createFakeRuntime({ catalog: syntheticCatalogView() });
  fake.events.confirm = s.confirm;
  fake.events.ignoreWrites = s.ignoreWrites;
  for (const [id, code] of s.failures) fake.events.reserveFailures.set(id, { code });
  if (s.error !== undefined) {
    fake.events.failWith.set(
      METHOD[s.tool],
      new CompassError(s.error, s.error === 'RateLimited' ? { retryAfterSeconds: 5 } : {}),
    );
  }
  if (s.tool === 'reserve') {
    fake.rules.verdictFor = () =>
      s.block ? { decision: 'block', reasons: ['blocked'] } : { decision: 'allow', reasons: [] };
  }
  fake.events.schedule.reserved.push(...(s.tool === 'cancel' ? [s.ids[0] ?? TRIPLE.a] : []));
  fake.events.schedule.favorites.push(...(s.tool === 'unfavorite' ? [s.ids[0] ?? TRIPLE.a] : []));
  return { fake, ctx: contextFor(fake) };
}

async function run(tool: Tool, ids: string[], ctx: ReturnType<typeof contextFor>) {
  const first = ids[0] ?? TRIPLE.a;
  const layover: PersonalTimeInput = {
    startDateTime: '2026-12-01T12:00:00-08:00',
    endDateTime: '2026-12-01T12:30:00-08:00',
    title: 'Lunch',
    description: 'Eat',
  };
  switch (tool) {
    case 'reserve':
      return reserveWithGuardrails({ sessionIds: ids }, ctx);
    case 'cancel':
      return cancelReservation({ sessionId: first }, ctx);
    case 'favorite':
      return addStandby({ sessionIds: ids }, ctx);
    case 'unfavorite':
      return removeStandby({ sessionId: first }, ctx);
    case 'layover':
      return addLayover({ action: 'create', personalTime: layover }, ctx);
  }
}

// Feature: compass-power, Property 31: A block sends nothing and an allow sends exactly once
describe('Property 31: a block sends nothing and an allow sends exactly once', () => {
  test('no write is ever sent twice, and a clean allow sends exactly one', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (s) => {
        const { fake, ctx } = arrange(s);
        await run(s.tool, s.ids, ctx).catch(() => undefined);
        const sent = fake.events.callsTo(METHOD[s.tool]).length;
        expect(sent).toBeLessThanOrEqual(1);
        expect(fake.events.writeCalls.length).toBeLessThanOrEqual(1);
        if (s.tool === 'reserve' && s.block) {
          expect(sent).toBe(0);
        } else {
          expect(sent).toBe(1);
        }
      }),
      { numRuns: 200 },
    );
  });

  test('a clash inside one request blocks even when the guardrail would allow each alone', async () => {
    const fake = createFakeRuntime({ catalog: syntheticCatalogView() });
    await reserveWithGuardrails({ sessionIds: [TRIPLE.a, TRIPLE.b] }, contextFor(fake));
    expect(fake.events.callsTo('reserve')).toEqual([]);
  });
});

// Feature: compass-power, Property 32: Success is reported only when the schedule confirms it
describe('Property 32: success is reported only when the schedule confirms it', () => {
  test('reserved, favorited, removed, cancelled and added agree with the confirmed schedule', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (s) => {
        fc.pre(s.error === undefined && !(s.tool === 'reserve' && s.block));
        const { fake, ctx } = arrange(s);
        const outcome = await run(s.tool, s.ids, ctx);
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        const schedule = fake.events.schedule;
        const unconfirmed = s.confirm === 'unconfirmed';
        switch (s.tool) {
          case 'reserve': {
            const result = mcpTools.reserve_with_guardrails.output.parse(outcome.structured).result;
            const refused = new Set(s.failures.map(([id]) => id));
            for (const id of result?.successful ?? []) {
              expect(unconfirmed).toBe(false);
              expect(schedule.reserved).toContain(id);
              expect(refused.has(id)).toBe(false);
            }
            for (const id of s.ids) {
              if (refused.has(id))
                expect(result?.failed.some((f) => f.sessionId === id)).toBe(true);
            }
            break;
          }
          case 'favorite': {
            const result = mcpTools.add_standby.output.parse(outcome.structured).result;
            for (const id of result.successful) {
              expect(unconfirmed).toBe(false);
              expect(schedule.favorites).toContain(id);
            }
            break;
          }
          case 'cancel': {
            const { cancelled } = mcpTools.cancel_reservation.output.parse(outcome.structured);
            expect(cancelled).toBe(
              !unconfirmed && !schedule.reserved.includes(s.ids[0] ?? TRIPLE.a),
            );
            break;
          }
          case 'unfavorite': {
            const { removed } = mcpTools.remove_standby.output.parse(outcome.structured);
            expect(removed).toBe(
              !unconfirmed && !schedule.favorites.includes(s.ids[0] ?? TRIPLE.a),
            );
            break;
          }
          case 'layover': {
            const out = mcpTools.add_layover.output.parse(outcome.structured);
            const entry = schedule.personalTime[0];
            expect(out.done).toBe(!unconfirmed && entry !== undefined);
            expect(out.personalTimeId).toBe(out.done ? entry?.personalTimeId : undefined);
            break;
          }
        }
        if (unconfirmed) {
          expect(outcome.text).toContain('unconfirmed');
        }
      }),
      { numRuns: 200 },
    );
  });
});

// Feature: compass-power, Property 34: Invalid layovers never reach S1
describe('Property 34: invalid layovers never reach S1', () => {
  const instantArb = fc.record({
    day: fc.integer({ min: 27, max: 30 }),
    hour: fc.integer({ min: 0, max: 22 }),
  });
  const timeArb = fc.constantFrom('offset', 'offset', 'offset', 'offset', 'noOffset', 'garbage');
  const specArb = fc.record({
    start: instantArb,
    lengthMinutes: fc.integer({ min: -30, max: 50 }),
    startKind: timeArb,
    endKind: timeArb,
    month: fc.constantFrom(11, 11, 11, 12),
  });

  const text = (
    month: number,
    day: number,
    hour: number,
    minutes: number,
    kind: string,
  ): string => {
    const base = new Date(Date.UTC(2026, month - 1, day, hour, minutes % 60));
    const iso = base.toISOString().slice(0, 19);
    return kind === 'offset' ? `${iso}-08:00` : kind === 'noOffset' ? iso : 'garbage';
  };

  test('invalid input makes no S1 call and valid input makes exactly one CreatePersonalTime', async () => {
    await fc.assert(
      fc.asyncProperty(specArb, async (spec) => {
        const fake = createFakeRuntime({ catalog: syntheticCatalogView() });
        await fake.runtime.snapshot.write({
          version: 1,
          mode: 'simulated',
          fetchedAt: 'x',
          eventWindow: fake.events.window,
          schedule: { reserved: [], favorites: [], personalTime: [] },
        });
        const startText = text(spec.month, spec.start.day, spec.start.hour, 0, spec.startKind);
        const endText = text(
          spec.month,
          spec.start.day,
          spec.start.hour,
          spec.lengthMinutes,
          spec.endKind,
        );
        const start = Date.parse(spec.startKind === 'offset' ? startText : 'x');
        const end = Date.parse(spec.endKind === 'offset' ? endText : 'x');
        const windowStart = Date.parse(fake.events.window.start);
        const windowEnd = Date.parse(fake.events.window.end);
        const valid =
          spec.startKind === 'offset' &&
          spec.endKind === 'offset' &&
          end > start &&
          start % 300000 === 0 &&
          end % 300000 === 0 &&
          start >= windowStart &&
          end <= windowEnd;
        const input = {
          action: 'create' as const,
          personalTime: {
            startDateTime: startText,
            endDateTime: endText,
            title: 'Rest',
            description: '',
          },
        };
        const result = await addLayover(input, contextFor(fake)).catch((error: unknown) => error);
        if (valid) {
          expect(fake.events.callsTo('createPersonalTime')).toHaveLength(1);
        } else {
          expect(result).toBeInstanceOf(CompassError);
          expect(fake.events.calls).toEqual([]);
        }
      }),
      { numRuns: 200 },
    );
  });
});
