// The Disclaimer_Page and the Copyright_Page (showcase-site task 28, Requirement 27).

import { quoted, summary, type ContentBlock } from './content-block';
import type { SiteLinks } from './links';

export const DISCLAIMER_TITLE = 'Disclaimer';
export const COPYRIGHT_TITLE = 'Copyright and licence';

/** The Disclaimer_Page after the Notice, in order. */
export const DISCLAIMER_BLOCKS: readonly ContentBlock[] = [
  summary(
    'disclaimer-pass',
    'A Compass Boarding Pass is unofficial and is not a ticket. Your re:Invent badge is your ticket.',
    '.kiro/steering/product.md',
    'Product principles, 1',
  ),
  summary(
    'disclaimer-data',
    'Session details come from the AWS Events API and can change at any time. The official re:Invent app is the source of truth for your schedule.',
    '.kiro/specs/showcase-site/requirements.md',
    '27.2',
  ),
  summary(
    'disclaimer-demo-data',
    'The demo uses a small snapshot of real sessions from the public AWS Events API catalog. It shows only the session code, title, times, venue and room. The data is credited to the AWS Events API and is used only to show how Compass checks compatibility.',
    'docs/hackathon-rules.md',
    'Compliance, rule 11',
  ),
  summary(
    'disclaimer-warranty',
    'Compass is provided "as is", without warranties or conditions of any kind, as the Apache License 2.0 says.',
    'LICENSE',
    '7. Disclaimer of Warranty',
  ),
  summary(
    'disclaimer-trademarks',
    '"AWS" and "re:Invent" are trademarks of Amazon.com, Inc. or its affiliates. Apple Wallet is a trademark of Apple Inc. and Google Wallet a trademark of Google LLC. They are used here only to describe compatibility.',
    'NOTICE',
    'Trademarks',
  ),
];

export const COPYRIGHT_LINE: ContentBlock = quoted(
  'copyright-line',
  'Copyright 2026 Hennie Francis',
  'NOTICE',
  'Copyright',
);

/** The Copyright_Page after the copyright line, in order. */
export const COPYRIGHT_BLOCKS: readonly ContentBlock[] = [
  summary(
    'copyright-licence',
    'The code is licensed under the Apache License 2.0. Anyone may use, change and share it, as long as they keep the copyright notice, the licence and the NOTICE file, and say what they changed.',
    'LICENSE',
    '4. Redistribution',
  ),
  summary(
    'copyright-credit',
    'So every copy and every fork keeps the credit to Hennie Francis as the creator of re:Invent Compass.',
    'NOTICE',
    'Copyright',
  ),
  summary(
    'copyright-name',
    'The name "re:Invent Compass" and its logo identify the original project. They are not licensed for derivative works, so a fork must use a different name.',
    'NOTICE',
    'Name and logo',
  ),
];

/** The licence files in the repository. */
export function licenceLinks(
  links: SiteLinks,
): readonly { readonly label: string; readonly href: string }[] {
  return [
    { label: 'The Apache License 2.0 (LICENSE)', href: `${links.repository}/blob/main/LICENSE` },
    { label: 'The NOTICE file', href: `${links.repository}/blob/main/NOTICE` },
  ];
}
