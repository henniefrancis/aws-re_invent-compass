// The Inspiration_Page (showcase-site task 28, Requirement 19). A placeholder until the owner
// writes the full story.

import { summary, type ContentBlock } from './content-block';

export const INSPIRATION_TITLE = 'The Inspiration';

export const INSPIRATION_BLOCKS: readonly ContentBlock[] = [
  summary(
    'inspiration-seat',
    'Compass started with a worry many first-time attendees share: a reserved seat is only held until 10 minutes before the session starts, and the walks between venues are long.',
    '.kiro/steering/product.md',
    'The problem we solve',
  ),
  summary(
    'inspiration-airline',
    're:Invent already works like an airline: an itinerary, a boarding pass for each reserved session, gates, connections and boarding that closes. So Compass plans your week like a spec and boards it like a flight.',
    '.kiro/steering/product.md',
    'The metaphor',
  ),
  summary(
    'inspiration-more',
    'The full story is coming soon.',
    '.kiro/specs/showcase-site/requirements.md',
    '19.2',
  ),
];
