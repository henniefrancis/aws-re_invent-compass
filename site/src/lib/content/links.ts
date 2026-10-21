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
  packageVersion: null,
};

/** The private vulnerability reporting form of the repository, the contact channel for data requests. */
export function privateReportingUrl(links: SiteLinks): string {
  return `${links.repository}/security/advisories/new`;
}

export const COMING_SOON = 'coming soon';

export type FooterItem =
  | { readonly kind: 'external'; readonly label: string; readonly href: string }
  | { readonly kind: 'internal'; readonly label: string; readonly path: string }
  | { readonly kind: 'pending'; readonly label: string; readonly text: string };

function externalOrPending(label: string, href: string | null): FooterItem {
  return href === null
    ? { kind: 'pending', label, text: `${label} (${COMING_SOON})` }
    : { kind: 'external', label, href };
}

/** The footer links in their fixed order, the same on every page. */
export function footerItems(links: SiteLinks): readonly FooterItem[] {
  return [
    { kind: 'external', label: 'Repository', href: links.repository },
    externalOrPending('Builder Center post', links.builderCenterPost),
    externalOrPending('Video', links.video),
    { kind: 'internal', label: 'Install', path: '/install' },
    { kind: 'internal', label: 'Privacy', path: '/privacy' },
  ];
}

/** One item of a navigation group, with a one-line description under its label. */
export type NavItem = FooterItem & { readonly description: string };

/** A group of the main navigation (task 26, Requirement 4.1). */
export interface NavGroup {
  readonly id: 'product' | 'project' | 'about';
  readonly label: string;
  readonly items: readonly NavItem[];
}

/** The main navigation: three groups, in order. Unknown addresses stay plain "coming soon" text. */
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
          description: 'Plan a made-up week in your browser',
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
          label: 'About the creator',
          path: '/about',
          description: 'Who built re:Invent Compass',
        },
        {
          kind: 'internal',
          label: 'Privacy',
          path: '/privacy',
          description: 'What leaves your machine, and what does not',
        },
      ],
    },
  ];
}
