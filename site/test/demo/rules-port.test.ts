import { describe, expect, test } from 'vitest';
import { DEMO_EVENT, DEMO_SESSIONS } from '../../src/lib/demo/demo-catalog';
import { createDemoRuntime } from '../../src/lib/demo/demo-deps';
import {
  REAL_ENGINE,
  createDemoContext,
  createRulesPort,
  isRulesEngineReady,
  type RulesEngine,
  type ScheduleInput,
} from '../../src/lib/demo/rules-port';
import { createFakeEngine, createRecordingEngine } from '../doubles/rules-double';

const session = DEMO_SESSIONS[0] as (typeof DEMO_SESSIONS)[number];
const schedule: ScheduleInput = { commitments: [], sessions: {} };
const context = { now: DEMO_EVENT.now, eventTimezone: DEMO_EVENT.timezone };

describe('rules port', () => {
  test('every port method hands its arguments to the engine and returns its answer', () => {
    const { engine, calls } = createRecordingEngine(
      createFakeEngine({
        checkReservation: () => ({ decision: 'allow', reasons: ['x'] }),
        planSafeSwap: () => ({ outcome: 'safe', steps: [], clashesWith: [], reason: 'ok' }),
      }),
    );
    const port = createRulesPort(engine);
    const original = { kind: 'personalTime' as const, title: 'T', startsAt: 'a', endsAt: 'b' };
    expect(port.checkReservation(session, schedule, context)).toEqual({
      decision: 'allow',
      reasons: ['x'],
    });
    port.computeBoarding(session, context);
    port.connectionsForDay(schedule, context, '2026-12-01');
    port.findClashes(schedule, context);
    port.checkLayovers(schedule, context, '2026-12-01');
    port.findRebookingOptions('ABC', [session], [], context);
    expect(port.planSafeSwap(original, session, schedule, context).outcome).toBe('safe');
    expect(calls.map(([name]) => name)).toEqual([
      'checkReservation',
      'computeBoarding',
      'connectionsForDay',
      'findClashes',
      'checkLayovers',
      'findRebookingOptions',
      'planSafeSwap',
    ]);
    expect(calls[0]?.[1]).toEqual([session, schedule, context]);
    expect(calls[2]?.[1]).toEqual([schedule, context, '2026-12-01']);
    expect(calls[5]?.[1]).toEqual(['ABC', [session], [], context]);
  });

  test('the demo context comes from the engine defaults', () => {
    const { engine, calls } = createRecordingEngine(createFakeEngine());
    const input = { now: DEMO_EVENT.now, eventTimezone: DEMO_EVENT.timezone, venueData: {} };
    expect(createDemoContext(engine, input)).toMatchObject(input);
    expect(calls.map(([name, args]) => [name, args])).toEqual([['withContextDefaults', [input]]]);
  });

  test('the engine is ready only when every function the site calls is present', () => {
    expect(isRulesEngineReady(createFakeEngine())).toBe(true);
    expect(isRulesEngineReady({})).toBe(false);
    const partial: Partial<RulesEngine> = { ...createFakeEngine() };
    delete partial.findClashes;
    expect(isRulesEngineReady(partial)).toBe(false);
    expect(isRulesEngineReady({ ...partial, findClashes: 5 as never })).toBe(false);
    expect(typeof isRulesEngineReady(REAL_ENGINE)).toBe('boolean');
  });
});

describe('demo runtime', () => {
  test('is null while the engine or the venue data is missing', () => {
    expect(createDemoRuntime({}, { venues: [] })).toBeNull();
    expect(createDemoRuntime(createFakeEngine(), null)).toBeNull();
  });

  test('builds the port, the catalog by id and the context from the fixed demo instant', () => {
    const venueData = { venues: [], walkingTimes: [] };
    const runtime = createDemoRuntime(createFakeEngine(), venueData);
    expect(runtime).not.toBeNull();
    expect(runtime?.catalog.size).toBe(DEMO_SESSIONS.length);
    expect(runtime?.catalog.get('syn-003')?.code).toBe('AIM321');
    expect(runtime?.context).toMatchObject({
      now: DEMO_EVENT.now,
      eventTimezone: 'America/Los_Angeles',
      venueData,
    });
    expect(typeof runtime?.rules.checkReservation).toBe('function');
  });
});
