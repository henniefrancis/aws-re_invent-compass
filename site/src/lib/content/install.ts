import { summary, type ContentBlock } from './content-block';
import type { SiteLinks } from './links';

// Install content. Sources: the product steering (devices), the build plan and the S3 prompt
// (commands), the tech steering (Node.js 24), and the official Kiro powers installation page.
// Setup for Claude Desktop, VS Code and Kiro CLI is added from packages/mcp-server/README.md
// after S3 has merged. Until then OTHER_CLIENTS stays empty and nothing is invented.

const PRODUCT = '.kiro/steering/product.md';
const PLAN = 'docs/architecture/build-plan.md';
const KIRO_DOCS = 'kiro.dev/docs/powers/installation';

export const PLAN_ON_COMPUTER: ContentBlock = summary(
  'install-plan-on-computer',
  'Plan on a computer. Sign-in to the AWS Events API only works through a redirect to the machine that started it, so planning and booking run on your computer. Kiro comes first, and other MCP clients are documented.',
  PRODUCT,
  'Devices (ADR-005)',
);

export const BOARD_ON_ANY_DEVICE: ContentBlock = summary(
  'install-board-on-any-device',
  'Board on any device. Phones and tablets get Wallet passes through the QR hand-off, a calendar file and a responsive itinerary page. An iPad has no Wallet app, so it uses the calendar file and the itinerary page.',
  PRODUCT,
  'Devices (ADR-005)',
);

export const KIRO_ADD_BUTTON: ContentBlock = summary(
  'install-kiro-add-button',
  'Choose Add to Kiro on the Compass page at kiro.dev/powers.',
  KIRO_DOCS,
  'Installing powers',
);

export const KIRO_IMPORT_INTRO: ContentBlock = summary(
  'install-kiro-import-intro',
  'To add the power from GitHub, follow these steps in Kiro.',
  KIRO_DOCS,
  'Import power from GitHub',
);

export const KIRO_IMPORT_STEPS: readonly ContentBlock[] = [
  summary(
    'install-kiro-step-1',
    'Open the Powers panel in Kiro.',
    KIRO_DOCS,
    'Import power from GitHub',
  ),
  summary('install-kiro-step-2', 'Choose Add Custom Power.', KIRO_DOCS, 'Import power from GitHub'),
  summary(
    'install-kiro-step-3',
    'Choose Import power from GitHub.',
    KIRO_DOCS,
    'Import power from GitHub',
  ),
  summary(
    'install-kiro-step-4',
    'Enter the address of the Compass repository (see the options below).',
    KIRO_DOCS,
    'Import power from GitHub',
  ),
  summary('install-kiro-step-5', 'Choose Install.', KIRO_DOCS, 'Import power from GitHub'),
];

export interface ImportOption {
  readonly id: 'repository' | 'power-folder';
  readonly label: string;
  /** What to enter or look for. */
  readonly value: string;
  readonly note: string;
}

/**
 * The two ways to point Kiro at the power. The Kiro page says a power needs a plugin.json or
 * POWER.md at its package root and does not say how to name a subfolder, so both options are
 * shown until the day-1 spike SP1 records which one works. This is the one place to change.
 */
export function kiroImportOptions(links: SiteLinks): readonly ImportOption[] {
  return [
    {
      id: 'repository',
      label: 'Option 1: the repository address',
      value: links.repository,
      note: 'Try this first.',
    },
    {
      id: 'power-folder',
      label: 'Option 2: the power folder',
      value: 'the power/ folder of the same repository',
      note: 'If Kiro does not find the power at the repository address, point it at this folder instead.',
    },
  ];
}

export const KIRO_IMPORT_SOURCE_NOTE: ContentBlock = summary(
  'install-kiro-source-note',
  'A power needs a valid plugin.json or POWER.md at its package root. The official Kiro page does not say how to name a subfolder, which is why both options are listed.',
  KIRO_DOCS,
  'Repository structure',
);

export const HOOKS_NOTE: ContentBlock = summary(
  'install-hooks-note',
  'Hooks work in Kiro only. The guardrail runs inside the Compass server, so it protects every client.',
  PLAN,
  '3.2 and 8',
);

export interface InstallCommand {
  readonly id: 'start' | 'demo';
  readonly base: string;
  readonly description: ContentBlock;
}

export const INSTALL_COMMANDS: readonly InstallCommand[] = [
  {
    id: 'start',
    base: 'npx reinvent-compass',
    description: summary('install-cmd-start', 'Starts the Compass server.', PLAN, '8 (S3)'),
  },
  {
    id: 'demo',
    base: 'npx reinvent-compass demo',
    description: summary(
      'install-cmd-demo',
      'Runs the whole flow in simulated mode in your terminal, on made-up data.',
      'KIRO-SPEC-PROMPTS.md',
      'S3',
    ),
  },
];

export const NODE_REQUIREMENT: ContentBlock = summary(
  'install-node',
  'Node.js 24 or later is required.',
  '.kiro/steering/tech.md',
  'Stack (ADR-006)',
);

/** The command text with the published version pinned once there is one. */
export function commandText(command: InstallCommand, links: SiteLinks): string {
  if (links.packageVersion === null) {
    return command.base;
  }
  return command.base.replace('reinvent-compass', `reinvent-compass@${links.packageVersion}`);
}

/** Setup for other MCP clients. Empty until S3 has merged; never invented. */
export const OTHER_CLIENTS: readonly ContentBlock[] = [];

export const COPY_LABEL = 'Copy';
export const COPIED_MESSAGE = 'Copied';
export const COPY_FAILED_MESSAGE = 'Copy did not work. Select the command and copy it.';
