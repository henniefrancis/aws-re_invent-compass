/**
 * The sessions the demo and the end-to-end test use, from the synthetic catalog (CTO review H3).
 * One constant, so the ids are pinned in a single place. A and A-R are a true repeat pair; B
 * clashes with A and not with A-R, and the real S2 engine accepts the safe swap from A to A-R.
 * `test/support/triple.test.ts` asserts all of this against `fixtures/synthetic/catalog.json`.
 */
export const DEMO_TRIPLE = {
  /** BWP213, Tuesday 1 December 13:00 to 14:00, MGM Grand, reservable. */
  a: 'syn-024',
  /** BWP213-R, the repeat of A on Friday 4 December 11:30, The Venetian, with seats. */
  aRepeat: 'syn-025',
  /** ARC228, 1 December 13:00 to 14:30, The Venetian, reservable: clashes with A. */
  b: 'syn-076',
  /** The catalog codes of the three sessions. */
  codes: { a: 'BWP213', aRepeat: 'BWP213-R', b: 'ARC228' },
  /** The catalog titles of the three sessions (A and its repeat share one). */
  titles: {
    a: 'Data lakes: A builder guide',
    aRepeat: 'Data lakes: A builder guide',
    b: 'Zero-downtime deploys: Deep dive',
  },
} as const;
