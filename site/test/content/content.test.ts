import { ABOUT_BIO, ABOUT_BUILT_BY } from '../../src/lib/content/about';
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
  BOARD_ON_ANY_DEVICE,
  COPIED_MESSAGE,
  COPY_FAILED_MESSAGE,
  HOOKS_NOTE,
  INSTALL_COMMANDS,
  KIRO_ADD_BUTTON,
  KIRO_IMPORT_INTRO,
  KIRO_IMPORT_SOURCE_NOTE,
  KIRO_IMPORT_STEPS,
  NODE_REQUIREMENT,
  OTHER_CLIENTS,
  PLAN_ON_COMPUTER,
  commandText,
  kiroImportOptions,
} from '../../src/lib/content/install';
import {
  COMING_SOON,
  documentationLinks,
  navGroups,
  SITE_LINKS,
  privateReportingUrl,
  type SiteLinks,
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
  HOOKS_NOTE,
  ...INSTALL_COMMANDS.map((c) => c.description),
  NODE_REQUIREMENT,
  ...OTHER_CLIENTS,
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

  test('the story states the seat release rule with its official source', () => {
    expect(story.TAGLINE.text).toBe('From your code to your seat, on time.');
    expect(story.COMPASS_SHOWS.text).toBe('Seat released at 10:20');
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

  test('the scanner list follows the build plan, not the longer CONCEPT.md list', () => {
    const plan = ACTS[0]?.points.map((p) => p.text).join(' ') ?? '';
    expect(plan).toContain('Terraform, AWS CDK TypeScript, AWS SDK for JavaScript v3 and boto3');
    expect(plan).not.toMatch(/CloudFormation|SAM/);
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
    expect(
      privacyBlocks()
        .map((b) => b.id)
        .filter((id) => id.startsWith('privacy-')),
    ).toEqual([...new Set(privacyBlocks().map((b) => b.id))]);
  });
});

describe('links and footer', () => {
  const known: SiteLinks = {
    ...SITE_LINKS,
    builderCenterPost: 'https://example.invalid/post',
    video: 'https://example.invalid/video',
  };

  test('the data request link is the private reporting form of the repository', () => {
    expect(privateReportingUrl(SITE_LINKS)).toBe(
      `${SITE_LINKS.repository}/security/advisories/new`,
    );
  });

  test('the footer is the Notice under its heading (task 27)', () => {
    expect(NOTICE_HEADING).toBe('Disclaimer Notice');
  });

  test('an unknown address becomes coming soon text with no link, a known one a link', () => {
    const project = (links: typeof SITE_LINKS) => navGroups(links)[1]?.items ?? [];
    expect(project(SITE_LINKS)[2]).toEqual({
      kind: 'pending',
      label: 'Builder Center post',
      text: `Builder Center post (${COMING_SOON})`,
      description: 'How Compass was built with Kiro',
    });
    expect(project(known)[2]).toEqual({
      kind: 'external',
      label: 'Builder Center post',
      href: 'https://example.invalid/post',
      description: 'How Compass was built with Kiro',
    });
    expect(project(known)[0]).toMatchObject({
      kind: 'external',
      label: 'Repository',
      href: 'https://github.com/henniefrancis/aws-re_invent-compass',
    });
  });

  test('the navigation has Product, Project, About and Legal, each item described (task 28)', () => {
    const groups = navGroups(SITE_LINKS);
    expect(groups.map((g) => [g.label, g.items.map((i) => i.label)])).toEqual([
      ['Product', ['Try the demo', 'Install']],
      ['Project', ['Repository', 'Documentation', 'Builder Center post', 'Video']],
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
    // Unknown addresses stay plain text; known ones become links.
    const project = (links: typeof SITE_LINKS) => navGroups(links)[1]?.items ?? [];
    expect(project(SITE_LINKS).map((i) => i.kind)).toEqual([
      'external',
      'internal',
      'pending',
      'pending',
    ]);
    const known = {
      ...SITE_LINKS,
      builderCenterPost: 'https://example.invalid/post',
      video: 'https://example.invalid/video',
    };
    expect(project(known).map((i) => i.kind)).toEqual([
      'external',
      'internal',
      'external',
      'external',
    ]);
  });

  test('documentation and licence links all point into the repository (tasks 28)', () => {
    const docs = documentationLinks(SITE_LINKS);
    expect(docs.map((d) => d.label)).toEqual([
      'README',
      'Build plan',
      'Architecture decision records',
      'Runbooks',
      'Kiro specs',
    ]);
    for (const link of [...docs, ...licenceLinks(SITE_LINKS)]) {
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
  test('shows both import options, with the repository address first', () => {
    const options = kiroImportOptions(SITE_LINKS);
    expect(options.map((o) => o.id)).toEqual(['repository', 'power-folder']);
    expect(options[0]?.value).toBe(SITE_LINKS.repository);
    expect(options[1]?.value).toContain('power/');
  });

  test('shows the two npx commands, pinned only when a version is known', () => {
    const commands = INSTALL_COMMANDS.map((c) => commandText(c, SITE_LINKS));
    expect(commands).toEqual(['npx reinvent-compass', 'npx reinvent-compass demo']);
    const pinned = INSTALL_COMMANDS.map((c) =>
      commandText(c, { ...SITE_LINKS, packageVersion: '1.0.0' }),
    );
    expect(pinned).toEqual(['npx reinvent-compass@1.0.0', 'npx reinvent-compass@1.0.0 demo']);
  });

  test('states Node.js 24 and invents no client setup before S3 has merged', () => {
    expect(NODE_REQUIREMENT.text).toContain('Node.js 24');
    expect(OTHER_CLIENTS).toEqual([]);
    expect(COPIED_MESSAGE).toBe('Copied');
  });
});
