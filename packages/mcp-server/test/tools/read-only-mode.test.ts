import { describe, expect, test } from 'vitest';
import { readOnlyEvents } from '../../src/adapters/read-only-events.js';
import { CompassError } from '../../src/ports/errors.js';
import { READ_ONLY_MESSAGE, messageFor } from '../../src/server/error-messages.js';
import { addLayover } from '../../src/tools/add-layover.js';
import { addStandby } from '../../src/tools/add-standby.js';
import { cancelReservation } from '../../src/tools/cancel-reservation.js';
import { removeStandby } from '../../src/tools/remove-standby.js';
import { reserveWithGuardrails } from '../../src/tools/reserve-with-guardrails.js';
import type { ToolContext } from '../../src/server/types.js';
import { contextFor } from '../support/context.js';
import { syntheticCatalogView } from '../support/fake-catalog.js';
import { createFakeRuntime } from '../support/fake-runtime.js';
import { TRIPLE } from '../support/triple.js';

// Compass-power task 37: read-only live mode reads the real schedule and never changes it.

function setup(readOnly = true) {
  const fake = createFakeRuntime({ catalog: syntheticCatalogView(), readOnly });
  const asked: string[] = [];
  const elicit: ToolContext['elicit'] = (question) => {
    asked.push(question.message);
    return Promise.resolve('accept');
  };
  return { fake, asked, ctx: contextFor(fake, { elicit }) };
}

const lunch = {
  startDateTime: '2026-12-01T12:00:00-08:00',
  endDateTime: '2026-12-01T12:30:00-08:00',
  title: 'Lunch',
  description: 'Eat',
};

function expectReadOnly(text: string, fake: ReturnType<typeof setup>['fake'], asked: string[]) {
  expect(text.startsWith(READ_ONLY_MESSAGE)).toBe(true);
  expect(text).toContain('Compass would have done this:');
  expect(text).not.toContain('Go ahead?');
  expect(text).not.toContain('This changes your real re:Invent schedule.');
  expect(fake.events.writeCalls).toEqual([]);
  expect(asked).toEqual([]);
}

describe('read-only live mode: the schedule tools ask nothing and change nothing', () => {
  test('reserve_with_guardrails runs the guardrail and says what it would reserve', async () => {
    const { fake, asked, ctx } = setup();
    const outcome = await reserveWithGuardrails({ sessionIds: [TRIPLE.a] }, ctx);
    expect(outcome.ok && outcome.structured.verdict.decision).not.toBe('block');
    expectReadOnly(outcome.ok ? outcome.text : '', fake, asked);
    expect(outcome.ok && outcome.text).toContain(TRIPLE.codes.a);
  });

  test('cancel_reservation says what it would cancel', async () => {
    const { fake, asked, ctx } = setup();
    fake.events.schedule.reserved.push(TRIPLE.a);
    const outcome = await cancelReservation({ sessionId: TRIPLE.a }, ctx);
    expect(outcome.ok && outcome.structured).toEqual({ cancelled: false });
    expectReadOnly(outcome.ok ? outcome.text : '', fake, asked);
  });

  test('cancel_reservation does not reach the "cancel anyway" question either', async () => {
    const { fake, asked, ctx } = setup();
    fake.events.schedule.reserved.push(TRIPLE.a);
    ctx.state.swaps.propose({
      originalId: TRIPLE.a,
      repeatId: TRIPLE.aRepeat,
      blockedId: TRIPLE.b,
    });
    const outcome = await cancelReservation({ sessionId: TRIPLE.a }, ctx);
    expectReadOnly(outcome.ok ? outcome.text : '', fake, asked);
  });

  test('add_standby and remove_standby say what they would do', async () => {
    const { fake, asked, ctx } = setup();
    const added = await addStandby({ sessionIds: [TRIPLE.a] }, ctx);
    expect(added.ok && added.structured).toEqual({ result: { successful: [], failed: [] } });
    expectReadOnly(added.ok ? added.text : '', fake, asked);
    expect(added.ok && added.text).toContain('Standby is a backup');
    fake.events.schedule.favorites.push(TRIPLE.b);
    const removed = await removeStandby({ sessionId: TRIPLE.b }, ctx);
    expect(removed.ok && removed.structured).toEqual({ removed: false });
    expectReadOnly(removed.ok ? removed.text : '', fake, asked);
  });

  test('add_layover create, update and delete say what they would do', async () => {
    const { fake, asked, ctx } = setup();
    const created = await addLayover({ action: 'create', personalTime: lunch }, ctx);
    expect(created.ok && created.structured).toEqual({ action: 'create', done: false });
    expectReadOnly(created.ok ? created.text : '', fake, asked);
    fake.events.schedule.personalTime.push({ ...lunch, personalTimeId: 'pt-7' });
    const updated = await addLayover(
      {
        action: 'update',
        personalTimeId: 'pt-7',
        personalTime: { ...lunch, title: 'Late lunch' },
      },
      ctx,
    );
    expect(updated.ok && updated.structured).toEqual({ action: 'update', done: false });
    expectReadOnly(updated.ok ? updated.text : '', fake, asked);
    const deleted = await addLayover({ action: 'delete', personalTimeId: 'pt-7' }, ctx);
    expect(deleted.ok && deleted.structured).toEqual({ action: 'delete', done: false });
    expectReadOnly(deleted.ok ? deleted.text : '', fake, asked);
  });

  test('with read-only off, the tools still ask and write as before', async () => {
    const { fake, asked, ctx } = setup(false);
    await addStandby({ sessionIds: [TRIPLE.a] }, ctx);
    expect(asked).toHaveLength(1);
    expect(fake.events.callsTo('favorite')).toHaveLength(1);
  });
});

describe('read-only live mode: the Events guard', () => {
  test('every write refuses with ReadOnly and makes no call; every read passes through', async () => {
    const { fake } = setup(false);
    const guarded = readOnlyEvents(fake.events);
    const writes = [
      () => guarded.reserve([TRIPLE.a]),
      () => guarded.cancel(TRIPLE.a),
      () => guarded.favorite([TRIPLE.a]),
      () => guarded.unfavorite(TRIPLE.a),
      () => guarded.createPersonalTime(lunch),
      () => guarded.updatePersonalTime('pt-7', lunch),
      () => guarded.deletePersonalTime('pt-7'),
    ];
    for (const write of writes) {
      await expect(write()).rejects.toMatchObject({ code: 'ReadOnly' });
    }
    expect(fake.events.writeCalls).toEqual([]);

    expect(await guarded.isSignedIn()).toBe(await fake.events.isSignedIn());
    expect(await guarded.getSchedule()).toEqual(await fake.events.getSchedule());
    expect(await guarded.catalog()).toBe(await fake.events.catalog());
    expect(await guarded.eventWindow()).toEqual(await fake.events.eventWindow());
    expect(await guarded.getSession(TRIPLE.a)).toEqual(await fake.events.getSession(TRIPLE.a));
    expect(await guarded.refreshCatalog()).toEqual(await fake.events.refreshCatalog());
    expect(await guarded.signIn(false)).toEqual(await fake.events.signIn(false));
    expect(await guarded.signOut()).toEqual(await fake.events.signOut());
  });

  test('the ReadOnly error has its own plain message', () => {
    expect(messageFor(new CompassError('ReadOnly'))).toBe(READ_ONLY_MESSAGE);
  });
});
