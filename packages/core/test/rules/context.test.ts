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
