import { describe, expect, test } from 'vitest';
import { CompassError } from '../../src/ports/errors.js';
import { resolveSessionCodes } from '../../src/server/session-codes.js';
import { reserveWithGuardrails } from '../../src/tools/reserve-with-guardrails.js';
import { connect, textOf } from '../support/connect.js';
import { contextFor } from '../support/context.js';
import { buildCatalogView, syntheticCatalogView, wireSession } from '../support/fake-catalog.js';
import { createFakeRuntime } from '../support/fake-runtime.js';
import { TRIPLE } from '../support/triple.js';

// Compass-power task 38: session codes are accepted wherever a session id is.

function eventsWith(catalog = syntheticCatalogView()) {
  return createFakeRuntime({ catalog }).events;
}

describe('resolveSessionCodes', () => {
  test('a code, in any letter case, becomes its session id; an id stays', async () => {
    const events = eventsWith();
    const code = TRIPLE.codes.a;
    expect(await resolveSessionCodes({ sessionId: code.toLowerCase() }, events)).toEqual({
      sessionId: TRIPLE.a,
    });
    expect(await resolveSessionCodes({ sessionIds: [code, TRIPLE.b] }, events)).toEqual({
      sessionIds: [TRIPLE.a, TRIPLE.b],
    });
  });

  test('an unknown code and a code two sessions share are left as given', async () => {
    const shared = buildCatalogView([
      wireSession('id-one', { abbreviation: 'DUP101' }),
      wireSession('id-two', { abbreviation: 'DUP101' }),
    ]);
    const events = eventsWith(shared);
    expect(await resolveSessionCodes({ sessionIds: ['DUP101', 'NOPE999'] }, events)).toEqual({
      sessionIds: ['DUP101', 'NOPE999'],
    });
  });

  test('input without session fields, with a bad identifier, or with no catalog is untouched', async () => {
    const events = eventsWith();
    const plain = { query: 'lambda' };
    expect(await resolveSessionCodes(plain, events)).toBe(plain);
    const empty = { sessionIds: [] };
    expect(await resolveSessionCodes(empty, events)).toBe(empty);
    const bad = { sessionId: '../etc' };
    expect(await resolveSessionCodes(bad, events)).toBe(bad);
    expect(events.callsTo('catalog')).toEqual([]);
    const missing = createFakeRuntime({ catalog: syntheticCatalogView() }).events;
    missing.catalog = () => Promise.reject(new CompassError('CatalogMissing'));
    const input = { sessionId: TRIPLE.codes.a };
    expect(await resolveSessionCodes(input, missing)).toBe(input);
  });

  test('through the server, reserve_with_guardrails accepts a code', async () => {
    const fake = createFakeRuntime({ catalog: syntheticCatalogView() });
    const connection = await connect(fake.runtime);
    const result = await connection.call('reserve_with_guardrails', {
      sessionIds: [TRIPLE.codes.a],
    });
    expect(result.isError).toBeFalsy();
    expect(fake.events.callsTo('reserve')[0]?.args).toEqual([[TRIPLE.a]]);
    expect(textOf(result)).toContain(TRIPLE.codes.a);
    await connection.close();
  });
});

describe('reserve_with_guardrails and sessions that need no reservation (task 38)', () => {
  test('a session that is not reservable is refused first, with no question and no write', async () => {
    const catalog = buildCatalogView([wireSession('walk-up', { isReservable: false })]);
    const fake = createFakeRuntime({ catalog });
    const asked: string[] = [];
    const ctx = contextFor(fake, {
      elicit: (question) => {
        asked.push(question.message);
        return Promise.resolve('accept');
      },
    });
    const outcome = await reserveWithGuardrails({ sessionIds: ['walk-up'] }, ctx);
    expect(outcome.ok && outcome.structured.verdict).toEqual({
      decision: 'block',
      reasons: ['WALK-UP is not reservable.'],
    });
    expect(outcome.ok && outcome.text).toContain('need no reservation');
    expect(outcome.ok && outcome.text).toContain('standby list');
    expect(asked).toEqual([]);
    expect(fake.events.writeCalls).toEqual([]);
  });

  test('when Compass is read-only, the walk-up reply points to the re:Invent app (task 39)', async () => {
    const catalog = buildCatalogView([wireSession('walk-up', { isReservable: false })]);
    const fake = createFakeRuntime({ catalog, readOnly: true });
    const outcome = await reserveWithGuardrails({ sessionIds: ['walk-up'] }, contextFor(fake));
    expect(outcome.ok && outcome.text).toContain(
      'add them to your favourites in the re:Invent app',
    );
    expect(outcome.ok && outcome.text).not.toContain('standby list');
  });
});
