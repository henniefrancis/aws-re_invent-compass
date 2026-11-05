// check_itinerary input (compass-power task 69): a proposed session needs only its id, the full
// reserved-session form still works, personal time needs its title and times, and no commitments
// at all means "check my schedule as it is".
import { describe, expect, test } from 'vitest';
import { mcpTools } from '../src/index.js';

const input = mcpTools.check_itinerary.input;

describe('check_itinerary input', () => {
  test('takes no arguments, to check the schedule as it is', () => {
    expect(input.parse({})).toEqual({});
    expect(input.parse({ commitments: [] })).toEqual({ commitments: [] });
  });

  test('a proposed session needs only its id', () => {
    expect(input.parse({ commitments: [{ sessionId: '1780441465771001GPVt' }] })).toEqual({
      commitments: [{ sessionId: '1780441465771001GPVt' }],
    });
  });

  test('the full reserved-session form still works', () => {
    const full = {
      kind: 'reservedSession',
      sessionId: 's1',
      startsAt: '2026-12-01T17:00:00.000Z',
      endsAt: '2026-12-01T18:00:00.000Z',
    };
    expect(input.parse({ commitments: [full] })).toEqual({ commitments: [full] });
  });

  test('personal time keeps its own shape and needs its times', () => {
    const lunch = {
      kind: 'personalTime',
      title: 'Lunch',
      startsAt: '2026-12-01T20:00:00.000Z',
      endsAt: '2026-12-01T21:00:00.000Z',
    };
    expect(input.parse({ commitments: [lunch] })).toEqual({ commitments: [lunch] });
    expect(
      input.safeParse({ commitments: [{ kind: 'personalTime', title: 'Lunch' }] }).success,
    ).toBe(false);
  });

  test('rejects an entry with no session id and no personal time, and more than 80 entries', () => {
    expect(input.safeParse({ commitments: [{ id: 'x' }] }).success).toBe(false);
    expect(
      input.safeParse({ commitments: [{ kind: 'personalTime', sessionId: 's1' }] }).success,
    ).toBe(false);
    const many = Array.from({ length: 81 }, (_, i) => ({ sessionId: `s${i}` }));
    expect(input.safeParse({ commitments: many }).success).toBe(false);
  });
});
