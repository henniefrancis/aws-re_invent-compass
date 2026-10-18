import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { CompassError } from '../../src/ports/errors.js';
import { cancelReservation } from '../../src/tools/cancel-reservation.js';
import type { ToolContext } from '../../src/server/types.js';
import { connect, textOf } from '../support/connect.js';
import { contextFor } from '../support/context.js';
import { syntheticCatalogView } from '../support/fake-catalog.js';
import { createFakeRuntime } from '../support/fake-runtime.js';
import { TRIPLE } from '../support/triple.js';

type Answer = 'accept' | 'decline' | 'cancel';

function setup(
  options: { elicit?: ToolContext['elicit']; swap?: boolean; repeatId?: string } = {},
) {
  const fake = createFakeRuntime({ catalog: syntheticCatalogView() });
  fake.events.schedule.reserved.push(TRIPLE.a);
  const ctx = contextFor(fake, options.elicit === undefined ? {} : { elicit: options.elicit });
  if (options.swap === true) {
    ctx.state.swaps.propose({
      originalId: TRIPLE.a,
      repeatId: options.repeatId ?? TRIPLE.aRepeat,
      blockedId: TRIPLE.b,
    });
  }
  return { fake, ctx };
}

const answering =
  (answer: Answer): ToolContext['elicit'] =>
  () =>
    Promise.resolve(answer);

describe('cancel_reservation without a swap', () => {
  test('cancels once, reports it only because the schedule confirms it, and updates the snapshot', async () => {
    const { fake, ctx } = setup();
    const outcome = await cancelReservation({ sessionId: TRIPLE.a }, ctx);
    expect(outcome.ok && outcome.structured).toEqual({ cancelled: true });
    expect(fake.events.callsTo('cancel')).toHaveLength(1);
    expect(fake.snapshot.writes.at(-1)?.schedule.reserved).toEqual([]);
    expect(outcome.ok && outcome.text).toContain('confirms it');
  });

  test('a session that is not reserved is not cancelled and nothing is sent', async () => {
    const { fake, ctx } = setup();
    fake.events.schedule.reserved = [];
    const outcome = await cancelReservation({ sessionId: TRIPLE.a }, ctx);
    expect(outcome.ok && outcome.structured).toEqual({ cancelled: false });
    expect(outcome.ok && outcome.text).toContain('not on your reserved list');
    expect(fake.events.writeCalls).toEqual([]);
  });

  test('a write that the schedule does not confirm is not reported as cancelled', async () => {
    const { fake, ctx } = setup();
    fake.events.ignoreWrites = true;
    const outcome = await cancelReservation({ sessionId: TRIPLE.a }, ctx);
    expect(outcome.ok && outcome.structured).toEqual({ cancelled: false });
    expect(outcome.ok && outcome.text).toContain('still lists the session');
  });

  test('an unconfirmed write is reported as unconfirmed and not resent', async () => {
    const { fake, ctx } = setup();
    fake.events.confirm = 'unconfirmed';
    const outcome = await cancelReservation({ sessionId: TRIPLE.a }, ctx);
    expect(outcome.ok && outcome.structured).toEqual({ cancelled: false });
    expect(outcome.ok && outcome.text).toContain('unconfirmed');
    expect(fake.events.callsTo('cancel')).toHaveLength(1);
  });

  test('tells the attendee to sync when a pass was issued for the session', async () => {
    const { fake, ctx } = setup();
    fake.passes.seed(TRIPLE.a, `${TRIPLE.codes.a}`);
    const outcome = await cancelReservation({ sessionId: TRIPLE.a }, ctx);
    expect(outcome.ok && outcome.text).toContain('Run sync_passes to void it.');
    const other = setup();
    other.fake.passes.seed('other-id', 'OTHER1');
    const second = await cancelReservation({ sessionId: TRIPLE.a }, other.ctx);
    expect(second.ok && second.text).not.toContain('sync_passes');
  });

  test('a rate limit reports the wait and does not retry', async () => {
    const { fake } = setup();
    fake.events.failWith.set('cancel', new CompassError('RateLimited', { retryAfterSeconds: 9 }));
    const connection = await connect(fake.runtime);
    const result = await connection.call('cancel_reservation', { sessionId: TRIPLE.a });
    expect(textOf(result)).toContain('Wait 9 seconds');
    expect(fake.events.callsTo('cancel')).toHaveLength(1);
    await connection.close();
  });

  test('refuses a bad id, an unknown session and a signed-out attendee', async () => {
    const { fake, ctx } = setup();
    await expect(cancelReservation({ sessionId: 'a/b' }, ctx)).rejects.toMatchObject({
      code: 'IdentifierRejected',
    });
    expect(fake.events.calls).toEqual([]);
    await expect(cancelReservation({ sessionId: 'ghost' }, ctx)).rejects.toMatchObject({
      code: 'UnknownSession',
    });
    fake.events.signedIn = false;
    await expect(cancelReservation({ sessionId: TRIPLE.a }, ctx)).rejects.toMatchObject({
      code: 'NotSignedIn',
    });
  });

  test('a swap whose repeat is not in the catalog is ignored', async () => {
    const { fake, ctx } = setup({ swap: true, repeatId: 'ghost' });
    const outcome = await cancelReservation({ sessionId: TRIPLE.a }, ctx);
    expect(outcome.ok && outcome.structured).toEqual({ cancelled: true });
    expect(fake.rules.calls.filter((c) => c.method === 'planSafeSwap')).toEqual([]);
  });
});

