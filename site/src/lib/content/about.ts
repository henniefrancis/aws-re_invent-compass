// The About_Page, titled The Creator (showcase-site task 34, Requirement 24), quoted from
// docs/story/creator-and-inspiration.md.

import { quoted, type ContentBlock } from './content-block';

export const ABOUT_TITLE = 'The Creator';

const SOURCE = 'docs/story/creator-and-inspiration.md';

export const ABOUT_BUILT_BY: ContentBlock = quoted(
  'about-built-by',
  're:Invent Compass was built by Hennie Francis, founder of AWS Community South Africa and an AWS Community Builder, as an entry in the re:Invent Catalog API Builder Challenge.',
  SOURCE,
  'The Creator',
);

/** The biography after the opening line, in order. */
export const ABOUT_BIO: readonly ContentBlock[] = [
  'Hennie is a Cloud and Technology Strategist in Cape Town, South Africa, with more than 20 years of commercial enterprise experience. He helps organisations modernise platforms, solve complex challenges and turn cloud strategy into measurable business impact.',
  'He founded AWS Community South Africa and leads the AWS User Group for the Cape Town cloud community. He is also an AWS Community Builder.',
  'A keynote speaker and international presenter, Hennie has given technical and non-technical talks on global stages, sharing practical engineering lessons and real-world experience.',
  'When he is not working on cloud architecture, Hennie is in the sky whenever possible: a true aviation enthusiast and aspiring pilot. He also keeps a carefully curated collection of conference swag, because every hoodie has a story and every T-shirt represents a community.',
].map((text, i) => quoted(`about-bio-${i + 1}`, text, SOURCE, 'The Creator'));

/** The owner's photo (task 34): the full photo, served from the site itself. */
export const ABOUT_PHOTO = {
  src: '/artwork/hennie-francis.webp',
  alt: 'Hennie Francis smiling, next to the AWS Community Builder logo',
  size: 1000,
} as const;
