// Document titles and page addresses (showcase-site, Component 2).

import { SITE_URL } from '../content/links';
import { PRODUCT_NAME } from '../content/story';

/** The title of a page: "<page name> | re:Invent Compass", or the product name alone. */
export function pageTitle(pageName: string | undefined): string {
  return pageName === undefined || pageName === '' ? PRODUCT_NAME : `${pageName} | ${PRODUCT_NAME}`;
}

/**
 * The public address of a page, for its canonical link and og:url: the site address plus the
 * route path, without a query or a fragment (the board page's hand-off secret lives in the
 * fragment and must never reach a tag).
 */
export function pageUrl(routerUrl: string): string {
  const trimmed = routerUrl
    .replace(/[?#][\s\S]*$/, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  return trimmed === '' ? SITE_URL : `${SITE_URL}${trimmed}`;
}
