import { describe, expect, test } from 'vitest';
import { syntheticCatalogView } from './fake-catalog.js';
import { TRIPLE } from './triple.js';

describe('the pinned end-to-end triple exists in the synthetic catalog', () => {
  const view = syntheticCatalogView();
  const a = view.byId.get(TRIPLE.a)?.session;
  const repeat = view.byId.get(TRIPLE.aRepeat)?.session;
  const b = view.byId.get(TRIPLE.b)?.session;

  test('A, A-R and B are reservable sessions with the expected codes', () => {
    expect(a).toMatchObject({ code: 'ANT163', isReservable: true });
    expect(repeat).toMatchObject({ code: 'ANT163-R', isReservable: true, repeatOf: 'ANT163' });
    expect(b).toMatchObject({ code: 'BWP304', isReservable: true });
  });

  test('B clashes with A in time and A-R does not clash with either', () => {
    expect(a?.startsAt).toBe('2026-12-04T10:00:00-08:00');
    expect(b?.startsAt).toBe(a?.startsAt);
    expect(b?.endsAt).toBeDefined();
    expect(repeat?.startsAt).toBe('2026-12-01T10:00:00-08:00');
  });
});
