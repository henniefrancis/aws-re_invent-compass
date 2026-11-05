import { ABOUT_BIO, ABOUT_BUILT_BY, ABOUT_PRODUCT } from '../../src/lib/content/about';
import { INSPIRATION_BLOCKS } from '../../src/lib/content/inspiration';
import {
  ACCESSIBILITY_BLOCKS,
  SECURITY_BLOCKS,
  TERMS_BLOCKS,
} from '../../src/lib/content/more-legal';
import {
  COPYRIGHT_BLOCKS,
  COPYRIGHT_LINE,
  DISCLAIMER_BLOCKS,
  licenceLinks,
} from '../../src/lib/content/legal';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { ACTS } from '../../src/lib/content/acts';
import { FILE_SOURCES, type ContentBlock } from '../../src/lib/content/content-block';
import {
  ALLOW_WRITES_SNIPPET,
  BOARD_ON_ANY_DEVICE,
  COPIED_MESSAGE,
  COPY_FAILED_MESSAGE,
  HOOKS_NOTE,
  INSTALL_COMMANDS,
  KIRO_ADD_BUTTON,
  KIRO_IMPORT_INTRO,
  KIRO_IMPORT_SOURCE_NOTE,
  KIRO_UPDATE_NOTE,
  KIRO_IMPORT_STEPS,
  LIVE_MODE_INTRO,
  LIVE_MODE_STEPS,
  NODE_REQUIREMENT,
  OTHER_CLIENTS,
  OTHER_CLIENTS_NOTE,
  PLAN_ON_COMPUTER,
  clientConfig,
  commandText,
  kiroImportOptions,
  npmRelease,
} from '../../src/lib/content/install';
import {
  BUILDER_CENTER_LINKS,
  PROJECT_BOARD_URL,
  VIDEO_LINKS,
  documentationLinks,
  mcpServerReadmeUrl,
  navGroups,
  SITE_LINKS,
  privateReportingUrl,
} from '../../src/lib/content/links';
import { METAPHOR_HEADERS, METAPHOR_ROWS } from '../../src/lib/content/metaphor';
import { NOTICE, NOTICE_HEADING } from '../../src/lib/content/notice';
import { PRINCIPLES, principleBlocks } from '../../src/lib/content/principles';
import { PRIVACY_SECTIONS, privacyBlocks } from '../../src/lib/content/privacy';
import * as story from '../../src/lib/content/story';
import { SITE_ROOT } from '../support/source-files';

const REPO_ROOT = join(SITE_ROOT, '..');

const storyBlocks: readonly ContentBlock[] = [
  story.TAGLINE,
  story.INTRO,
  story.SEAT_RULE,
  story.SEAT_RULE_SOURCE,
  story.MOST_TOOLS_SHOW,
  story.COMPASS_SHOWS,
  story.MOST_TOOLS_LEAD,
  story.COMPASS_LEAD,
  story.WALK_NOTE,
  story.FIRST_TIMER_LOSS,
  story.DISCLAIMER,
  story.UNOFFICIAL_STATEMENT,
  story.TRY_IT,
  ABOUT_BUILT_BY,
  ABOUT_PRODUCT,
  ...ABOUT_BIO,
  ...INSPIRATION_BLOCKS,
  ...DISCLAIMER_BLOCKS,
  COPYRIGHT_LINE,
  ...COPYRIGHT_BLOCKS,
  ...TERMS_BLOCKS,
  ...ACCESSIBILITY_BLOCKS,
  ...SECURITY_BLOCKS,
];

const installBlocks: readonly ContentBlock[] = [
  PLAN_ON_COMPUTER,
  BOARD_ON_ANY_DEVICE,
  KIRO_ADD_BUTTON,
  KIRO_IMPORT_INTRO,
  ...KIRO_IMPORT_STEPS,
  KIRO_IMPORT_SOURCE_NOTE,
  KIRO_UPDATE_NOTE,
  HOOKS_NOTE,
  ...INSTALL_COMMANDS.map((c) => c.description),
  NODE_REQUIREMENT,
  npmRelease(SITE_LINKS),
  ...OTHER_CLIENTS.flatMap((c) => [c.setup, c.after]),
  OTHER_CLIENTS_NOTE,
  LIVE_MODE_INTRO,
  ...LIVE_MODE_STEPS,
];

