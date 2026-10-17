import { describe, expect, test } from 'vitest';
import {
  CONTEXT_DEFAULTS,
  ContextSchema,
  withContextDefaults,
  type ContextInput,
} from '../../src/rules/context.js';

// Example tests for the Context defaults (itinerary-rules, S2).
// Requirements: 4.2, 4.3, 5.3. All sample data is self-made.

const venueData = { venues: [], walkingTimes: [] };
const input: ContextInput = { now: '2026-12-01T09:00:00-08:00', venueData };

describe('withContextDefaults', () => {
  test('fills every documented default', () => {
    const context = withContextDefaults(input);
    expect(context.mealWindow).toEqual({ start: '11:30', end: '14:00', requiredFreeMinutes: 30 });
    expect(context.maxStretchMinutes).toBe(180);
    expect(context.overloadThreshold).toBe(100);
    expect(context.overloadCountThreshold).toBe(6);
    expect(context.tightMarginMinutes).toBe(5);
    expect(context.bufferMinutes).toBe(10);
    expect(context.now).toBe(input.now);
    expect(context.eventTimezone).toBeUndefined();
  });

  test('keeps caller overrides and the timezone', () => {
    const context = withContextDefaults({
      ...input,
      eventTimezone: 'America/Los_Angeles',
      maxStretchMinutes: 90,
      mealWindow: { start: '12:00', end: '13:00', requiredFreeMinutes: 20 },
    });
    expect(context.eventTimezone).toBe('America/Los_Angeles');
    expect(context.maxStretchMinutes).toBe(90);
    expect(context.mealWindow.requiredFreeMinutes).toBe(20);
    expect(context.bufferMinutes).toBe(CONTEXT_DEFAULTS.bufferMinutes);
  });

  test('does not modify its input', () => {
    const copy = structuredClone(input);
    withContextDefaults(input);
    expect(input).toEqual(copy);
  });
});

describe('withContextDefaults ignores undefined values', () => {
  test('an undefined tuning value never replaces a default', () => {
    const context = withContextDefaults({
      ...input,
      bufferMinutes: undefined,
      tightMarginMinutes: undefined,
      maxStretchMinutes: undefined,
      overloadThreshold: undefined,
      overloadCountThreshold: undefined,
      mealWindow: undefined,
      eventTimezone: undefined,
    });
    expect(context).toEqual({ ...CONTEXT_DEFAULTS, ...input });
    expect(ContextSchema.safeParse(context).success).toBe(true);
    expect('eventTimezone' in context).toBe(false);
  });

  test('present but invalid values are kept as given, so ContextSchema can refuse them', () => {
    const context = withContextDefaults({ ...input, bufferMinutes: Number.NaN });
    expect(context.bufferMinutes).toBeNaN();
    expect(ContextSchema.safeParse(context).success).toBe(false);
  });
});

describe('ContextSchema limits', () => {
  const base = withContextDefaults(input);
  const mealWindow = (overrides: object) => ({ ...base.mealWindow, ...overrides });
  const bad: Array<[string, object]> = [
    ['NaN buffer', { bufferMinutes: Number.NaN }],
    ['infinite buffer', { bufferMinutes: Number.POSITIVE_INFINITY }],
    ['negative buffer', { bufferMinutes: -1 }],
    ['buffer above 120', { bufferMinutes: 121 }],
    ['negative margin', { tightMarginMinutes: -0.5 }],
    ['margin above 60', { tightMarginMinutes: 61 }],
    ['infinite margin', { tightMarginMinutes: Number.POSITIVE_INFINITY }],
    ['zero stretch', { maxStretchMinutes: 0 }],
    ['stretch above a day', { maxStretchMinutes: 1441 }],
    ['infinite stretch', { maxStretchMinutes: Number.POSITIVE_INFINITY }],
    ['zero overload threshold', { overloadThreshold: 0 }],
    ['negative overload threshold', { overloadThreshold: -5 }],
    ['infinite overload threshold', { overloadThreshold: Number.POSITIVE_INFINITY }],
    ['NaN overload threshold', { overloadThreshold: Number.NaN }],
    ['zero count threshold', { overloadCountThreshold: 0 }],
    ['infinite count threshold', { overloadCountThreshold: Number.POSITIVE_INFINITY }],
    [
      'meal window ends before it starts',
      { mealWindow: mealWindow({ start: '14:00', end: '11:30' }) },
    ],
    ['meal window of no length', { mealWindow: mealWindow({ start: '12:00', end: '12:00' }) }],
    ['negative meal minutes', { mealWindow: mealWindow({ requiredFreeMinutes: -1 }) }],
    [
      'infinite meal minutes',
      { mealWindow: mealWindow({ requiredFreeMinutes: Number.POSITIVE_INFINITY }) },
    ],
    ['meal minutes above a day', { mealWindow: mealWindow({ requiredFreeMinutes: 1441 }) }],
    ['timezone that is not text', { eventTimezone: 42 }],
  ];

  test.each(bad)('rejects %s', (_name, override) => {
    expect(ContextSchema.safeParse({ ...base, ...override }).success).toBe(false);
  });

  test('accepts the edges of every range', () => {
    const edges = {
      ...base,
      bufferMinutes: 120,
      tightMarginMinutes: 60,
      maxStretchMinutes: 1,
      overloadThreshold: 0.5,
      overloadCountThreshold: 1,
      mealWindow: mealWindow({ start: '00:00', end: '00:01', requiredFreeMinutes: 0 }),
    };
    expect(ContextSchema.safeParse(edges).success).toBe(true);
    expect(
      ContextSchema.safeParse({ ...edges, bufferMinutes: 0, tightMarginMinutes: 0 }).success,
    ).toBe(true);
  });
});

describe('ContextSchema', () => {
  test('accepts a complete context and a missing timezone', () => {
    expect(ContextSchema.safeParse(withContextDefaults(input)).success).toBe(true);
    const withZone = withContextDefaults({ ...input, eventTimezone: 'UTC' });
    expect(ContextSchema.safeParse(withZone).success).toBe(true);
  });

  test('requires now, because it has no default', () => {
    const rest: Record<string, unknown> = { ...withContextDefaults(input) };
    delete rest.now;
    expect(ContextSchema.safeParse(rest).success).toBe(false);
  });

  test('rejects a malformed meal window clock', () => {
    const bad = {
      ...withContextDefaults(input),
      mealWindow: { start: '25:00', end: '14:00', requiredFreeMinutes: 30 },
    };
    expect(ContextSchema.safeParse(bad).success).toBe(false);
  });
});
