import { describe, expect, test } from 'vitest';
import { mcpTools } from '@compass/contracts';
import type { Commitment } from '@compass/contracts';
import { checkItinerary } from '../../src/tools/check-itinerary.js';
import { contextFor } from '../support/context.js';
import { syntheticCatalogView } from '../support/fake-catalog.js';
import { createFakeRuntime } from '../support/fake-runtime.js';
import { TRIPLE } from '../support/triple.js';
import { connect, textOf } from '../support/connect.js';

function setup() {
  const fake = createFakeRuntime({ catalog: syntheticCatalogView() });
  return { fake, ctx: contextFor(fake) };
}

const reserved = (sessionId: string): Commitment => ({
  kind: 'reservedSession',
  sessionId,
  startsAt: '',
  endsAt: '',
});

describe('check_itinerary', () => {
  test('allows a clean itinerary and lists ids, codes and catalog titles as labelled data', async () => {
    const { fake, ctx } = setup();
    const outcome = await checkItinerary({ commitments: [reserved(TRIPLE.a)] }, ctx);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(mcpTools.check_itinerary.output.parse(outcome.structured).verdict.decision).toBe(
      'allow',
    );
    expect(outcome.text).toContain('Verdict: allow.');
    expect(outcome.text).toContain('ANT163');
    expect(outcome.text).toContain('Identity and access: Hands on workshop');
    expect(fake.events.writeCalls).toEqual([]);
    expect(fake.snapshot.writes).toHaveLength(1);
  });

  test('a clash inside the proposal blocks and suggests a rebooking or safe swap', async () => {
    const { fake, ctx } = setup();
    fake.events.schedule.reserved.push(TRIPLE.a);
    const outcome = await checkItinerary({ commitments: [reserved(TRIPLE.b)] }, ctx);
    expect(outcome.ok && outcome.text).toContain('Verdict: block.');
    expect(outcome.ok && outcome.text).toContain('Do not reserve these sessions as they are.');
    expect(outcome.ok && outcome.text).toContain('ANT163-R');
    expect(outcome.ok && outcome.text).toContain('safeSwap');
    const internal = await checkItinerary(
      { commitments: [reserved(TRIPLE.a), reserved(TRIPLE.b)] },
      setup().ctx,
    );
    expect(
      internal.ok && mcpTools.check_itinerary.output.parse(internal.structured).verdict.decision,
    ).toBe('block');
  });

  test('a session that is already reserved is not checked against itself', async () => {
    const { fake, ctx } = setup();
    fake.events.schedule.reserved.push(TRIPLE.a);
    const outcome = await checkItinerary({ commitments: [reserved(TRIPLE.a)] }, ctx);
    expect(
      outcome.ok && mcpTools.check_itinerary.output.parse(outcome.structured).verdict.decision,
    ).toBe('allow');
  });

  test('proposed personal time joins the schedule', async () => {
    const { ctx } = setup();
    const outcome = await checkItinerary(
      {
        commitments: [
          {
            kind: 'personalTime',
            title: 'Lunch',
            startsAt: '2026-12-04T18:00:00.000Z',
            endsAt: '2026-12-04T19:00:00.000Z',
          },
          reserved(TRIPLE.a),
        ],
      },
      ctx,
    );
    expect(
      outcome.ok && mcpTools.check_itinerary.output.parse(outcome.structured).verdict.decision,
    ).toBe('block');
  });

  test('a warn verdict is reported without a suggestion block', async () => {
    const { fake, ctx } = setup();
    fake.rules.verdictFor = () => ({ decision: 'warn', reasons: ['Tight walk.'] });
    const outcome = await checkItinerary({ commitments: [reserved(TRIPLE.a)] }, ctx);
    expect(outcome.ok && outcome.text).toContain('Verdict: warn.');
    expect(outcome.ok && outcome.text).toContain('ANT163: Tight walk.');
  });

  test('rejects bad identifiers before any S1 call and never echoes them', async () => {
    const { fake } = setup();
    const connection = await connect(fake.runtime);
    const result = await connection.call('check_itinerary', {
      commitments: [reserved('secret/../id')],
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('One of the ids is not a valid session id.');
    expect(fake.events.calls).toEqual([]);
    await connection.close();
  });

  test('refuses unknown sessions, a signed-out attendee and a missing catalog', async () => {
    const { fake, ctx } = setup();
    await expect(checkItinerary({ commitments: [reserved('ghost')] }, ctx)).rejects.toMatchObject({
      code: 'UnknownSession',
    });
    fake.events.signedIn = false;
    await expect(checkItinerary({ commitments: [] }, ctx)).rejects.toMatchObject({
      code: 'NotSignedIn',
    });
    fake.events.signedIn = true;
    fake.events.catalogView = undefined;
    await expect(checkItinerary({ commitments: [] }, ctx)).rejects.toMatchObject({
      code: 'CatalogMissing',
    });
  });
});
