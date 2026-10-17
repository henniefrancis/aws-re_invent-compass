import { expect, test, type Page } from '@playwright/test';
import { PAGES, mockHandoff, watch, watchCsp, openBoard } from './support/site';

// The Static_Server sends the Required_CSP (without upgrade-insecure-requests, see
// scripts/required-csp.mjs). Every flow must run with no violation and no console error.

const DIRECTIVES = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
];

async function demoFlow(page: Page): Promise<void> {
  await page.goto('/demo');
  await page.getByRole('button', { name: 'Start with a sample week' }).click();
  await expect(page.getByRole('status')).toContainText('Sample week loaded');
  await page.getByRole('button', { name: /^Add STG487, / }).click();
  await expect(page.getByRole('heading', { name: 'STG487 was blocked' })).toBeVisible();
  await page.getByRole('button', { name: 'Start the safe swap' }).click();
  await page.getByRole('button', { name: 'Reserve the repeat' }).click();
  await page.getByRole('button', { name: 'Confirm the schedule' }).click();
  await page.getByRole('button', { name: 'Cancel the original' }).click();
  await expect(page.getByText('The swap is done.')).toBeVisible();
  await page.getByRole('button', { name: /Show sample pass for AIM321/ }).click();
  await expect(page.getByRole('img', { name: /Boarding pass for AIM321/ })).toBeVisible();
}

test.describe('under the Required_CSP', () => {
  test('every response carries the policy', async ({ page }) => {
    const response = await page.goto('/');
    const policy = response?.headers()['content-security-policy'] ?? '';
    for (const directive of DIRECTIVES) {
      expect(policy).toContain(directive);
    }
    expect(policy).not.toContain('unsafe');
    expect(response?.headers()['x-content-type-options']).toBe('nosniff');
  });

  for (const entry of PAGES) {
    test(`${entry.path} runs with no violation and no console error`, async ({ page }) => {
      const violations = await watchCsp(page);
      const record = watch(page);
      await page.goto(entry.path);
      await expect(page.locator('h1')).toHaveText(entry.h1);
      expect(await violations()).toEqual([]);
      expect(record.consoleMessages).toEqual([]);
    });
  }

  test('the demo flow from the sample week to the sample pass runs with no violation', async ({
    page,
  }) => {
    const violations = await watchCsp(page);
    const record = watch(page);
    await demoFlow(page);
    expect(await violations()).toEqual([]);
    expect(record.consoleMessages).toEqual([]);
  });

  test('the calendar download runs with no violation', async ({ page }) => {
    const violations = await watchCsp(page);
    await page.goto('/demo');
    await page.getByRole('button', { name: 'Start with a sample week' }).click();
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download sample calendar' }).click();
    await downloading;
    expect(await violations()).toEqual([]);
  });

  test('every board state runs with no violation', async ({ page }) => {
    const violations = await watchCsp(page);
    const record = watch(page);
    for (const [name, heading] of [
      ['ready-three-bundles', 'Your boarding passes are ready'],
      ['not-found', 'This link has expired'],
      ['rate-limited', 'Too many tries'],
      ['server-error', 'We could not load your passes'],
    ] as const) {
      await page.unrouteAll();
      await mockHandoff(page, name);
      await openBoard(page);
      await expect(page.locator('h1')).toHaveText(heading);
    }
    expect(await violations()).toEqual([]);
    // The browser itself logs "Failed to load resource" for the 404, 429 and 500 answers of the
    // mocked route. The site writes nothing to the console.
    expect(record.consoleMessages.filter((m) => !m.startsWith('Failed to load resource'))).toEqual(
      [],
    );
  });

  test('the install copy button runs with no violation', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'Clipboard permissions are granted for Chromium only.');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const violations = await watchCsp(page);
    await page.goto('/install');
    await page
      .getByRole('button', { name: 'Copy: npx reinvent-compass demo', exact: true })
      .click();
    await expect(page.getByRole('status')).toHaveText('Copied');
    expect(await violations()).toEqual([]);
  });
});
