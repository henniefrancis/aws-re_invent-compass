import { summary, type ContentBlock } from './content-block';

export interface Act {
  readonly id: 'plan' | 'board' | 'fly';
  readonly title: string;
  readonly summary: ContentBlock;
  readonly points: readonly ContentBlock[];
}

// The three acts follow CONCEPT.md section 3. Where CONCEPT.md differs from the build plan
// and the product steering, the plan wins: the scanner list is Terraform, AWS CDK TypeScript,
// AWS SDK for JavaScript v3 and boto3.

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
        'Your repo is your agenda. Compass scans your own workspace on your machine (Terraform, AWS CDK TypeScript, AWS SDK for JavaScript v3 and boto3), works out which AWS services you use and how deeply, and suggests a level for each topic. Only service names and depth leave the scanner, never file contents.',
        '.kiro/steering/product.md',
        'Core features, 1',
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
        'act-board-fields',
        'Each pass shows the session code, the terminal (venue) and gate (room), the flight name (title), the date and time, when boarding closes, the walk from the previous session and the next connection.',
        'CONCEPT.md',
        'Act 2: Boarding',
      ),
      summary(
        'act-board-phone',
        'A QR code on your computer opens a 15-minute page on your phone, where you choose Add to Apple Wallet, Save to Google Wallet or download the calendar file.',
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
        'When your schedule changes, Compass reads GetSchedule, which is the source of truth, compares it with the passes it issued, and reissues or withdraws passes.',
        'CONCEPT.md',
        'Act 3: Fly',
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
