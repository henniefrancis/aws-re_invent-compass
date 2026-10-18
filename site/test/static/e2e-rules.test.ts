import { devices } from '@playwright/test';
import { describe, expect, test } from 'vitest';
import { PROFILES, optionsOf } from '../../e2e/support/profiles';
import config from '../../playwright.config';
import { listFiles } from '../support/source-files';

const specs = listFiles('e2e', ['.ts']);

describe('the Device_Profiles', () => {
  test('are the seven profiles of the requirements, each a descriptor of the pinned registry', () => {
    expect(PROFILES.map((p) => p.name)).toEqual([
      'desktop-chromium',
      'desktop-firefox',
      'desktop-webkit',
      'ipad-portrait',
      'ipad-landscape',
      'iphone-portrait',
      'iphone-landscape',
    ]);
    for (const profile of PROFILES) {
      expect(Object.keys(devices), profile.descriptor).toContain(profile.descriptor);
    }
  });

  test('landscape profiles are wider than tall and portrait ones are not', () => {
    for (const profile of PROFILES) {
      const viewport = optionsOf(profile).viewport;
      expect(viewport, profile.name).toBeTruthy();
      expect((viewport?.width ?? 0) > (viewport?.height ?? 0), profile.name).toBe(
        profile.landscape,
      );
    }
  });

  test('the browsers match the profile names', () => {
    for (const profile of PROFILES) {
      expect(optionsOf(profile).defaultBrowserType, profile.name).toBe(profile.browser);
    }
  });

  test('the Playwright config has one project per profile, no retries and the Static_Server', () => {
    expect(config.projects?.map((p) => p.name)).toEqual(PROFILES.map((p) => p.name));
    expect(config.retries).toBe(0);
    expect(config.webServer).toMatchObject({ reuseExistingServer: false });
    expect(String((config.webServer as { command: string }).command)).toContain(
      'scripts/serve-static.mjs',
    );
  });
});

describe('the browser tests wait on application state only', () => {
  test('there are specs', () => {
    expect(specs.filter((s) => s.path.endsWith('.spec.ts')).length).toBeGreaterThanOrEqual(9);
  });

  test('no spec uses a sleep, a wait on a URL or a retry', () => {
    for (const file of specs) {
      expect(file.text, file.path).not.toMatch(
        /waitForTimeout|waitForURL|setTimeout\(|test\.describe\.configure\(\{[^}]*retries/,
      );
    }
  });

  test('no spec calls a deployed API or the live Events API', () => {
    for (const file of specs) {
      expect(file.text, file.path).not.toMatch(/awsevents\.com|cloudfront\.net|execute-api/);
    }
  });
});