const allBlocks: readonly ContentBlock[] = [
  NOTICE,
  ...storyBlocks,
  ...METAPHOR_ROWS.flatMap((r) => [r.term, r.meaning]),
  ...ACTS.flatMap((a) => [a.summary, ...a.points]),
  ...principleBlocks(),
  ...installBlocks,
  ...privacyBlocks(),
];

function readSource(block: ContentBlock): string | null {
  const path = join(REPO_ROOT, block.source);
  return FILE_SOURCES.includes(block.source) && existsSync(path)
    ? readFileSync(path, 'utf8')
    : null;
}

describe('content provenance', () => {
  test('every block has a unique id, text, and a named section', () => {
    const ids = allBlocks.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const block of allBlocks) {
      expect(block.text.length, block.id).toBeGreaterThan(0);
      expect(block.section.length, block.id).toBeGreaterThan(0);
    }
  });

  test('every block names a source that is a file in the repository or the Kiro page', () => {
    for (const block of allBlocks) {
      const isFile = FILE_SOURCES.includes(block.source);
      const isKiro = block.source === 'kiro.dev/docs/powers/installation';
      expect(isFile || isKiro, block.id).toBe(true);
      if (isFile && block.source !== 'packages/mcp-server/README.md') {
        expect(existsSync(join(REPO_ROOT, block.source)), `${block.id}: ${block.source}`).toBe(
          true,
        );
      }
    }
  });

  test('every verbatim block occurs exactly in its source file', () => {
    const verbatim = allBlocks.filter((b) => b.verbatim);
    expect(verbatim.length).toBeGreaterThan(10);
    for (const block of verbatim) {
      const text = readSource(block);
      expect(text, `${block.id} needs a source file`).not.toBeNull();
      expect(text, block.id).toContain(block.text);
    }
  });

  test('the Notice equals the sentence in README.md', () => {
    const readme = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');
    expect(NOTICE.verbatim).toBe(true);
    expect(readme).toContain(NOTICE.text);
    expect(NOTICE.text).toBe(
      're:Invent Compass is an independent community project and is not affiliated with, endorsed by, or sponsored by Amazon Web Services.',
    );
  });

  test('the story states the boarding rule with its official source', () => {
    expect(story.TAGLINE.text).toBe('From your code to your seat, on time.');
    expect(story.COMPASS_SHOWS.text).toBe('Boarding closes at 10:20');
    expect(story.MOST_TOOLS_SHOW.text).toBe('Starts 10:30');
    expect(story.DISCLAIMER.text).toBe('Unofficial. Your badge is your ticket.');
    expect(story.SEAT_RULE_SOURCE.text).toContain('official re:Invent 2026 FAQ');
  });

  test('the metaphor table has the ten terms of the product steering', () => {
    expect(METAPHOR_ROWS).toHaveLength(10);
    expect(METAPHOR_HEADERS).toHaveLength(2);
    expect(METAPHOR_ROWS.map((r) => r.term.text)).toContain('Cancelled flight');
  });

  test('the acts and principles are the three the home page promises', () => {
    expect(ACTS.map((a) => a.title)).toEqual(['Plan', 'Boarding', 'Fly']);
    expect(PRINCIPLES.map((p) => p.title.text)).toEqual([
      'The badge is the ticket',
      'A human approves every write',
      'Local first',
    ]);
  });

  test('the Plan act leads with the code scan and the scanner list the code supports', () => {
    const plan = ACTS[0]?.points.map((p) => p.text).join(' ') ?? '';
    expect(ACTS[0]?.points[0]?.id).toBe('act-plan-repo');
    expect(plan).toContain(
      'Terraform, AWS CDK TypeScript, AWS SDK for JavaScript v3, boto3 and the AWS SDK for .NET',
    );
    for (const phrase of [
      'dev folder of up to 50 git repositories',
      'GitHub repositories through a read-only GitHub App',
      '.NET, Node.js and Python',
      'with a reason for each',
    ]) {
      expect(plan).toContain(phrase);
    }
    expect(plan).not.toMatch(/CloudFormation|SAM/);
  });

  test('the Boarding and Fly acts name the wallet group, the issuer and the change alert', () => {
    const board = ACTS[1]?.points.map((p) => p.text).join(' ') ?? '';
    const fly = ACTS[2]?.points.map((p) => p.text).join(' ') ?? '';
    expect(board).toContain('one group in the wallet, with re:Invent Compass as the issuer');
    expect(fly).toContain('updates or voids passes');
    expect(fly).toContain('change alert');
  });

  test('the home page says live mode is read-only by default', () => {
    const text = principleBlocks()
      .map((b) => b.text)
      .join(' ');
    expect(text).toContain('read-only by default');
    expect(text).toContain('COMPASS_ALLOW_WRITES=1');
  });
});

