import { summary, type ContentBlock } from './content-block';
import type { SiteLinks } from './links';

// Install content. Sources: the product steering (devices), the build plan and the S3 prompt
// (commands), the tech steering (Node.js 24), the official Kiro powers installation page, and
// packages/mcp-server/README.md (the Kiro MCP setting, the other MCP clients and live mode).

const PRODUCT = '.kiro/steering/product.md';
const PLAN = 'docs/architecture/build-plan.md';
const KIRO_DOCS = 'kiro.dev/docs/powers/installation';
const MCP_README = 'packages/mcp-server/README.md';

export const PLAN_ON_COMPUTER: ContentBlock = summary(
  'install-plan-on-computer',
  'Plan on a computer. Sign-in to the AWS Events API only works through a redirect to the machine that started it, so planning and booking run on your computer. Kiro comes first, and Claude Desktop, VS Code and the Kiro CLI work too.',
  PRODUCT,
  'Devices (ADR-005)',
);

export const BOARD_ON_ANY_DEVICE: ContentBlock = summary(
  'install-board-on-any-device',
  'Board on any device. A QR code on your computer hands your passes to your phone: Apple Wallet on an iPhone, Google Wallet on Android, or the calendar file on any device. An iPad has no Wallet app, so it uses the calendar file.',
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
    'install-kiro-step-mcp',
    'In Settings, set Kiro Agent: Configure MCP to Enabled. Kiro starts no MCP server until you do.',
    MCP_README,
    'Install, Kiro (the Power)',
  ),
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
    'Enter the address of the Compass power folder (below).',
    KIRO_DOCS,
    'Import power from GitHub',
  ),
  summary('install-kiro-step-5', 'Choose Install.', KIRO_DOCS, 'Import power from GitHub'),
];

export interface ImportOption {
  readonly id: 'power-folder';
  readonly label: string;
  /** What to enter or look for. */
  readonly value: string;
  readonly note: string;
}

/**
 * The address to give Kiro. The day-1 spike SP1 recorded on 4 November that Kiro imports the
 * power/ folder URL and refuses the repository root ("Nothing to install from the repository
 * root"), so only the folder URL is shown. This is the one place to change.
 */
export function kiroImportOptions(links: SiteLinks): readonly ImportOption[] {
  return [
    {
      id: 'power-folder',
      label: 'The power folder',
      value: `${links.repository}/tree/main/power`,
      note: 'Use this address, not the repository address: Kiro finds nothing to install at the repository root.',
    },
  ];
}

export const KIRO_IMPORT_SOURCE_NOTE: ContentBlock = summary(
  'install-kiro-source-note',
  'A power needs a valid plugin.json or POWER.md at its package root. For Compass that root is the power/ folder, not the repository root.',
  KIRO_DOCS,
  'Repository structure',
);

