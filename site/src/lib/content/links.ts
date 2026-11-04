// Links the site shows (showcase-site, Component 3).
//
// A null address means "not known yet". The site then shows plain "coming soon" text and never
// links to an address it does not know. The Builder Center post and the video exist only
// after the site freeze, so their addresses ship in a one-file hotfix to this file.

export interface SiteLinks {
  /** From CONCEPT.md section 12. */
  readonly repository: string;
  readonly builderCenterPost: string | null;
  readonly video: string | null;
  /** Set only if Compass is listed on kiro.dev/powers. */
  readonly kiroPowerListing: string | null;
  /** The npm version pinned in the npx commands once the package is published. */
  readonly packageVersion: string | null;
}

export const SITE_LINKS: SiteLinks = {
  repository: 'https://github.com/henniefrancis/aws-re_invent-compass',
  builderCenterPost: null,
  video: null,
  kiroPowerListing: null,
  packageVersion: '0.1.2',
};

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

function externalOrPending(label: string, href: string | null): LinkItem {
  return href === null
    ? { kind: 'pending', label, text: `${label} (${COMING_SOON})` }
    : { kind: 'external', label, href };
}

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
          ...externalOrPending('Builder Center post', links.builderCenterPost),
          description: 'How Compass was built with Kiro',
        },
        { ...externalOrPending('Video', links.video), description: 'See Compass in action' },
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

/** The Documentation_Page links (Requirement 26): the README, one link per wiki section (the wiki sidebar headings) and the Kiro specs (task 49). */
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
