// The About_Page (showcase-site task 26, Requirement 18). A placeholder until the owner writes
// the full page.

import { summary, type ContentBlock } from './content-block';

export const ABOUT_TITLE = 'About the creator';

export const ABOUT_BUILT_BY: ContentBlock = summary(
  'about-built-by',
  're:Invent Compass was built by Hennie Francis, an AWS Community Builder, as an entry in the re:Invent Catalog API Builder Challenge.',
  '.kiro/specs/showcase-site/requirements.md',
  '18.2',
);

export const ABOUT_COMING_SOON: ContentBlock = summary(
  'about-coming-soon',
  'More about Hennie is coming soon.',
  '.kiro/specs/showcase-site/requirements.md',
  '18.2',
);
