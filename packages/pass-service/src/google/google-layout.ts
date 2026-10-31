// The Google Wallet pass layout (task 47): the images and the text module ids the class template
// places. One source for both sides: google-object.ts writes the modules and images, and
// scripts/google-wallet-class.mjs builds the class template from the same ids. No imports, so
// Node loads this file with type stripping (the class script and make-artwork.mjs).
//
// Google fetches an image by its public HTTPS URL, so the images are files, not part of the
// bundle: scripts/make-artwork.mjs renders them into packages/pass-service/artwork/google/, and
// scripts/release.sh adds them to the built site under wallet/, so the site sync uploads them
// (infra task 25) and the distribution serves them at <PUBLIC_BASE_URL>/wallet/<file>. Google
// caches an image by URL, so a changed picture gets a new version in its name.

export const GOOGLE_IMAGES = {
  /**
   * The icon on the card blue, 660 by 660 pixels with a 15 percent margin. Google masks it into a
   * circle where the wide logo does not fit, and refuses a wide logo without it (task 47.8).
   */
  logo: 'logo-v1.png',
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

/**
 * The detail modules the class carries instead of each object (task 47.7): the texts that are the
 * same on every pass. Google takes at most 10 text modules from the object and 10 from the class,
 * so the object keeps only the front rows and the per-pass details (at most 8).
 */
export const GOOGLE_CLASS_MODULES = [
  'about',
  'unofficial',
  'seatRule',
  'plans',
  'privacy',
] as const;

/** Google's limit of text modules from one object, and from one class. */
export const GOOGLE_MAX_TEXT_MODULES = 10;
