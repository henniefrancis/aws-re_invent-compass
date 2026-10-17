import { describe, expect, test } from 'vitest';
import { mcpTools } from '@compass/contracts';
import type { BulkResult } from '@compass/contracts';
import { CompassError } from '../../src/ports/errors.js';
import type { ConfirmedWriteResult } from '../../src/ports/events-port.js';
import { reserveWithGuardrails } from '../../src/tools/reserve-with-guardrails.js';
import type { ToolContext } from '../../src/server/types.js';
import { connect, textOf } from '../support/connect.js';
import { contextFor } from '../support/context.js';
import { syntheticCatalogView } from '../support/fake-catalog.js';
import { createFakeRuntime } from '../support/fake-runtime.js';
import { TRIPLE } from '../support/triple.js';

function setup(elicit?: ToolContext['elicit']) {
  const fake = createFakeRuntime({ catalog: syntheticCatalogView() });
  const ctx = contextFor(fake, elicit === undefined ? {} : { elicit });
  return { fake, ctx };
}

function parsed(outcome: Awaited<ReturnType<typeof reserveWithGuardrails>>) {
  if (!outcome.ok) throw new Error('expected a success outcome');
  return {
    output: mcpTools.reserve_with_guardrails.output.parse(outcome.structured),
    text: outcome.text,
  };
}

