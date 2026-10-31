import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { connect, textOf } from '../support/connect.js';
import { syntheticCatalogView } from '../support/fake-catalog.js';
import { createFakeRuntime } from '../support/fake-runtime.js';

// Feature: compass-power, Property 28: Identifier checks run before any S1 call (tool part)
describe('Property 28: tools reject bad identifiers before any S1 call', () => {
  const bad = fc.constantFrom(
    '',
    '.',
    '..',
    'secret/name',
    'secret\name',
    `secret${String.fromCharCode(0)}name`,
    `secret${String.fromCharCode(0x85)}name`,
    `secret-${'x'.repeat(300)}`,
  );
  const calls: [string, (id: string) => Record<string, unknown>][] = [
    ['reserve_with_guardrails', (id) => ({ sessionIds: [id] })],
    ['cancel_reservation', (id) => ({ sessionId: id })],
    ['add_standby', (id) => ({ sessionIds: ['syn-096', id] })],
    ['remove_standby', (id) => ({ sessionId: id })],
    ['issue_boarding_pass', (id) => ({ sessionId: id })],
    ['send_to_phone', (id) => ({ sessionIds: [id] })],
    ['sync_passes', (id) => ({ sessionIds: [id] })],
    [
      'check_itinerary',
      (id) => ({
        commitments: [{ kind: 'reservedSession', sessionId: id, startsAt: '', endsAt: '' }],
      }),
    ],
    [
      'export_calendar',
      (id) => ({
        commitments: [{ kind: 'reservedSession', sessionId: id, startsAt: '', endsAt: '' }],
      }),
    ],
  ];

  test('no Events or Passes call happens and the error text contains none of the ids', async () => {
    for (const [tool, args] of calls) {
      await fc.assert(
        fc.asyncProperty(bad, async (id) => {
          const fake = createFakeRuntime({ catalog: syntheticCatalogView() });
          const connection = await connect(fake.runtime);
          const result = await connection.call(tool, args(id));
          expect(result.isError).toBe(true);
          expect(fake.events.calls).toEqual([]);
          expect(fake.passes.calls).toEqual([]);
          expect(textOf(result)).not.toContain('secret');
          await connection.close();
        }),
        { numRuns: 8 },
      );
    }
  });
});