describe('no impersonation and the product voice', () => {
  const denylist = [
    'official AWS',
    'endorsed by AWS',
    'an AWS product',
    'AWS approved',
    "Amazon's",
    'powered by AWS',
  ];

  test('no block contains impersonating wording', () => {
    for (const block of allBlocks) {
      for (const phrase of denylist) {
        expect(block.text.toLowerCase(), block.id).not.toContain(phrase.toLowerCase());
      }
    }
  });

  test('no block, link label or message contains an em dash or an en dash', () => {
    const strings = [
      ...allBlocks.map((b) => b.text),
      COPIED_MESSAGE,
      COPY_FAILED_MESSAGE,
      ...navGroups(SITE_LINKS).flatMap((g) => [
        g.label,
        ...g.items.flatMap((i) => [i.label, i.description]),
      ]),
      ...kiroImportOptions(SITE_LINKS).flatMap((o) => [o.label, o.value, o.note]),
    ];
    for (const text of strings) {
      expect(text).not.toContain(String.fromCharCode(0x2013));
      expect(text).not.toContain(String.fromCharCode(0x2014));
    }
  });

  test('every privacy section has a heading and at least one item', () => {
    for (const section of PRIVACY_SECTIONS) {
      expect(section.heading.length).toBeGreaterThan(0);
      expect(section.items.length).toBeGreaterThan(0);
    }
  });

  test('the privacy page names the responsible party and the 15 minute and 24 hour limits', () => {
    const text = privacyBlocks()
      .map((b) => b.text)
      .join(' ');
    expect(text).toContain('Hennie Francis');
    expect(text).toContain('15 minutes');
    expect(text).toContain('session ends plus 24 hours');
    expect(text).toContain('No wallet allows a pass to be deleted remotely');
  });

  test('the privacy page states the release-gate items (TAM B6) from the build plan', () => {
    const byId = new Map(privacyBlocks().map((b) => [b.id, b]));
    // forget_me no longer claims to delete the counters, and says why they stay.
    expect(byId.get('privacy-forget-me')?.text).not.toContain('counters');
    expect(byId.get('privacy-rate-counters')?.text).toContain(
      'does not delete the server rate counters',
    );
    expect(byId.get('privacy-rate-counters')?.text).toContain('window ends plus 2 minutes');
    expect(byId.get('privacy-processing-region')?.text).toContain('us-east-1');
    expect(byId.get('privacy-processing-region')?.text).toContain('United States');
    expect(byId.get('privacy-regulator')?.text).toContain('Information Regulator (South Africa)');
    expect(byId.get('privacy-processors')?.text).toContain('Apple');
    expect(byId.get('privacy-processors')?.text).toContain('Google');
    expect(byId.get('privacy-contact')?.text).toContain('private vulnerability reporting');
    expect(byId.get('privacy-rights')?.text).toContain('POPIA');
    expect(byId.get('privacy-generated-files')?.text).toContain('writes no pass files');
    expect(byId.get('privacy-forget-me')?.text).toContain('your tech list, your GitHub sign-in');
    expect(byId.get('privacy-forget-me')?.text).toContain('until they expire');
    expect(byId.get('privacy-tokens')?.text).toContain('ID token');
    expect(byId.get('privacy-tokens')?.text).toContain('in memory only');
    expect(byId.get('privacy-logs')?.text).toContain('14 days');
    expect(byId.get('privacy-no-backup')?.text).toContain('Point-in-time recovery is off');
    expect(byId.get('privacy-site-none')?.text).toContain('no browser storage');
    expect(
      privacyBlocks()
        .map((b) => b.id)
        .filter((id) => id.startsWith('privacy-')),
    ).toEqual([...new Set(privacyBlocks().map((b) => b.id))]);
  });
});

