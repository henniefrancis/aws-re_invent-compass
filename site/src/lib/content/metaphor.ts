import { quoted, summary, type ContentBlock } from './content-block';

export interface MetaphorRow {
  readonly term: ContentBlock;
  readonly meaning: ContentBlock;
}

const SECTION = 'The metaphor';
const SOURCE = '.kiro/steering/product.md';

function row(key: string, term: string, meaning: string): MetaphorRow {
  return {
    term: quoted(`metaphor-${key}-term`, term, SOURCE, SECTION),
    meaning: quoted(`metaphor-${key}-meaning`, meaning, SOURCE, SECTION),
  };
}

/** The airline metaphor table, in the order of the product steering. */
export const METAPHOR_ROWS: readonly MetaphorRow[] = [
  row('itinerary', 'Itinerary', "The attendee's week (a Kiro spec)"),
  row('boarding-pass', 'Boarding pass', 'Unofficial pass for one reserved session'),
  row('gate', 'Gate', 'Venue and room'),
  row('boarding-closes', 'Boarding closes', 'Session start minus 10 minutes'),
  row('connection', 'Connection', 'Walk between two consecutive commitments'),
  row('tight-connection', 'Tight connection', 'Walk time plus buffer is longer than the gap'),
  {
    term: quoted('metaphor-rebooking-term', 'Rebooking', SOURCE, SECTION),
    meaning: summary(
      'metaphor-rebooking-meaning',
      'Moving to a repeat of the same session (-R in the session code)',
      SOURCE,
      SECTION,
    ),
  },
  row('standby', 'Standby', 'Favorites kept as backups'),
  row('layover', 'Layover', 'Personal time for meals, water and rest'),
  row('cancelled-flight', 'Cancelled flight', 'A cancelled reservation: its pass is voided'),
];

export const METAPHOR_HEADERS: readonly [string, string] = ['Airline term', 're:Invent meaning'];