export const KIRO_UPDATE_NOTE: ContentBlock = summary(
  'install-kiro-update-note',
  'To update the power, remove it in the Powers panel. In ~/.kiro/powers/repos (on Windows, %USERPROFILE%\\.kiro\\powers\\repos), delete only the folders that hold the Compass repository, and leave the others alone. Then import the folder address again, and ask for the hooks again if you installed them. Kiro does not refresh its copy when you import again, so a new import can keep the old version.',
  'packages/mcp-server/README.md',
  'Kiro (the Power)',
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
    description: summary(
      'install-cmd-start',
      'The command your MCP client runs to start the Compass server. You do not run it yourself: the Kiro Power adds it for you, and for other clients you add it to their MCP settings (see below).',
      MCP_README,
      'Install',
    ),
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

/**
 * The npm package and the version this site pins, read from packageVersion so the line stays
 * true after each release, with no date to go stale.
 */
export function npmRelease(links: SiteLinks): ContentBlock {
  return summary(
    'install-npm-release',
    links.packageVersion === null
      ? 'Compass runs from the npm package reinvent-compass.'
      : `Compass runs from the npm package reinvent-compass, version ${links.packageVersion}.`,
    MCP_README,
    'Install',
  );
}

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

/** The npm package as the client configuration names it, pinned once a version is known. */
export function packageSpec(links: SiteLinks): string {
  return links.packageVersion === null
    ? 'reinvent-compass'
    : `reinvent-compass@${links.packageVersion}`;
}

/** The JSON shape a client reads: Kiro and Claude Desktop use mcpServers, VS Code uses servers. */
export type ClientConfigShape = 'mcpServers' | 'servers';

/** The configuration to paste into a client, with the package pinned as on this page. */
export function clientConfig(shape: ClientConfigShape, links: SiteLinks): string {
  return [
    '{',
    `  "${shape}": {`,
    '    "compass": {',
    ...(shape === 'servers' ? ['      "type": "stdio",'] : []),
    '      "command": "npx",',
    `      "args": ["--yes", "${packageSpec(links)}"]`,
    '    }',
    '  }',
    '}',
  ].join('\n');
}

/** Setup for one MCP client other than the Kiro Power, from packages/mcp-server/README.md. */
export interface OtherClient {
  readonly id: 'claude-desktop' | 'vscode' | 'kiro-cli';
  readonly name: string;
  readonly setup: ContentBlock;
  readonly shape: ClientConfigShape;
  readonly after: ContentBlock;
}

/** Setup for Claude Desktop, VS Code and the Kiro CLI. */
export const OTHER_CLIENTS: readonly OtherClient[] = [
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    setup: summary(
      'install-client-claude-setup',
      'Open the Claude menu, then Settings, then Developer, then Edit Config, and add:',
      MCP_README,
      'Install, Claude Desktop',
    ),
    shape: 'mcpServers',
    after: summary(
      'install-client-claude-after',
      'Then quit Claude Desktop completely and start it again.',
      MCP_README,
      'Install, Claude Desktop',
    ),
  },
  {
    id: 'vscode',
    name: 'VS Code',
    setup: summary(
      'install-client-vscode-setup',
      'Create .vscode/mcp.json in your workspace, or run MCP: Open User Configuration for your profile, and add:',
      MCP_README,
      'Install, VS Code',
    ),
    shape: 'servers',
    after: summary(
      'install-client-vscode-after',
      'VS Code asks you to trust the server the first time it starts.',
      MCP_README,
      'Install, VS Code',
    ),
  },
  {
    id: 'kiro-cli',
    name: 'Kiro CLI',
    setup: summary(
      'install-client-kiro-cli-setup',
      'The Kiro CLI reads the same mcpServers JSON as the Kiro IDE, in .kiro/settings/mcp.json or ~/.kiro/settings/mcp.json:',
      MCP_README,
      'Install, Kiro CLI',
    ),
    shape: 'mcpServers',
    after: summary(
      'install-client-kiro-cli-after',
      'The CLI can also add the server for you: run kiro-cli mcp --help for the options of your version.',
      MCP_README,
      'Install, Kiro CLI',
    ),
  },
];

export const OTHER_CLIENTS_NOTE: ContentBlock = summary(
  'install-clients-note',
  'The full setup for each client, with links to its own documentation, is in the MCP server README.',
  MCP_README,
  'Install',
);

/** Live mode, on your real re:Invent schedule (packages/mcp-server/README.md). */
export const LIVE_MODE_INTRO: ContentBlock = summary(
  'install-live-intro',
  'The demo and simulated mode need no account. To plan with your real re:Invent schedule:',
  MCP_README,
  'Read-only by default',
);

export const LIVE_MODE_STEPS: readonly ContentBlock[] = [
  summary(
    'install-live-sign-in',
    'Sign in with an AWS Builder ID that is registered for re:Invent 2026: ask your assistant to run sign_in, and your browser opens the Builder ID sign-in page. Your tokens go into your computer keychain.',
    MCP_README,
    'The tools',
  ),
  summary(
    'install-live-read-only',
    'Compass is read-only by default. It reads the live catalog and your real reservations, standby list and layovers, and the booking tools tell you what they would have done without changing anything.',
    MCP_README,
    'Read-only by default',
  ),
  summary(
    'install-live-writes',
    'To let Compass change your schedule, each change still approved by you first, set COMPASS_ALLOW_WRITES=1 in the env of the Compass server in your MCP settings. Only you should change this setting.',
    MCP_README,
    'Read-only by default',
  ),
  summary(
    'install-live-plan',
    'Open your own project and say: "Plan my re:Invent."',
    MCP_README,
    'What it does',
  ),
  summary(
    'install-live-github',
    'Optional: ask your assistant to run connect_github to scan your GitHub repositories too. It signs you in to the read-only Compass GitHub App with a code you enter on GitHub, and scan_github reads nothing until you confirm the list.',
    MCP_README,
    'Your tech list and GitHub',
  ),
];

/** The env entry that turns writes on. */
export const ALLOW_WRITES_SNIPPET = '"env": { "COMPASS_ALLOW_WRITES": "1" }';

export const COPY_LABEL = 'Copy';
export const COPIED_MESSAGE = 'Copied';
export const COPY_FAILED_MESSAGE = 'Copy did not work. Select the command and copy it.';