describe('demo session data attribution', () => {
  const rules = readFileSync(join(REPO_ROOT, 'docs/hackathon-rules.md'), 'utf8');
  const byId = new Map(allBlocks.map((b) => [b.id, b]));

  test('the Disclaimer and Privacy pages credit the AWS Events API and name the owner decision', () => {
    expect(rules).toContain('the session catalog is public');
    expect(rules).toContain(
      'code, title, times, venue and room only, credited to the AWS Events API',
    );
    for (const id of ['disclaimer-demo-data', 'privacy-site-session-data']) {
      expect(byId.get(id)?.source, id).toBe('docs/hackathon-rules.md');
    }
    expect(byId.get('disclaimer-demo-data')?.text).toContain('credited to the AWS Events API');
    expect(byId.get('privacy-site-session-data')?.text).toContain('no personal data');
    expect(byId.get('privacy-site-demo')?.text).toContain('real sessions');
  });

  test('no site copy still calls the web demo sessions made up', () => {
    // The terminal demo (npx reinvent-compass demo) really does run on synthetic data.
    for (const block of allBlocks.filter((b) => b.id !== 'install-cmd-demo')) {
      expect(block.text.toLowerCase(), block.id).not.toMatch(/made[- ]up|synthetic|fictional/);
    }
  });
});

