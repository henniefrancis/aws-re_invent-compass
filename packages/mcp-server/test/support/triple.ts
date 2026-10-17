/** The pinned end-to-end and demo triple from the synthetic catalog (CTO review H3). */
export const TRIPLE = {
  /** ANT163, 4 December 10:00, 60 minutes, reservable. */
  a: 'syn-096',
  /** ANT163-R, the repeat of A on 1 December 10:00. */
  aRepeat: 'syn-009',
  /** BWP304, 4 December 10:00, 60 minutes, reservable: clashes with A. */
  b: 'syn-082',
} as const;
