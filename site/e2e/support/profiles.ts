// The seven Device_Profiles of the browser suite (showcase-site, Requirement 20).
// Each one names a descriptor of Playwright's device registry; a vitest test checks that every
// descriptor exists in the pinned Playwright version.

import { devices } from '@playwright/test';
import type { PlaywrightTestOptions, PlaywrightWorkerOptions } from '@playwright/test';

export interface Profile {
  readonly name: string;
  readonly descriptor: string;
  readonly browser: 'chromium' | 'firefox' | 'webkit';
  readonly landscape: boolean;
}

export const PROFILES: readonly Profile[] = [
  { name: 'desktop-chromium', descriptor: 'Desktop Chrome', browser: 'chromium', landscape: true },
  { name: 'desktop-firefox', descriptor: 'Desktop Firefox', browser: 'firefox', landscape: true },
  { name: 'desktop-webkit', descriptor: 'Desktop Safari', browser: 'webkit', landscape: true },
  { name: 'ipad-portrait', descriptor: 'iPad (gen 7)', browser: 'webkit', landscape: false },
  {
    name: 'ipad-landscape',
    descriptor: 'iPad (gen 7) landscape',
    browser: 'webkit',
    landscape: true,
  },
  { name: 'iphone-portrait', descriptor: 'iPhone 14', browser: 'webkit', landscape: false },
  {
    name: 'iphone-landscape',
    descriptor: 'iPhone 14 landscape',
    browser: 'webkit',
    landscape: true,
  },
];

/** The Playwright options of a profile, taken from the device registry. */
export function optionsOf(profile: Profile): PlaywrightTestOptions & PlaywrightWorkerOptions {
  return devices[profile.descriptor] as PlaywrightTestOptions & PlaywrightWorkerOptions;
}
