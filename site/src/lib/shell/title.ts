// Document titles (showcase-site, Component 2).

import { PRODUCT_NAME } from '../content/story';

/** The title of a page: "<page name> | re:Invent Compass", or the product name alone. */
export function pageTitle(pageName: string | undefined): string {
  return pageName === undefined || pageName === '' ? PRODUCT_NAME : `${pageName} | ${PRODUCT_NAME}`;
}
