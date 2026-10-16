import { describe, expect, test } from 'vitest';
import { createPassFieldsSchema, mcpTools } from '../src/index.js';

// Unit tests for the small contract tightenings (foundation-contracts, S0):
//   - PassFields walkFromPrevious.minutes and nextConnection.walkMinutes are integers.
//   - SessionIdBatch (reserve_with_guardrails, add_standby, issue_boarding_passes)
//     rejects duplicate ids with a clear message.
//   - send_to_phone and sync_passes session id lists are capped at 80.

const PASS_WINDOW = {
  start: '2026-11-30T00:00:00-08:00',
  end: '2026-12-05T00:00:00-08:00',
  timezone: 'America/Los_Angeles',
} as const;

const PassFieldsSchema = createPassFieldsSchema(PASS_WINDOW);

const BASE = {
  sessionCode: 'AIM101',
  title: 'Valid title',
  venue: 'Venetian',
  room: 'Room 101',
  startsAt: '2026-12-01T09:00:00-08:00',
  endsAt: '2026-12-01T10:00:00-08:00',
} as const;

describe('Feature: foundation-contracts, PassFields integer tightenings', () => {
  // F: walkFromPrevious.minutes must be an integer.
  test('F: walkFromPrevious.minutes rejects a fractional value and accepts an integer', () => {
    expect(
      PassFieldsSchema.safeParse({
        ...BASE,
        walkFromPrevious: { minutes: 1.5, fromVenue: 'Aria' },
      }).success,
    ).toBe(false);
    expect(
      PassFieldsSchema.safeParse({
        ...BASE,
        walkFromPrevious: { minutes: 5, fromVenue: 'Aria' },
      }).success,
    ).toBe(true);
  });

  // F: nextConnection.walkMinutes must be an integer.
  test('F: nextConnection.walkMinutes rejects a fractional value and accepts an integer', () => {
    const nextConnection = {
      sessionCode: 'NEXT1',
      startsAt: '2026-12-01T11:00:00-08:00',
      venue: 'Wynn',
    };
    expect(
      PassFieldsSchema.safeParse({
        ...BASE,
        nextConnection: { ...nextConnection, walkMinutes: 2.5 },
      }).success,
    ).toBe(false);
    expect(
      PassFieldsSchema.safeParse({
        ...BASE,
        nextConnection: { ...nextConnection, walkMinutes: 5 },
      }).success,
    ).toBe(true);
  });
});

describe('Feature: foundation-contracts, MCP tool session id bounds', () => {
  // F: SessionIdBatch rejects duplicate ids with a clear message.
  test('F: reserve_with_guardrails rejects duplicate session ids and accepts distinct ids', () => {
    const duplicate = mcpTools.reserve_with_guardrails.input.safeParse({
      sessionIds: ['A', 'A'],
    });
    expect(duplicate.success).toBe(false);
    if (!duplicate.success) {
      expect(duplicate.error.issues[0]?.message).toBe('sessionIds must not contain duplicate ids');
    }

    expect(
      mcpTools.reserve_with_guardrails.input.safeParse({ sessionIds: ['A', 'B'] }).success,
    ).toBe(true);
  });

  test('F: add_standby and issue_boarding_passes also reject duplicate session ids', () => {
    expect(mcpTools.add_standby.input.safeParse({ sessionIds: ['X', 'X'] }).success).toBe(false);
    expect(
      mcpTools.issue_boarding_passes.input.safeParse({ sessionIds: ['X', 'X'] }).success,
    ).toBe(false);
    expect(mcpTools.add_standby.input.safeParse({ sessionIds: ['X', 'Y'] }).success).toBe(true);
    expect(
      mcpTools.issue_boarding_passes.input.safeParse({ sessionIds: ['X', 'Y'] }).success,
    ).toBe(true);
  });

  // F: send_to_phone and sync_passes session id lists are capped at 80.
  test('F: send_to_phone accepts up to 80 session ids and rejects 81', () => {
    const eighty = Array.from({ length: 80 }, (_unused, i) => `s${i}`);
    const eightyOne = Array.from({ length: 81 }, (_unused, i) => `s${i}`);
    expect(mcpTools.send_to_phone.input.safeParse({ sessionIds: eighty }).success).toBe(true);
    expect(mcpTools.send_to_phone.input.safeParse({ sessionIds: eightyOne }).success).toBe(false);
  });

  test('F: sync_passes accepts up to 80 session ids and rejects 81', () => {
    const eighty = Array.from({ length: 80 }, (_unused, i) => `s${i}`);
    const eightyOne = Array.from({ length: 81 }, (_unused, i) => `s${i}`);
    expect(mcpTools.sync_passes.input.safeParse({ sessionIds: eighty }).success).toBe(true);
    expect(mcpTools.sync_passes.input.safeParse({ sessionIds: eightyOne }).success).toBe(false);
  });
});
