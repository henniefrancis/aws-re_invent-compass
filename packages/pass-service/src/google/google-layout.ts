// The Google Wallet pass layout (task 47): the images and the text module ids the class template
// places. One source for both sides: google-object.ts writes the modules and images, and
// scripts/google-wallet-class.mjs builds the class template from the same ids. No imports, so
// Node loads this file with type stripping (the class script and make-artwork.mjs).
//
// Google fetches an image by its public HTTPS URL, so the images are files, not part of the
// bundle: scripts/make-artwork.mjs renders them into packages/pass-service/artwork/google/, and
// the site module of infra uploads them under wallet/ in the site bucket (infra task 24), served
// at <PUBLIC_BASE_URL>/wallet/<file>. Google caches an image by URL, so a changed picture gets a
// new version in its name.

export const GOOGLE_IMAGES = {
  /** The icon alone, 1280 by 400 pixels, transparent and left-aligned. */
  wideLogo: 'wide-logo-v1.png',
  /** The Pass Designer gradient with the full logo over a soft glow, 1032 by 812 pixels. */
  hero: 'hero-v1.png',
} as const;

/** The path under the public origin that serves the images. */
export const GOOGLE_IMAGE_PATH = '/wallet/';

/**
 * The front rows, start and end item, as on the Apple pass's secondary and auxiliary rows:
 * terminal and gate, then the date and boarding closes.
 */
export const GOOGLE_FRONT_ROWS = [
  ['terminal', 'gate'],
  ['date', 'boardingCloses'],
] as const;

/**
 * The details, in order: the Apple back without the attendee name, since Google keeps the
 * object on its servers, and with the room first. A module without data is not written, and
 * Google skips its row.
 */
export const GOOGLE_DETAIL_MODULES = [
  'roomFull',
  'about',
  'unofficial',
  'seatRule',
  'walk',
  'next',
  'timezone',
  'plans',
  'privacy',
] as const;
