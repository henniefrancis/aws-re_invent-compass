// Links the site shows (showcase-site, Component 3).
//
// A null address means "not known yet". The site then shows plain "coming soon" text and never
// links to an address it does not know. The videos and the Builder Center posts are listed on
// their own pages (task 54), so a new address is a one-line change to this file.

export interface SiteLinks {
  /** From CONCEPT.md section 12. */
  readonly repository: string;
  /** Set only if Compass is listed on kiro.dev/powers. */
  readonly kiroPowerListing: string | null;
  /** The npm version pinned in the npx commands once the package is published. */
  readonly packageVersion: string | null;
}

export const SITE_LINKS: SiteLinks = {
  repository: 'https://github.com/henniefrancis/aws-re_invent-compass',
  kiroPowerListing: null,
  packageVersion: '0.1.2',
};

/** One card on a list page (Videos, Builder Center): a null address shows "coming soon". */
export interface ListLink {
  readonly label: string;
  readonly href: string | null;
  readonly description: string;
}

/** The project videos on YouTube: the promotional video, then the story of Plan, Board, Fly (task 54). */
export const VIDEO_LINKS: readonly ListLink[] = [
  {
    label: 'Promotional Video',
    href: 'https://www.youtube.com/watch?v=YKumzOFCAog',
    description: 'A short tour of Compass, from your code to your seat at re:Invent',
  },
  {
    label: 'Plan with Kiro IDE',
    href: 'https://www.youtube.com/watch?v=Xm6ZobZ8smY',
    description:
      'Compass scans your code in Kiro, suggests the sessions that match your stack and writes your week as a Kiro spec',
  },
  {
    label: 'Plan with Terminal',
    href: 'https://www.youtube.com/watch?v=XXz5B5a0nRM',
    description: 'Plan your week from the terminal, without an IDE',
  },
  {
    label: 'Boarding with Passes',
    href: 'https://www.youtube.com/watch?v=T9ycY93RnHU',
    description:
      'Each reserved session becomes a boarding pass, sent to your phone for Apple Wallet or Google Wallet',
  },
  {
    label: 'Fly with Updates',
    href: 'https://www.youtube.com/watch?v=x_l_M3ByYEA',
    description: 'Keep your passes right while the week changes, with change alerts on your phone',
  },
];

/** The creator's posts on AWS Builder Center, newest topic first (task 54). */
export const BUILDER_CENTER_LINKS: readonly ListLink[] = [
  {
    label: 'Builder Journey',
    href: 'https://builder.aws.com/content/3LVhghIjFObX3utBCV2t31xJjqR/reinvent-compass-from-your-code-to-your-seat-on-time',
    description: 'How Compass was built with Kiro, and what it does for your re:Invent week',
  },
  {
    label: 'Operational Stats and Expenses',
    href: 'https://builder.aws.com/content/3LWRjwavL1lcilvpa3XAgpceMLc/reinvent-compass-project-stats-and-costs',
    description:
      'The measured numbers: tests, Lighthouse scores, build times and the monthly AWS cost',
  },
  {
    label: 'The Hackathon Project',
    href: 'https://builder.aws.com/project/3LE6YlbFWwf3mrjiuOyMl9wBBo2/reinvent-compass-from-your-code-to-your-seat-on-time',
    description: 'Compass as an entry in the AWS re:Invent hackathon',
  },
  {
    label: 'Builder Center Profile',
    href: 'https://builder.aws.com/community/@henniefrancis',
    description: 'Every post by Hennie Francis on AWS Builder Center',
  },
];

/** The site's own address, for the canonical link and og:url of each page. */
export const SITE_URL = 'https://reinvent-compass.vegas/';

/** The public project board, where the build was tracked. */
export const PROJECT_BOARD_URL = 'https://github.com/users/henniefrancis/projects/3';

/** The README of the MCP server package: the setup for every client. */
export function mcpServerReadmeUrl(links: SiteLinks): string {
  return `${links.repository}/blob/main/packages/mcp-server/README.md`;
}

