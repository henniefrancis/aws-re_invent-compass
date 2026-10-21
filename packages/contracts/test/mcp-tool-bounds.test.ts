import { describe, expect, test } from 'vitest';
import { createPassFieldsSchema, mcpTools } from '../src/index.js';

// Unit tests for the small contract tightenings (foundation-contracts, S0):
//   - PassFields walkFromPrevious.minutes and nextConnection.walkMinutes are integers.
//   - SessionIdBatch (reserve_with_guardrails, add_standby)
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

  test('F: add_standby also rejects duplicate session ids', () => {
    expect(mcpTools.add_standby.input.safeParse({ sessionIds: ['X', 'X'] }).success).toBe(false);
    expect(mcpTools.add_standby.input.safeParse({ sessionIds: ['X', 'Y'] }).success).toBe(true);
  });

  // foundation-contracts task 22: issue_all_boarding_passes takes nothing, issue_boarding_pass
  // an optional session id, and the old batch tool is gone.
  test('F: the pass-issuing tools take no batch', () => {
    expect(mcpTools.issue_all_boarding_passes.input.parse({ sessionIds: ['X'] })).toEqual({});
    expect(mcpTools.issue_boarding_pass.input.safeParse({}).success).toBe(true);
    expect(mcpTools.issue_boarding_pass.input.safeParse({ sessionId: 'X' }).success).toBe(true);
    expect(mcpTools.issue_boarding_pass.input.safeParse({ sessionId: 7 }).success).toBe(false);
    expect(Object.keys(mcpTools)).not.toContain('issue_boarding_passes');
    expect(Object.keys(mcpTools)).toHaveLength(24);
  });

  // F: send_to_phone and sync_passes session id lists are capped at 80.
  test('F: send_to_phone accepts up to 80 session ids and rejects 81', () => {
    const eighty = Array.from({ length: 80 }, (_unused, i) => `s${i}`);
    const eightyOne = Array.from({ length: 81 }, (_unused, i) => `s${i}`);
    expect(mcpTools.send_to_phone.input.safeParse({ sessionIds: eighty }).success).toBe(true);
    expect(mcpTools.send_to_phone.input.safeParse({ sessionIds: eightyOne }).success).toBe(false);
    // foundation-contracts task 21: show is link, qr or both, and nothing else.
    for (const show of ['link', 'qr', 'both']) {
      expect(mcpTools.send_to_phone.input.safeParse({ show }).success).toBe(true);
    }
    expect(mcpTools.send_to_phone.input.safeParse({ show: 'email' }).success).toBe(false);
    expect(
      mcpTools.send_to_phone.output.safeParse({
        handoffUrl: 'https://example/board',
        expiresAt: '2026-12-01T00:15:00Z',
      }).success,
    ).toBe(true);
  });

  test('F: sync_passes accepts up to 80 session ids and rejects 81', () => {
    const eighty = Array.from({ length: 80 }, (_unused, i) => `s${i}`);
    const eightyOne = Array.from({ length: 81 }, (_unused, i) => `s${i}`);
    expect(mcpTools.sync_passes.input.safeParse({ sessionIds: eighty }).success).toBe(true);
    expect(mcpTools.sync_passes.input.safeParse({ sessionIds: eightyOne }).success).toBe(false);
  });
});

describe('add_layover action union', () => {
  const personalTime = {
    startDateTime: '2026-12-01T12:00:00-08:00',
    endDateTime: '2026-12-01T12:30:00-08:00',
    title: 'Lunch',
    description: 'Eat',
  };
  const input = mcpTools.add_layover.input;

  test('accepts create, update and delete in their own shapes', () => {
    expect(input.safeParse({ action: 'create', personalTime }).success).toBe(true);
    expect(
      input.safeParse({ action: 'update', personalTimeId: 'pt-1', personalTime }).success,
    ).toBe(true);
    expect(input.safeParse({ action: 'delete', personalTimeId: 'pt-1' }).success).toBe(true);
  });

  test('rejects a missing or unknown action and the old action-less shape', () => {
    expect(input.safeParse({ personalTime }).success).toBe(false);
    expect(input.safeParse({ action: 'move', personalTimeId: 'pt-1' }).success).toBe(false);
  });

  test('update and delete need a bounded, non-empty id; create needs the entry', () => {
    expect(input.safeParse({ action: 'update', personalTime }).success).toBe(false);
    expect(input.safeParse({ action: 'delete' }).success).toBe(false);
    expect(input.safeParse({ action: 'delete', personalTimeId: '' }).success).toBe(false);
    expect(input.safeParse({ action: 'delete', personalTimeId: 'x'.repeat(257) }).success).toBe(
      false,
    );
    expect(input.safeParse({ action: 'delete', personalTimeId: 'x'.repeat(256) }).success).toBe(
      true,
    );
    expect(input.safeParse({ action: 'create' }).success).toBe(false);
  });

  test('the output names the action and whether it is done', () => {
    const output = mcpTools.add_layover.output;
    expect(output.safeParse({ action: 'delete', done: true, personalTimeId: 'pt-1' }).success).toBe(
      true,
    );
    expect(output.safeParse({ action: 'delete' }).success).toBe(false);
  });
});
