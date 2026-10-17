/**
 * The pinned end-to-end and demo triple from the synthetic catalog (CTO review H3, re-picked after
 * the catalog was regenerated so every repeat is a true repeat of its base). A and A-R are a real
 * pair; B clashes with A and not with A-R, and the real S2 engine accepts the safe swap.
 */
export const TRIPLE = {
  /** BWP213, Tuesday 1 December 13:00 to 14:00, MGM Grand, reservable. */
  a: 'syn-024',
  /** The catalog code of A, A-R and B. */
  titles: { a: 'Data lakes: A builder guide' },
  codes: { a: 'BWP213', aRepeat: 'BWP213-R', b: 'ARC228' },
  /** BWP213-R, the repeat of A on Friday 4 December 11:30, The Venetian, with seats. */
  aRepeat: 'syn-025',
  /** ARC228, 1 December 13:00 to 14:30, The Venetian, reservable: clashes with A. */
  b: 'syn-076',
} as const;
