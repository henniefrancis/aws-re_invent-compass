import { summary, type ContentBlock } from './content-block';

export interface Act {
  readonly id: 'plan' | 'board' | 'fly';
  readonly title: string;
  readonly summary: ContentBlock;
  readonly points: readonly ContentBlock[];
}

// The three acts follow CONCEPT.md section 3. Where CONCEPT.md differs from the code and the
// package README, the code wins: the AWS evidence list is Terraform, AWS CDK TypeScript, AWS SDK
// for JavaScript v3, boto3 and the AWS SDK for .NET (packages/mcp-server/README.md).

const MCP_README = 'packages/mcp-server/README.md';

export const ACTS: readonly Act[] = [
  {
    id: 'plan',
    title: 'Plan',
    summary: summary(
      'act-plan-summary',
      'Plan on your computer, inside Kiro or another MCP client.',
      'CONCEPT.md',
      'Act 1: Plan',
    ),
    points: [
      summary(
        'act-plan-repo',
        'Your code is your agenda. Compass scans the code you work on: a project, a dev folder of up to 50 git repositories or, if you allow it, your GitHub repositories through a read-only GitHub App. It learns which AWS services you use and how deeply, from Terraform, AWS CDK TypeScript, AWS SDK for JavaScript v3, boto3 and the AWS SDK for .NET, and the rest of your stack, such as .NET, Node.js and Python. Then it suggests the sessions that match, with a reason for each.',
        MCP_README,
        'What it does',
      ),
      summary(
        'act-plan-local',
        'Your code is read on your machine. Only service and technology names, depth and counts leave the scanner, and your tech list never leaves your computer.',
        MCP_README,
        'What leaves your machine',
      ),
      summary(
        'act-plan-spec',
        'Your week becomes a spec. Compass writes a Kiro spec for your week with requirements, a design and tasks. Each task is one API action that you approve.',
        'CONCEPT.md',
        'Act 1: Plan',
      ),
      summary(
        'act-plan-guardrails',
        'First-timer guardrails. Every booking is checked for connection time, boarding time, clashes and layovers inside the Compass server before it is sent. Kiro hooks run the same check first as a second line of defence.',
        '.kiro/steering/product.md',
        'Core features, 3',
      ),
    ],
  },
  {
    id: 'board',
    title: 'Boarding',
    summary: summary(
      'act-board-summary',
      'Board on any device, from the phone in your pocket.',
      'CONCEPT.md',
      'Act 2: Boarding',
    ),
    points: [
      summary(
        'act-board-passes',
        'Compass issues a Boarding Pass for each reserved session, for Apple Wallet and Google Wallet.',
        'CONCEPT.md',
        'Act 2: Boarding',
      ),
      summary(
        'act-board-group',
        'All your passes for the week sit together as one group in the wallet, with re:Invent Compass as the issuer.',
        'CONCEPT.md',
        'Act 2: Boarding',
      ),
      summary(
        'act-board-fields',
        'Each pass shows the session code, the terminal (venue) and gate (room), the flight name (title), the date and time, when boarding closes, the walk from the previous session and the next connection.',
        'CONCEPT.md',
        'Act 2: Boarding',
      ),
      summary(
        'act-board-phone',
        'A QR code on your computer opens a 15-minute page on your phone, where you choose Add to Apple Wallet, Add to Google Wallet or Add to Calendar.',
        '.kiro/steering/product.md',
        'Core features, 5',
      ),
      summary(
        'act-board-calendar',
        'The calendar file works with no setup and carries alarms for "leave now" and "boarding closes".',
        'CONCEPT.md',
        'Act 2: Boarding',
      ),
    ],
  },
  {
    id: 'fly',
    title: 'Fly',
    summary: summary(
      'act-fly-summary',
      'Keep your passes right while the week changes.',
      'CONCEPT.md',
      'Act 3: Fly',
    ),
    points: [
      summary(
        'act-fly-sync',
        'When your schedule changes, Compass reads GetSchedule, which is the source of truth, compares it with the passes it issued, and updates or voids passes.',
        '.kiro/steering/product.md',
        'Core features, 7',
      ),
      summary(
        'act-fly-alert',
        'When the time, venue or room of a session changes, Compass updates its pass and your phone shows a change alert.',
        '.kiro/steering/product.md',
        'Core features, 4',
      ),
      summary(
        'act-fly-rebook',
        'A full session gets a rebooking suggestion: the repeat, a favorite on standby, or a walk-up option.',
        'CONCEPT.md',
        'Act 3: Fly',
      ),
      summary(
        'act-fly-void',
        'A cancelled session voids its pass, and every pass expires when its session ends.',
        '.kiro/steering/product.md',
        'Core features, 6',
      ),
    ],
  },
];
