// The Inspiration_Page (showcase-site task 34, Requirement 25): the owner's story in the owner's
// words, quoted section by section from docs/story/creator-and-inspiration.md.

import { quoted, type ContentBlock } from './content-block';

export const INSPIRATION_TITLE = 'The Inspiration';

const SOURCE = 'docs/story/creator-and-inspiration.md';

/** The one line to remember, shown under the title. */
export const INSPIRATION_KEY_LINE: ContentBlock = quoted(
  'inspiration-key-line',
  'As an aviation geek, I wanted my re:Invent week to run like a well-planned flight.',
  SOURCE,
  "An aviation geek's eye",
);

export interface StorySection {
  readonly id: string;
  readonly heading: string;
  readonly blocks: readonly ContentBlock[];
}

function section(id: string, heading: string, paragraphs: readonly string[]): StorySection {
  return {
    id,
    heading,
    blocks: paragraphs.map((text, i) =>
      quoted(`inspiration-${id}-${i + 1}`, text, SOURCE, heading),
    ),
  };
}

/** The story, in order. */
export const INSPIRATION_SECTIONS: readonly StorySection[] = [
  section('spark', 'The spark', [
    'This year is my first re:Invent. Before I picked a single session, I opened the campus map and watched videos of the venues. Las Vegas is huge. The sessions are spread across several hotels on the Strip, and the walks between them are long.',
    'Then I read the rule that worried me most: a reserved seat is only held until 10 minutes before the session starts. After that, it goes to the walk-up line. As a first-time attendee, I needed help with two things: finding my way, and knowing how long each walk really takes.',
  ]),
  section('aviation', "An aviation geek's eye", [
    'I am an aviation geek and an aspiring pilot, and I live and breathe anything to do with flying. When I looked at my re:Invent week, I saw an airline: an itinerary, a boarding pass for every reserved session, venues as terminals, rooms as gates, connections between them, and boarding that closes.',
  ]),
  section('spec', 'Plan like a spec, board like a flight', [
    'Planning a week of sessions is a lot like writing a spec: you say what you want, check it against the rules, and only then commit. So I built Compass with Kiro, spec first. Compass plans your week like a spec and boards it like a flight.',
  ]),
  section('south-africa', 'From Cape Town to Las Vegas', [
    'I had the idea before the re:Invent Catalog API Builder Challenge was announced. The challenge gave me the reason to build it properly. I am travelling to re:Invent as the founder of AWS Community South Africa, and I want to represent our community with something every attendee can use.',
  ]),
  section('grew', 'It grew', [
    'What surprised me most was the size of it. Compass started as a small helper for my own week. It grew into a full product: an MCP server for Kiro, a Kiro Power, Apple Wallet and Google Wallet boarding passes, a calendar file and this website.',
  ]),
  section('everyone', 'For every attendee', [
    'Compass is for every attendee with a busy week across several venues. I want you to arrive on time, keep your seat and be free to enjoy re:Invent: the learning, the people and the energy.',
  ]),
];

/** Every block on the page, for the provenance tests. */
export const INSPIRATION_BLOCKS: readonly ContentBlock[] = [
  INSPIRATION_KEY_LINE,
  ...INSPIRATION_SECTIONS.flatMap((s) => s.blocks),
];
