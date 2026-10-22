// Feature: showcase-site, task 32 (Requirement 28): the Terms, Accessibility, Security and
// Credits pages say only what is true, and the credits cannot drift from the installed packages.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { SITE_LINKS, issuesUrl, securityPolicyUrl } from '../../src/lib/content/links';
import {
  CREDITS,
  CREDITS_INTRO,
  TERMS_BLOCKS,
  TERMS_UPDATED,
} from '../../src/lib/content/more-legal';
import { SITE_ROOT } from '../support/source-files';

/** The installed package.json of a dependency, from the site or the repository root. */
function installed(pkg: string): { license?: unknown } {
  for (const root of [SITE_ROOT, join(SITE_ROOT, '..')]) {
    const file = join(root, 'node_modules', pkg, 'package.json');
    if (existsSync(file)) {
      return JSON.parse(readFileSync(file, 'utf8')) as { license?: unknown };
    }
  }
  throw new Error(`${pkg} is not installed`);
}

describe('the more legal pages', () => {
  test('every credited licence is the licence of the installed package', () => {
    expect(CREDITS.length).toBeGreaterThanOrEqual(10);
    for (const credit of CREDITS) {
      expect(installed(credit.pkg).license, credit.pkg).toBe(credit.licence);
      expect(credit.use.length, credit.pkg).toBeGreaterThan(0);
    }
    expect(new Set(CREDITS.map((c) => c.pkg)).size).toBe(CREDITS.length);
    expect(CREDITS_INTRO).toContain('licences');
  });

  test('the terms say as is, no seat guarantee, the badge is the ticket and 15 minutes', () => {
    const text = TERMS_BLOCKS.map((b) => b.text).join(' ');
    for (const phrase of [
      '"as is"',
      'does not guarantee a seat',
      'badge is your ticket',
      '15 minutes',
    ]) {
      expect(text).toContain(phrase);
    }
    expect(TERMS_UPDATED).toBe('Last updated 22 October 2026.');
  });

  test('the issue tracker and the security policy are inside the repository', () => {
    expect(issuesUrl(SITE_LINKS)).toBe(`${SITE_LINKS.repository}/issues`);
    expect(securityPolicyUrl(SITE_LINKS)).toBe(`${SITE_LINKS.repository}/blob/main/SECURITY.md`);
  });
});