describe('cancel_reservation confirmation (CTO review M4)', () => {
  test('asks with the id, code and catalog title and cancels only on accept', async () => {
    const asked: string[] = [];
    const { fake, ctx } = setup({
      elicit: (q) => (asked.push(q.message), Promise.resolve('accept')),
    });
    await cancelReservation({ sessionId: TRIPLE.a }, ctx);
    expect(asked[0]).toContain(`${TRIPLE.codes.a} "${TRIPLE.titles.a}" (id ${TRIPLE.a})`);
    expect(fake.events.callsTo('cancel')).toHaveLength(1);
    for (const answer of ['decline', 'cancel'] as const) {
      const declined = setup({ elicit: answering(answer) });
      const outcome = await cancelReservation({ sessionId: TRIPLE.a }, declined.ctx);
      expect(outcome.ok && outcome.text).toContain('did not confirm');
      expect(declined.fake.events.writeCalls).toEqual([]);
    }
  });
});

describe('cancel_reservation with a pending swap (CTO review M1)', () => {
  test('a safe swap cancels and clears the swap', async () => {
    const { fake, ctx } = setup({ swap: true });
    const outcome = await cancelReservation({ sessionId: TRIPLE.a }, ctx);
    expect(outcome.ok && outcome.structured).toEqual({ cancelled: true });
    expect(ctx.state.swaps.forOriginal(TRIPLE.a)).toBeUndefined();
    expect(fake.rules.calls.filter((c) => c.method === 'planSafeSwap')).toHaveLength(1);
  });

  test('an unsafe swap is refused for a client that cannot ask, every time, until the repeat is confirmed (security M5)', async () => {
    const { fake, ctx } = setup({ swap: true });
    fake.rules.swapOutcome = { outcome: 'unsafe', explanation: 'The repeat is not confirmed.' };
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const outcome = await cancelReservation({ sessionId: TRIPLE.a }, ctx);
      expect(outcome.ok && outcome.structured).toEqual({ cancelled: false });
      expect(outcome.ok && outcome.text).toContain('neither seat');
      expect(outcome.ok && outcome.text).toContain(
        'Reserve the repeat first, check your schedule, then ask again.',
      );
      expect(outcome.ok && outcome.text).not.toContain('within 5 minutes');
      fake.clock.set(new Date(fake.clock.now().getTime() + 24 * 3600 * 1000).toISOString());
    }
    expect(fake.events.writeCalls).toEqual([]);
    expect(ctx.state.swaps.forOriginal(TRIPLE.a)).toBeDefined();
    fake.rules.swapOutcome = { outcome: 'safe', explanation: 'The repeat is held.' };
    const safe = await cancelReservation({ sessionId: TRIPLE.a }, ctx);
    expect(safe.ok && safe.structured).toEqual({ cancelled: true });
    expect(fake.events.callsTo('cancel')).toHaveLength(1);
  });

  test('with elicitation the second call needs an explicit cancel anyway', async () => {
    for (const answer of ['accept', 'decline', 'cancel'] as const) {
      const asked: string[] = [];
      const { fake, ctx } = setup({
        swap: true,
        elicit: (q) => (asked.push(q.message), Promise.resolve(answer)),
      });
      fake.rules.swapOutcome = { outcome: 'unsafe', explanation: 'x' };
      const first = await cancelReservation({ sessionId: TRIPLE.a }, ctx);
      expect(first.ok && first.text).toContain('"cancel anyway"');
      expect(asked).toEqual([]);
      const second = await cancelReservation({ sessionId: TRIPLE.a }, ctx);
      expect(asked).toHaveLength(1);
      expect(asked[0]).toContain('Cancel anyway?');
      expect(fake.events.callsTo('cancel')).toHaveLength(answer === 'accept' ? 1 : 0);
      expect(second.ok && second.structured).toEqual({ cancelled: answer === 'accept' });
    }
  });
});

// Feature: compass-power, Property 33: The swap ledger never risks both seats
describe('Property 33: the swap ledger never risks both seats', () => {
  test('first cancel only when safe; a second call cancels exactly once, and only with an elicited accept', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<'safe' | 'unsafe' | 'failed'>('safe', 'unsafe', 'failed'),
        fc.boolean(),
        fc.constantFrom<Answer>('accept', 'decline', 'cancel'),
        fc.integer({ min: 0, max: 100_000 }),
        async (outcome, canElicit, answer, secondsLater) => {
          const asked: string[] = [];
          const elicit: ToolContext['elicit'] = canElicit
            ? (question) => {
                asked.push(question.message);
                return Promise.resolve(
                  question.message.startsWith('Cancel anyway?') ? answer : 'accept',
                );
              }
            : undefined;
          const { fake, ctx } = setup({ swap: true, ...(elicit === undefined ? {} : { elicit }) });
          fake.rules.swapOutcome = { outcome, explanation: 'e' };
          const first = await cancelReservation({ sessionId: TRIPLE.a }, ctx);
          if (outcome === 'safe') {
            expect(fake.events.callsTo('cancel')).toHaveLength(1);
            expect(first.ok && first.structured).toEqual({ cancelled: true });
            return;
          }
          expect(fake.events.callsTo('cancel')).toHaveLength(0);
          expect(first.ok && first.structured).toEqual({ cancelled: false });
          fake.clock.set(new Date(fake.clock.now().getTime() + secondsLater * 1000).toISOString());
          const second = await cancelReservation({ sessionId: TRIPLE.a }, ctx);
          // Only an elicited, accepted "cancel anyway" overrides; time never does (security M5).
          const honoured = canElicit && answer === 'accept';
          expect(fake.events.callsTo('cancel')).toHaveLength(honoured ? 1 : 0);
          expect(second.ok && second.structured).toEqual({ cancelled: honoured });
          expect(ctx.state.swaps.forOriginal(TRIPLE.a) === undefined).toBe(honoured);
        },
      ),
      { numRuns: 100 },
    );
  });
});