describe('reserve_with_guardrails', () => {
  test('an allowed booking is sent once and reported only when the schedule confirms it', async () => {
    const { fake, ctx } = setup();
    const { output, text } = parsed(await reserveWithGuardrails({ sessionIds: [TRIPLE.a] }, ctx));
    expect(fake.events.callsTo('reserve')).toHaveLength(1);
    expect(fake.events.callsTo('reserve')[0]?.args).toEqual([[TRIPLE.a]]);
    expect(output.result).toEqual({ successful: [TRIPLE.a], failed: [] });
    expect(text).toContain('1 of 1 sessions are reserved and confirmed');
    expect(text).toContain('ANT163');
    expect(fake.snapshot.writes).toHaveLength(2);
    expect(fake.snapshot.writes[1]?.schedule.reserved).toEqual([TRIPLE.a]);
  });

  test('a clash with a reservation blocks, sends nothing and records the safe swap', async () => {
    const { fake, ctx } = setup();
    fake.events.schedule.reserved.push(TRIPLE.a);
    const { output, text } = parsed(await reserveWithGuardrails({ sessionIds: [TRIPLE.b] }, ctx));
    expect(output.verdict.decision).toBe('block');
    expect(output.result).toBeUndefined();
    expect(fake.events.writeCalls).toEqual([]);
    expect(text).toContain('Nothing was reserved, because the booking guardrail blocked it.');
    expect(text).toContain('ANT163-R');
    expect(ctx.state.swaps.forOriginal(TRIPLE.a)).toMatchObject({
      repeatId: TRIPLE.aRepeat,
      blockedId: TRIPLE.b,
    });
  });

  test('a block offers a safe repeat of the blocked session as a rebooking option', async () => {
    const { fake, ctx } = setup();
    fake.events.schedule.reserved.push(TRIPLE.b);
    const { output, text } = parsed(await reserveWithGuardrails({ sessionIds: [TRIPLE.a] }, ctx));
    expect(output.verdict.decision).toBe('block');
    expect(text).toContain('"code": "ANT163-R"');
  });

  test('two requested sessions that clash with each other block the whole request', async () => {
    const { fake, ctx } = setup();
    const { output } = parsed(
      await reserveWithGuardrails({ sessionIds: [TRIPLE.a, TRIPLE.b] }, ctx),
    );
    expect(output.verdict.decision).toBe('block');
    expect(fake.events.writeCalls).toEqual([]);
    expect(ctx.state.swaps.forOriginal(TRIPLE.a)).toBeUndefined();
  });

  test('a full session is refused in plain English with rebooking options', async () => {
    const { fake, ctx } = setup();
    fake.events.reserveFailures.set(TRIPLE.a, { code: 'sessionFull' });
    const { output, text } = parsed(await reserveWithGuardrails({ sessionIds: [TRIPLE.a] }, ctx));
    expect(output.result).toEqual({
      successful: [],
      failed: [{ sessionId: TRIPLE.a, code: 'sessionFull' }],
    });
    expect(text).toContain('This session is full.');
    expect(text).toContain('ANT163-R');
  });

  test('a refusal for a code Compass does not know is reported without echoing it', async () => {
    const { fake, ctx } = setup();
    fake.events.reserveFailures.set(TRIPLE.a, { code: 'brandNewCode' });
    const { text } = parsed(await reserveWithGuardrails({ sessionIds: [TRIPLE.a] }, ctx));
    expect(text).toContain('a reason Compass does not recognise');
    expect(text).not.toContain('brandNewCode');
  });

  test('only the full session in a batch gets rebooking options', async () => {
    const { fake, ctx } = setup();
    fake.events.reserveFailures.set(TRIPLE.a, { code: 'sessionFull' });
    const { output, text } = parsed(
      await reserveWithGuardrails({ sessionIds: [TRIPLE.a, TRIPLE.aRepeat] }, ctx),
    );
    expect(output.result?.successful).toEqual([TRIPLE.aRepeat]);
    expect(text).toContain('"forCode": "ANT163"');
  });

  test('a conflict refusal without clash ids or with unknown ids stays general', async () => {
    for (const conflictsWith of [undefined, ['ghost']]) {
      const { fake, ctx } = setup();
      fake.events.reserveFailures.set(TRIPLE.a, {
        code: 'scheduleConflict',
        ...(conflictsWith === undefined ? {} : { conflictsWith }),
      });
      const { text } = parsed(await reserveWithGuardrails({ sessionIds: [TRIPLE.a] }, ctx));
      expect(text).toContain('overlaps something already on your schedule');
    }
  });

  test('a conflict refusal names the clashing sessions from the catalog', async () => {
    const { fake, ctx } = setup();
    fake.events.reserveFailures.set(TRIPLE.a, {
      code: 'scheduleConflict',
      conflictsWith: [TRIPLE.b, 'ghost'],
    });
    const { text } = parsed(await reserveWithGuardrails({ sessionIds: [TRIPLE.a] }, ctx));
    expect(text).toContain('This session overlaps BWP304');
  });

  test('an unconfirmed write is reported as unconfirmed and is never resent', async () => {
    const { fake, ctx } = setup();
    fake.events.confirm = 'unconfirmed';
    const { output, text } = parsed(await reserveWithGuardrails({ sessionIds: [TRIPLE.a] }, ctx));
    expect(text).toContain('so it is unconfirmed');
    expect(output.result).toEqual({
      successful: [],
      failed: [{ sessionId: TRIPLE.a, code: 'notConfirmed' }],
    });
    expect(fake.events.callsTo('reserve')).toHaveLength(1);
    expect(fake.snapshot.writes).toHaveLength(1);
  });

  test('a session reported successful but missing from the schedule is not reported reserved', async () => {
    const { fake, ctx } = setup();
    fake.events.ignoreWrites = true;
    const { output, text } = parsed(await reserveWithGuardrails({ sessionIds: [TRIPLE.a] }, ctx));
    expect(output.result?.successful).toEqual([]);
    expect(text).toContain('your schedule does not confirm it yet');
  });

  test('a session the Events service did not answer for is reported as such', async () => {
    const { fake, ctx } = setup();
    fake.events.reserve = (): Promise<ConfirmedWriteResult<BulkResult>> =>
      Promise.resolve({
        kind: 'confirmed',
        result: { successful: [], failed: [] },
        schedule: { reserved: [], favorites: [], personalTime: [] },
      });
    const { text } = parsed(await reserveWithGuardrails({ sessionIds: [TRIPLE.a] }, ctx));
    expect(text).toContain('gave no answer');
  });

  test('a rate limit reports the wait and does not retry the write', async () => {
    const { fake } = setup();
    fake.events.failWith.set('reserve', new CompassError('RateLimited', { retryAfterSeconds: 12 }));
    const connection = await connect(fake.runtime);
    const result = await connection.call('reserve_with_guardrails', { sessionIds: [TRIPLE.a] });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Wait 12 seconds');
    expect(fake.events.callsTo('reserve')).toHaveLength(1);
    await connection.close();
  });

  test('warnings come first and the booking still goes ahead', async () => {
    const { fake, ctx } = setup();
    fake.rules.verdictFor = () => ({ decision: 'warn', reasons: ['"Tight walk" between rooms.'] });
    const { output, text } = parsed(await reserveWithGuardrails({ sessionIds: [TRIPLE.a] }, ctx));
    expect(output.verdict.decision).toBe('warn');
    expect(text.startsWith('Warnings first:')).toBe(true);
    expect(text).toContain('ANT163: \\"Tight walk\\" between rooms.');
    expect(fake.events.callsTo('reserve')).toHaveLength(1);
  });

  test('refuses bad ids before any S1 call, unknown sessions, a signed-out attendee and no catalog', async () => {
    const { fake, ctx } = setup();
    await expect(reserveWithGuardrails({ sessionIds: ['../etc'] }, ctx)).rejects.toMatchObject({
      code: 'IdentifierRejected',
    });
    expect(fake.events.calls).toEqual([]);
    await expect(reserveWithGuardrails({ sessionIds: ['ghost'] }, ctx)).rejects.toMatchObject({
      code: 'UnknownSession',
    });
    expect(fake.events.writeCalls).toEqual([]);
    fake.events.signedIn = false;
    await expect(reserveWithGuardrails({ sessionIds: [TRIPLE.a] }, ctx)).rejects.toMatchObject({
      code: 'NotSignedIn',
    });
    fake.events.signedIn = true;
    fake.events.catalogView = undefined;
    await expect(reserveWithGuardrails({ sessionIds: [TRIPLE.a] }, ctx)).rejects.toMatchObject({
      code: 'CatalogMissing',
    });
  });
});

