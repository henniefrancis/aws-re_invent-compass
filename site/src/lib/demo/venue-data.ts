// Venue data for the demo context (showcase-site, Component 6).
//
// The demo reads the S2 venue file, data/venues.json (six official 2026 venues, a walking time
// for every ordered pair, and a source note on every value), and never edits it. That file is
// not part of this branch yet, so this seam holds null and the demo reports that it cannot run.
//
// INTEGRATOR, when S2 is merged: replace the line below with
//
//   import venueFile from '../../../../data/venues.json';
//   export const DEMO_VENUE_DATA: unknown = venueFile;
//
// (tsconfig already has resolveJsonModule). Nothing else in the site changes.
export const DEMO_VENUE_DATA: unknown = null;
