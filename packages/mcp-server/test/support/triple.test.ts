import { describe, expect, test } from 'vitest';
import { syntheticCatalogView } from './fake-catalog.js';
import { TRIPLE } from './triple.js';

describe('the pinned end-to-end triple exists in the synthetic catalog', () => {
  const view = syntheticCatalogView();
  const a = view.byId.get(TRIPLE.a)?.session;
  const repeat = view.byId.get(TRIPLE.aRepeat)?.session;
  const b = view.byId.get(TRIPLE.b)?.session;

  test('A, A-R and B are reservable sessions with the expected codes and titles', () => {
    expect(a).toMatchObject({ code: TRIPLE.codes.a, title: TRIPLE.titles.a, isReservable: true });
    expect(repeat).toMatchObject({
      code: TRIPLE.codes.aRepeat,
      isReservable: true,
      repeatOf: TRIPLE.codes.a,
      title: a?.title,
      type: a?.type,
      level: a?.level,
    });
    expect(b).toMatchObject({ code: TRIPLE.codes.b, isReservable: true });
  });

  test('A-R is a true repeat on another day with seats, B clashes with A and not with A-R', () => {
    expect(a?.startsAt).toBe('2026-12-01T13:00:00-08:00');
    expect(repeat?.startsAt).toBe('2026-12-04T11:30:00-08:00');
    expect(repeat?.seatAvailability).toBe('available');
    expect(b?.startsAt).toBe('2026-12-01T13:00:00-08:00');
    const overlaps = (x: typeof a, y: typeof a): boolean =>
      Date.parse(x?.startsAt ?? '') < Date.parse(y?.endsAt ?? '') &&
      Date.parse(y?.startsAt ?? '') < Date.parse(x?.endsAt ?? '');
    expect(overlaps(a, b)).toBe(true);
    expect(overlaps(b, repeat)).toBe(false);
    expect(overlaps(a, repeat)).toBe(false);
  });
});