describe('links and footer', () => {
  test('the data request link is the private reporting form of the repository', () => {
    expect(privateReportingUrl(SITE_LINKS)).toBe(
      `${SITE_LINKS.repository}/security/advisories/new`,
    );
  });

  test('the footer is the Notice under its heading (task 27)', () => {
    expect(NOTICE_HEADING).toBe('Disclaimer Notice');
  });

  test('the Builder Center and Video Library items open pages of the site, with their descriptions (task 54)', () => {
    const project = navGroups(SITE_LINKS)[1]?.items ?? [];
    expect(project[2]).toEqual({
      kind: 'internal',
      label: 'Builder Center',
      path: '/builder-center',
      description: 'How Compass was built with Kiro',
    });
    expect(project[3]).toEqual({
      kind: 'internal',
      label: 'Video Library',
      path: '/videos',
      description: 'See Compass in action',
    });
    expect(project[0]).toMatchObject({
      kind: 'external',
      label: 'Repository',
      href: 'https://github.com/henniefrancis/aws-re_invent-compass',
    });
  });

  test('the Videos page lists the five project videos on YouTube, each described (task 54)', () => {
    expect(VIDEO_LINKS.map((v) => v.label)).toEqual([
      'Promotional Video',
      'Plan with Kiro IDE',
      'Plan with Terminal',
      'Boarding with Passes',
      'Fly with Updates',
    ]);
    for (const video of VIDEO_LINKS) {
      expect(video.href, video.label).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/);
      expect(video.description.length, video.label).toBeGreaterThan(0);
    }
  });

  test('the Builder Center page lists the posts on AWS Builder Center, each described (task 54)', () => {
    expect(BUILDER_CENTER_LINKS.map((l) => l.label)).toEqual([
      'Builder Journey',
      'Operational Stats and Expenses',
      'The Hackathon Project',
      'Builder Center Profile',
    ]);
    for (const link of BUILDER_CENTER_LINKS) {
      expect(link.href, link.label).toMatch(/^https:\/\/builder\.aws\.com\//);
      expect(link.description.length, link.label).toBeGreaterThan(0);
    }
  });

  test('the navigation has Product, Project, About and Legal, each item described (task 28)', () => {
    const groups = navGroups(SITE_LINKS);
    expect(groups.map((g) => [g.label, g.items.map((i) => i.label)])).toEqual([
      ['Product', ['Try the demo', 'Install']],
      ['Project', ['Repository', 'Documentation', 'Builder Center', 'Video Library']],
      ['About', ['The Inspiration', 'The Creator']],
      [
        'Legal',
        [
          'Terms of use',
          'Privacy',
          'Disclaimer',
          'Copyright and licence',
          'Security',
          'Accessibility',
          'Open-source credits',
        ],
      ],
    ]);
    expect(groups[2]?.items[0]?.description).toBe('What inspired the project direction');
    for (const item of groups.flatMap((g) => g.items)) {
      expect(item.description.length, item.label).toBeGreaterThan(0);
    }
    const project = navGroups(SITE_LINKS)[1]?.items ?? [];
    expect(project.map((i) => i.kind)).toEqual(['external', 'internal', 'internal', 'internal']);
  });

  test('documentation and licence links point into the repository, its wiki or the project board (tasks 28 and 49)', () => {
    const docs = documentationLinks(SITE_LINKS);
    expect(docs.map((d) => d.label)).toEqual([
      'README',
      'Get started',
      'User guide',
      'Architecture',
      'Key decisions',
      'Developer guide',
      'Operations',
      'Runbooks',
      'How it was built',
      'Reference',
      'Kiro specs',
      'Project board',
    ]);
    // Each wiki section opens on the first page under its sidebar heading.
    const sidebar = readFileSync(join(REPO_ROOT, 'wiki/_Sidebar.md'), 'utf8');
    for (const doc of docs.filter((d) => d.href.includes('/wiki/'))) {
      const page = doc.href.slice(doc.href.lastIndexOf('/') + 1);
      expect(sidebar, doc.label).toContain(`](${page})`);
    }
    expect(docs.find((d) => d.label === 'Project board')?.href).toBe(
      'https://github.com/users/henniefrancis/projects/3',
    );
    for (const link of [
      ...docs.filter((d) => d.href !== PROJECT_BOARD_URL),
      ...licenceLinks(SITE_LINKS),
    ]) {
      expect(link.href.startsWith(SITE_LINKS.repository), link.label).toBe(true);
    }
    for (const doc of docs) {
      expect(doc.description.length, doc.label).toBeGreaterThan(0);
    }
    expect(licenceLinks(SITE_LINKS).map((l) => l.href)).toEqual([
      `${SITE_LINKS.repository}/blob/main/LICENSE`,
      `${SITE_LINKS.repository}/blob/main/NOTICE`,
    ]);
    expect(COPYRIGHT_LINE.text).toBe('Copyright 2026 Hennie Francis');
  });
});

