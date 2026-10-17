import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { confirmedWrite } from '../../src/api/confirmed-write.js';
import type { GetSchedule } from '@compass/contracts';

// Property and unit tests for the confirmed-write helper (events-client, S1,
// Component 6). Covers Property 21: the helper confirms a successful write by reading
// GetSchedule exactly once, reports confirmed false when the read fails without
// re-sending, and returns the write error without reading when the write fails
// (Requirements 11.1, 11.2, 11.3, 11.4).

// A minimal valid GetSchedule value for the success path. The helper never inspects
// the schedule shape, so an empty schedule is sufficient for these tests.
const emptySchedule: GetSchedule = {
  schedule: { reserved: [], favorites: [], personalTime: [] },
};

describe('Feature: events-client, Property 21: Confirmed-write helper confirms, reports, and never re-sends', () => {
  test('a successful write reads GetSchedule exactly once and returns both', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (writeValue) => {
        let writeCalls = 0;
        let scheduleCalls = 0;
        const result = await confirmedWrite(
          () => {
            writeCalls += 1;
            return Promise.resolve(writeValue);
          },
          () => {
            scheduleCalls += 1;
            return Promise.resolve(emptySchedule);
          },
        );
        expect(writeCalls).toBe(1);
        expect(scheduleCalls).toBe(1);
        expect(result.confirmed).toBe(true);
        expect(result.write).toBe(writeValue);
        if (result.confirmed) {
          expect(result.schedule).toBe(emptySchedule);
        }
      }),
      { numRuns: 100 },
    );
  });

  test('a write failure propagates and GetSchedule is never called', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1 }), async (reason) => {
        let scheduleCalls = 0;
        const boom = new Error(reason);
        await expect(
          confirmedWrite(
            () => Promise.reject(boom),
            () => {
              scheduleCalls += 1;
              return Promise.resolve(emptySchedule);
            },
          ),
        ).rejects.toBe(boom);
        expect(scheduleCalls).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  test('a successful write with a failing GetSchedule reports confirmed false and never re-sends', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (writeValue) => {
        let writeCalls = 0;
        let scheduleCalls = 0;
        const result = await confirmedWrite(
          () => {
            writeCalls += 1;
            return Promise.resolve(writeValue);
          },
          () => {
            scheduleCalls += 1;
            return Promise.reject(new Error('schedule unavailable'));
          },
        );
        expect(writeCalls).toBe(1);
        expect(scheduleCalls).toBe(1);
        expect(result.confirmed).toBe(false);
        expect(result.write).toBe(writeValue);
      }),
      { numRuns: 100 },
    );
  });
});