describe('reserve_with_guardrails confirmation (CTO review M4)', () => {
  test('a client with elicitation is asked with ids, codes, catalog titles and warnings, and accept books', async () => {
    const asked: string[] = [];
    const { fake, ctx } = setup((question) => {
      asked.push(question.message);
      return Promise.resolve('accept');
    });
    fake.rules.verdictFor = () => ({ decision: 'warn', reasons: ['Tight walk.'] });
    await reserveWithGuardrails({ sessionIds: [TRIPLE.a] }, ctx);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain(`ANT163 "Identity and access: Hands on workshop" (id ${TRIPLE.a})`);
    expect(asked[0]).toContain('Warning: ANT163: Tight walk.');
    expect(fake.events.callsTo('reserve')).toHaveLength(1);
  });

  test('decline and cancel mean no write', async () => {
    for (const answer of ['decline', 'cancel'] as const) {
      const { fake, ctx } = setup(() => Promise.resolve(answer));
      const { text, output } = parsed(await reserveWithGuardrails({ sessionIds: [TRIPLE.a] }, ctx));
      expect(text).toContain('because you did not confirm');
      expect(output.result).toBeUndefined();
      expect(fake.events.writeCalls).toEqual([]);
    }
  });

  test('a block is returned without asking anything', async () => {
    const asked: string[] = [];
    const { fake, ctx } = setup((question) => {
      asked.push(question.message);
      return Promise.resolve('accept');
    });
    fake.events.schedule.reserved.push(TRIPLE.a);
    await reserveWithGuardrails({ sessionIds: [TRIPLE.b] }, ctx);
    expect(asked).toEqual([]);
  });
});