describe('install content', () => {
  test('gives the power folder URL as the one import address (SP1, 4 November)', () => {
    const options = kiroImportOptions(SITE_LINKS);
    expect(options.map((o) => o.id)).toEqual(['power-folder']);
    expect(options[0]?.value).toBe(`${SITE_LINKS.repository}/tree/main/power`);
    expect(options[0]?.note).toContain('not the repository address');
  });

  test('tells existing users how to update the power, because importing again is not enough (task 66)', () => {
    expect(KIRO_UPDATE_NOTE.text).toContain('~/.kiro/powers/repos');
    expect(KIRO_UPDATE_NOTE.text).toContain('import the folder address again');
    expect(KIRO_UPDATE_NOTE.text).toContain(
      'delete only the folders that hold the Compass repository',
    );
    expect(KIRO_UPDATE_NOTE.text).toContain('ask for the hooks again');
  });

  test('enables MCP in Kiro before the import steps', () => {
    expect(KIRO_IMPORT_STEPS[0]?.text).toBe(
      'In Settings, set Kiro Agent: Configure MCP to Enabled. Kiro starts no MCP server until you do.',
    );
  });

  test('names the pinned npm version from packageVersion, with no date to go stale', () => {
    expect(npmRelease(SITE_LINKS).text).toBe(
      `Compass runs from the npm package reinvent-compass, version ${SITE_LINKS.packageVersion}.`,
    );
    expect(npmRelease({ ...SITE_LINKS, packageVersion: null }).text).toBe(
      'Compass runs from the npm package reinvent-compass.',
    );
  });

  test('shows the two npx commands, pinned only when a version is known', () => {
    const unpinned = INSTALL_COMMANDS.map((c) =>
      commandText(c, { ...SITE_LINKS, packageVersion: null }),
    );
    expect(unpinned).toEqual(['npx reinvent-compass', 'npx reinvent-compass demo']);
    const commands = INSTALL_COMMANDS.map((c) => commandText(c, SITE_LINKS));
    expect(commands).toEqual(['npx reinvent-compass@0.1.2', 'npx reinvent-compass@0.1.2 demo']);
    const pinned = INSTALL_COMMANDS.map((c) =>
      commandText(c, { ...SITE_LINKS, packageVersion: '1.0.0' }),
    );
    expect(pinned).toEqual(['npx reinvent-compass@1.0.0', 'npx reinvent-compass@1.0.0 demo']);
  });

  test('states Node.js 24 and sets up Claude Desktop, VS Code and the Kiro CLI', () => {
    expect(NODE_REQUIREMENT.text).toContain('Node.js 24');
    expect(OTHER_CLIENTS.map((c) => c.name)).toEqual(['Claude Desktop', 'VS Code', 'Kiro CLI']);
    expect(clientConfig('mcpServers', SITE_LINKS)).toBe(
      [
        '{',
        '  "mcpServers": {',
        '    "compass": {',
        '      "command": "npx",',
        '      "args": ["--yes", "reinvent-compass@0.1.2"]',
        '    }',
        '  }',
        '}',
      ].join('\n'),
    );
    const vscode = JSON.parse(clientConfig('servers', SITE_LINKS)) as {
      servers: { compass: { type: string; args: string[] } };
    };
    expect(vscode.servers.compass.type).toBe('stdio');
    expect(vscode.servers.compass.args).toEqual(['--yes', 'reinvent-compass@0.1.2']);
    expect(clientConfig('mcpServers', { ...SITE_LINKS, packageVersion: null })).toContain(
      '"args": ["--yes", "reinvent-compass"]',
    );
    expect(mcpServerReadmeUrl(SITE_LINKS)).toBe(
      `${SITE_LINKS.repository}/blob/main/packages/mcp-server/README.md`,
    );
    expect(COPIED_MESSAGE).toBe('Copied');
  });

  test('explains live mode: Builder ID, read-only by default, writes, Plan my re:Invent, GitHub', () => {
    const text = [LIVE_MODE_INTRO, ...LIVE_MODE_STEPS].map((b) => b.text).join(' ');
    for (const phrase of [
      'AWS Builder ID that is registered for re:Invent 2026',
      'read-only by default',
      'COMPASS_ALLOW_WRITES=1',
      '"Plan my re:Invent."',
      'connect_github',
    ]) {
      expect(text).toContain(phrase);
    }
    expect(ALLOW_WRITES_SNIPPET).toBe('"env": { "COMPASS_ALLOW_WRITES": "1" }');
  });
});
