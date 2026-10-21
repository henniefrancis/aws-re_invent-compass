// The sample Boarding Pass in the home page hero (showcase-site task 25).
//
// It is exactly the pass the demo builds for the first session of its sample week (BWP213, a
// made-up session from the synthetic catalog, ADR-016), with the real rules engine giving the
// boarding closes time. It is written out here so the home page carries no demo code and no
// rules engine; a test builds the demo pass and checks that this copy is identical.

import type { SamplePass } from '../demo/sample-pass';

export const HERO_PASS: SamplePass = {
  session: 'BWP213',
  title: 'Data lakes: A builder guide',
  terminal: 'MGM Grand',
  gate: 'Room 114',
  date: '1 Dec 2026 | 13:00-14:00',
  boardingCloses: '12:50',
  boardingNote: null,
  walkFromPrevious: null,
  nextConnection: null,
  label: 'Sample pass. Made-up session.',
  disclaimer: 'Unofficial. Your badge is your ticket.',
  accessibleName:
    'Boarding pass. Session BWP213. Terminal: MGM Grand. Gate: Room 114. Flight name: Data lakes: A builder guide. Date: 1 Dec 2026 | 13:00-14:00. Boarding closes: 12:50. Walk from the previous session: not known. Next connection: not known. Sample pass. Made-up session. Unofficial. Your badge is your ticket.',
  passFields: {
    sessionCode: 'BWP213',
    title: 'Data lakes: A builder guide',
    venue: 'MGM Grand',
    room: 'Room 114',
    startsAt: '2026-12-01T13:00:00-08:00',
    endsAt: '2026-12-01T14:00:00-08:00',
  },
};
