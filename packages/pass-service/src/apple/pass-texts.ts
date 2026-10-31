// The fixed texts of every pass, in the owner's words from the Pass Designer design (task 44).
// One source for the Apple back (pass-template.ts) and the Google class, which carries the texts
// that are the same on every pass (task 47.7). No imports, so Node loads this file with type
// stripping (scripts/google-wallet-class.mjs).

export const DISCLAIMER = 'Unofficial. Your badge is your ticket.';
export const UNOFFICIAL_NOTICE =
  'This is not a ticket. Your re:Invent badge is your official ticket. Bring it to every session.';
export const INDEPENDENT_NOTICE =
  're:Invent Compass is an independent community project, not affiliated with AWS or AWS re:Invent. It is an entry in the re:Invent Catalog API Builder Challenge.';
export const SEAT_RULE =
  'Your reserved seat is held until 10 minutes before the session starts. After that, it can go to the walk-up line.';
export const PLANS_NOTICE =
  'Compass never changes your schedule. Make changes in the official re:Invent app. If you cancel a session, this pass is voided at the next sync.';
export const PRIVACY_NOTICE =
  'This pass holds only session details. Remove it from Wallet at any time. To delete everything Compass keeps, ask Compass to forget you.';

/** The back fields whose label and text never change, by their pass key. */
export const STATIC_BACK = {
  about: { label: 'ABOUT', value: INDEPENDENT_NOTICE },
  unofficial: { label: 'UNOFFICIAL PASS', value: UNOFFICIAL_NOTICE },
  seatRule: { label: 'BOARDING CLOSES', value: SEAT_RULE },
  plans: { label: 'IF YOUR PLANS CHANGE', value: PLANS_NOTICE },
  privacy: { label: 'PRIVACY', value: PRIVACY_NOTICE },
} as const;

export type StaticBackKey = keyof typeof STATIC_BACK;
