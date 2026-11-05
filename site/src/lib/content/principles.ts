import { quoted, summary, type ContentBlock } from './content-block';

export interface Principle {
  readonly title: ContentBlock;
  readonly body: readonly ContentBlock[];
}

const SOURCE = '.kiro/steering/product.md';

/** The three principles the Home_Page states in plain words. */
export const PRINCIPLES: readonly Principle[] = [
  {
    title: quoted(
      'principle-badge-title',
      'The badge is the ticket',
      SOURCE,
      'Product principles, 1',
    ),
    body: [
      summary(
        'principle-badge-body',
        'Compass passes are reminders. Your own badge is what gets you into a room.',
        SOURCE,
        'Product principles, 1',
      ),
      quoted('principle-badge-barcode', 'Passes have no barcode.', SOURCE, 'Product principles, 1'),
    ],
  },
  {
    title: quoted(
      'principle-human-title',
      'A human approves every write',
      SOURCE,
      'Product principles, 3',
    ),
    body: [
      quoted(
        'principle-human-body',
        'Never reserve, cancel or change anything in the background.',
        SOURCE,
        'Product principles, 3',
      ),
      quoted(
        'principle-human-polling',
        'No seat polling, sniping or retry loops on reservations.',
        SOURCE,
        'Product principles, 3',
      ),
      summary(
        'principle-human-read-only',
        'Live mode is read-only by default: Compass reads your real schedule and changes it only after you set COMPASS_ALLOW_WRITES=1 yourself.',
        'packages/mcp-server/README.md',
        'Read-only by default',
      ),
    ],
  },
  {
    title: quoted('principle-local-title', 'Local first', SOURCE, 'Product principles, 4'),
    body: [
      summary(
        'principle-local-body',
        'Your access and refresh tokens, the catalog cache, your schedule, the code scan and your tech list stay on your machine.',
        SOURCE,
        'Product principles, 4',
      ),
    ],
  },
];

/** Every block of the principles, in reading order. */
export function principleBlocks(): readonly ContentBlock[] {
  return PRINCIPLES.flatMap((principle) => [principle.title, ...principle.body]);
}
