import { quoted, summary, type ContentBlock } from './content-block';

export const PRODUCT_NAME = 're:Invent Compass';

export const TAGLINE: ContentBlock = quoted(
  'tagline',
  'From your code to your seat, on time.',
  '.kiro/steering/product.md',
  'Product',
);

export const INTRO: ContentBlock = quoted(
  'intro',
  're:Invent Compass helps a first-time AWS re:Invent attendee plan their week from their own code, book it safely, and get into every reserved session on time.',
  '.kiro/steering/product.md',
  'Product',
);

export const SEAT_RULE: ContentBlock = quoted(
  'seat-rule',
  'A reserved seat is only held until 10 minutes before the session starts, then it goes to the walk-up line',
  '.kiro/steering/product.md',
  'The problem we solve',
);

export const SEAT_RULE_SOURCE: ContentBlock = summary(
  'seat-rule-source',
  'This rule comes from the official re:Invent 2026 FAQ.',
  '.kiro/steering/product.md',
  'The problem we solve',
);

export const MOST_TOOLS_SHOW: ContentBlock = quoted(
  'most-tools-show',
  'Starts 10:30',
  '.kiro/steering/product.md',
  'The problem we solve',
);

export const COMPASS_SHOWS: ContentBlock = quoted(
  'compass-shows',
  'Boarding closes at 10:20',
  '.kiro/steering/product.md',
  'The problem we solve',
);

export const MOST_TOOLS_LEAD: ContentBlock = summary(
  'most-tools-lead',
  'Most tools show:',
  '.kiro/steering/product.md',
  'The problem we solve',
);

export const COMPASS_LEAD: ContentBlock = summary(
  'compass-lead',
  'Compass shows:',
  '.kiro/steering/product.md',
  'The problem we solve',
);

export const WALK_NOTE: ContentBlock = quoted(
  'walk-note',
  'and the walk from where you are.',
  '.kiro/steering/product.md',
  'The problem we solve',
);

export const FIRST_TIMER_LOSS: ContentBlock = summary(
  'first-timer-loss',
  'First-timers lose seats by arriving late, by underestimating walks between hotels, and by skipping meals and rest.',
  '.kiro/steering/product.md',
  'The problem we solve',
);

export const DISCLAIMER: ContentBlock = quoted(
  'disclaimer',
  'Unofficial. Your badge is your ticket.',
  '.kiro/steering/product.md',
  'Product principles, 1',
);

export const UNOFFICIAL_STATEMENT: ContentBlock = summary(
  'unofficial-statement',
  'Compass passes are unofficial and never replace your badge. Every pass says so:',
  '.kiro/steering/product.md',
  'Product principles, 1',
);

export const TRY_IT: ContentBlock = summary(
  'try-it',
  'The demo runs on a small snapshot of real sessions from the AWS Events API, with no install and no sign-in.',
  'docs/hackathon-rules.md',
  'Compliance, rule 11',
);
