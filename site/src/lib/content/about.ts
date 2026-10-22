// The About_Page, titled The Creator (showcase-site task 34, Requirement 24), quoted from
// docs/story/creator-and-inspiration.md.

import { quoted, type ContentBlock } from './content-block';

export const ABOUT_TITLE = 'The Creator';

const SOURCE = 'docs/story/creator-and-inspiration.md';

export const ABOUT_BUILT_BY: ContentBlock = quoted(
  'about-built-by',
  're:Invent Compass was built by Hennie Francis as an entry in the re:Invent Catalog API Builder Challenge.',
  SOURCE,
  'The Creator',
);

/** The biography after the opening line, in order. */
export const ABOUT_BIO: readonly ContentBlock[] = [
  'Hennie Francis is a highly experienced Cloud and Technology Strategist with over 20 years of commercial enterprise experience delivering transformative technology solutions. He involves himself with organizations to modernize platforms, solve complex challenges, and turn cloud strategy into measurable business impact.',
  'He is the founder and driving force behind AWS Community South Africa. He is also an AWS Community Builder and AWS User Group Leader for the Cape Town cloud community. Known for his broad and deep technology expertise, Hennie operates comfortably across complex enterprise environments, bringing clarity, structure, and momentum to large-scale initiatives.',
  'A seasoned keynote speaker and international presenter, Hennie has delivered both technical and non-technical talks on global stages, sharing practical engineering lessons, strategic insight, and real-world experience. His approach blends technical depth with authenticity, shaped by decades of building, scaling, and leading in fast-moving environments.',
  'When he is not working on cloud architecture, Hennie is in the sky whenever possible: a true aviation enthusiast and aspiring pilot. He also keeps a carefully curated collection of conference swag, because every hoodie has a story and every T-shirt represents a community.',
].map((text, i) => quoted(`about-bio-${i + 1}`, text, SOURCE, 'The Creator'));

/** The owner's photo (task 34): the full photo, served from the site itself. */
export const ABOUT_PHOTO = {
  src: '/artwork/hennie-francis.webp',
  alt: 'Hennie Francis smiling, next to the AWS Community Builder logo',
  size: 1000,
} as const;
