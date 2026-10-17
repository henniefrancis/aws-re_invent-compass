// Venue data for the demo context (showcase-site, Component 6).
//
// The demo reads the S2 venue file, data/venues.json (six official 2026 venues, a walking time
// for every ordered pair, and a source note on every value), and never edits it. That file is
// is imported as it is, so the walking times (researched estimates with a source note on every
// value) and the venue aliases always come from the data.
import venueFile from '../../../../data/venues.json';

export const DEMO_VENUE_DATA: unknown = venueFile;
