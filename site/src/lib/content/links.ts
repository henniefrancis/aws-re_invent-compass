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

/** The main navigation, in order. */
export const NAV_ITEMS: readonly { readonly label: string; readonly path: string }[] = [
  { label: 'Home', path: '/' },
  { label: 'Demo', path: '/demo' },
  { label: 'Install', path: '/install' },
  { label: 'Privacy', path: '/privacy' },
];