/** The private vulnerability reporting form of the repository, the contact channel for data requests. */
export function privateReportingUrl(links: SiteLinks): string {
  return `${links.repository}/security/advisories/new`;
}

/** The two maps apps the board page can open for walking directions (showcase-site task 40). */
export type MapsApp = 'apple' | 'google';

/**
 * A link that opens walking directions to a point in Apple Maps or Google Maps. The link names
 * only the destination, so the maps app uses the phone's own location as the start, and it
 * receives that location only when the attendee opens the link.
 */
export function directionsUrl(app: MapsApp, point: { lat: number; lon: number }): string {
  const destination = `${point.lat.toFixed(6)},${point.lon.toFixed(6)}`;
  return app === 'apple'
    ? `https://maps.apple.com/?daddr=${destination}&dirflg=w`
    : `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=walking`;
}

export const COMING_SOON = 'coming soon';

/** A link the site shows: inside the site, outside it, or plain text while the address is unknown. */
export type LinkItem =
  | { readonly kind: 'external'; readonly label: string; readonly href: string }
  | { readonly kind: 'internal'; readonly label: string; readonly path: string }
  | { readonly kind: 'pending'; readonly label: string; readonly text: string };

/** One item of a navigation group, with a one-line description under its label. */
export type NavItem = LinkItem & { readonly description: string };

/** A group of the main navigation (task 26, Requirement 4.1). */
export interface NavGroup {
  readonly id: 'product' | 'project' | 'about' | 'legal';
  readonly label: string;
  readonly items: readonly NavItem[];
}

/** The main navigation: four groups, in order. Unknown addresses stay plain "coming soon" text. */
export function navGroups(links: SiteLinks): readonly NavGroup[] {
  return [
    {
      id: 'product',
      label: 'Product',
      items: [
        {
          kind: 'internal',
          label: 'Try the demo',
          path: '/demo',
          description: 'Plan a week of real sessions in your browser',
        },
        {
          kind: 'internal',
          label: 'Install',
          path: '/install',
          description: 'Add the Kiro Power or run it with npx',
        },
      ],
    },
    {
      id: 'project',
      label: 'Project',
      items: [
        {
          kind: 'external',
          label: 'Repository',
          href: links.repository,
          description: 'The source code on GitHub',
        },
        {
          kind: 'internal',
          label: 'Documentation',
          path: '/documentation',
          description: 'How Compass is built and run',
        },
        {
          kind: 'internal',
          label: 'Builder Center',
          path: '/builder-center',
          description: 'How Compass was built with Kiro',
        },
        {
          kind: 'internal',
          label: 'Video Library',
          path: '/videos',
          description: 'See Compass in action',
        },
      ],
    },
    {
      id: 'about',
      label: 'About',
      items: [
        {
          kind: 'internal',
          label: 'The Inspiration',
          path: '/inspiration',
          description: 'What inspired the project direction',
        },
        {
          kind: 'internal',
          label: 'The Creator',
          path: '/about',
          description: 'Who built re:Invent Compass',
        },
      ],
    },
    {
      id: 'legal',
      label: 'Legal',
      items: [
        {
          kind: 'internal',
          label: 'Terms of use',
          path: '/terms',
          description: 'The rules for using Compass and this site',
        },
        {
          kind: 'internal',
          label: 'Privacy',
          path: '/privacy',
          description: 'What leaves your machine, and what does not',
        },
        {
          kind: 'internal',
          label: 'Disclaimer',
          path: '/disclaimer',
          description: 'What Compass is, and what it is not',
        },
        {
          kind: 'internal',
          label: 'Copyright and licence',
          path: '/copyright',
          description: 'Who owns Compass and how you may reuse it',
        },
        {
          kind: 'internal',
          label: 'Security',
          path: '/security',
          description: 'How Compass protects you, and how to report a problem',
        },
        {
          kind: 'internal',
          label: 'Accessibility',
          path: '/accessibility',
          description: 'Built for keyboards, screen readers and every screen',
        },
        {
          kind: 'internal',
          label: 'Open-source credits',
          path: '/credits',
          description: 'The libraries Compass is built on',
        },
      ],
    },
  ];
}

