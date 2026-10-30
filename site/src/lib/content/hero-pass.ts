// The sample Boarding Pass in the home page hero (showcase-site task 25).
//
// It is exactly the pass the demo builds for the first session of its sample week (TNC334-R, a
// real re:Invent 2026 session from the AWS Events API snapshot of the demo, shown by code, title,
// time, venue and room only), with the real rules engine giving the boarding closes time. It is
// written out here so the home page carries no demo code and no rules engine; a test builds the
// demo pass and checks that this copy is identical.

import type { SamplePass } from '../demo/sample-pass';

export const HERO_PASS: SamplePass = {
  session: 'TNC334-R',
  title: 'Streamlining Claims Processing with Amazon Quick',
  terminal: 'Caesars Palace',
  gate: 'Augustus Ballroom V',
  date: '30 Nov 2026 | 13:00-15:00',
  boardingCloses: '12:50',
  boardingNote: null,
  walkFromPrevious: null,
  nextConnection: null,
  label: 'Sample pass. Not a real booking.',
  disclaimer: 'Unofficial. Your badge is your ticket.',
  accessibleName:
    'Boarding pass. Session TNC334-R. Terminal: Caesars Palace. Gate: Augustus Ballroom V. Flight name: Streamlining Claims Processing with Amazon Quick. Date: 30 Nov 2026 | 13:00-15:00. Boarding closes: 12:50. Walk from the previous session: not known. Next connection: not known. Sample pass. Not a real booking. Unofficial. Your badge is your ticket.',
  passFields: {
    sessionCode: 'TNC334-R',
    title: 'Streamlining Claims Processing with Amazon Quick',
    venue: 'Caesars Palace',
    room: 'Emperors Level, Augustus Ballroom V',
    startsAt: '2026-11-30T13:00:00-08:00',
    endsAt: '2026-11-30T15:00:00-08:00',
  },
};
