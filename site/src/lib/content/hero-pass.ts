// The sample Boarding Pass in the home page hero (showcase-site tasks 25 and 47).
//
// Since task 47 it is a pass for the event itself, not for one session: AWS re:Invent 2026 in
// Las Vegas, with FLIGHT NAME drawn above TERMINAL and GATE. It still says it is a sample and
// carries the disclaimer. The demo builds its own session passes; this one is written out here
// so the home page carries no demo code and no rules engine.

import type { SamplePass } from '../demo/sample-pass';

export const HERO_PASS: SamplePass = {
  session: '2026',
  title: 'AWS re:Invent',
  terminal: 'USA',
  gate: 'Las Vegas, NV',
  date: 'Nov. 30 - Dec. 4',
  boardingCloses: '07:50',
  boardingNote: null,
  walkFromPrevious: null,
  nextConnection: null,
  label: 'Sample pass. Not a real booking.',
  disclaimer: 'Unofficial. Your badge is your ticket.',
  accessibleName:
    'Boarding pass. Session 2026. Flight name: AWS re:Invent. Terminal: USA. Gate: Las Vegas, NV. Date: Nov. 30 - Dec. 4. Boarding closes: 07:50. Walk from the previous session: not known. Next connection: not known. Sample pass. Not a real booking. Unofficial. Your badge is your ticket.',
  passFields: {
    sessionCode: '2026',
    title: 'AWS re:Invent',
    venue: 'USA',
    room: 'Las Vegas, NV',
    startsAt: '2026-11-30T08:00:00-08:00',
    endsAt: '2026-12-04T18:00:00-08:00',
  },
};