/** The repository's issue tracker, for reporting an accessibility barrier (Requirement 28.3). */
export function issuesUrl(links: SiteLinks): string {
  return `${links.repository}/issues`;
}

/** The repository's security policy (Requirement 28.4). */
export function securityPolicyUrl(links: SiteLinks): string {
  return `${links.repository}/blob/main/SECURITY.md`;
}

/** The Documentation_Page links (Requirement 26): the README, one link per wiki section (the wiki sidebar headings), the Kiro specs (task 49) and the public project board. */
export function documentationLinks(
  links: SiteLinks,
): readonly { readonly label: string; readonly href: string; readonly description: string }[] {
  const wiki = `${links.repository}/wiki`;
  return [
    {
      label: 'README',
      href: `${links.repository}#readme`,
      description: 'What Compass does, how to install it and how to run it',
    },
    {
      label: 'Get started',
      href: `${wiki}/Getting-Started`,
      description: 'Three ways to try Compass, and short answers to common questions',
    },
    {
      label: 'User guide',
      href: `${wiki}/User-Guide-Plan`,
      description: 'Plan your week, board your sessions and get to every seat on time',
    },
    {
      label: 'Architecture',
      href: `${wiki}/Architecture-Overview`,
      description: 'What Compass is made of, where each part runs and how the parts connect',
    },
    {
      label: 'Key decisions',
      href: `${wiki}/Key-Decisions`,
      description: 'Every design decision, with the reason for it',
    },
    {
      label: 'Developer guide',
      href: `${wiki}/Repository-Layout`,
      description: 'The repository layout, how to build and test, and how to contribute',
    },
    {
      label: 'Operations',
      href: `${wiki}/Operations`,
      description: 'The environments, who runs what and the ground rules',
    },
    {
      label: 'Runbooks',
      href: `${wiki}/Runbooks`,
      description: 'How to release, watch, roll back, handle secrets and tear down',
    },
    {
      label: 'How it was built',
      href: `${wiki}/How-It-Was-Built`,
      description: 'The build story, the Kiro specs and the steering',
    },
    {
      label: 'Reference',
      href: `${wiki}/MCP-Tools`,
      description: 'The MCP tools, the pass API, Events API coverage and the glossary',
    },
    {
      label: 'Kiro specs',
      href: `${links.repository}/tree/main/.kiro/specs`,
      description: 'The requirements, design and tasks each part was built from',
    },
    {
      label: 'Project board',
      href: PROJECT_BOARD_URL,
      description: 'How Compass was planned and built, task by task',
    },
  ];
}

/** One of the creator's own pages, shown as the owner's image for it (task 35). */
export interface CreatorLink {
  /** The link's name, also the image's text alternative. */
  readonly label: string;
  readonly href: string;
  readonly image: string;
}

/** The creator's own pages, under the photo on The Creator page (tasks 34 and 35). */
export const CREATOR_LINKS: readonly CreatorLink[] = [
  {
    label: 'Personal website',
    href: 'https://henniefrancis.tech/',
    image: '/artwork/connect-website.webp',
  },
  {
    label: 'LinkedIn',
    href: 'https://www.linkedin.com/in/henniefrancis/',
    image: '/artwork/connect-linkedin.webp',
  },
  {
    label: 'GitHub',
    href: 'https://github.com/henniefrancis',
    image: '/artwork/connect-github.webp',
  },
  {
    label: 'AWS Community South Africa',
    href: 'https://www.awscommunity.co.za/',
    image: '/artwork/connect-awscommza.webp',
  },
  {
    label: 'AWS Builder Center',
    href: 'https://builder.aws.com/community/@henniefrancis',
    image: '/artwork/connect-builder-center.webp',
  },
];
