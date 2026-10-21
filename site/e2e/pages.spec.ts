import { expect, test } from '@playwright/test';
import { NOTICE, PAGES, boardPath, mockHandoff, openNav } from './support/site';

test.describe('every page', () => {
  for (const page of PAGES) {
    test(`${page.path} has one heading, a title and the footer`, async ({ page: browser }) => {
      await browser.goto(page.path);
      await expect(browser.locator('h1')).toHaveCount(1);
      await expect(browser.locator('h1')).toHaveText(page.h1);
      await expect(browser).toHaveTitle(page.title);
      await expect(browser.locator('main')).toHaveCount(1);
      await expect(browser.locator('footer .notice')).toHaveText(NOTICE);
      await expect(browser.locator('footer .footer-list li')).toHaveText([
        'Repository',
        'Builder Center post (coming soon)',
        'Video (coming soon)',
        'Install',
        'Privacy',
      ]);
      await expect(browser.locator('html')).toHaveAttribute('lang', 'en');
    });
  }

  test('/board has one heading, a title and the same footer', async ({ page }) => {
    await mockHandoff(page, 'ready-one-bundle');
    await page.goto(boardPath);
    await expect(page.locator('h1')).toHaveText('Your boarding passes are ready');
    await expect(page).toHaveTitle('Board | re:Invent Compass');
    await expect(page.locator('footer .notice')).toHaveText(NOTICE);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  });

  test('the footer links to the repository and never to an unknown address', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('footer a[href^="https://"]')).toHaveCount(1);
    await expect(page.locator('footer a[href^="https://github.com/henniefrancis/"]')).toHaveText(
      'Repository',
    );
  });
});

test.describe('navigation', () => {
  test('moves focus to the page heading and sets the title', async ({ page }) => {
    await page.goto('/');
    await openNav(page, 'Product');
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: /^Install/ })
      .click();
    await expect(page.locator('h1')).toHaveText('Install');
    await expect(page.locator('h1')).toBeFocused();
    await expect(page).toHaveTitle('Install | re:Invent Compass');
  });

  test('the home page offers the demo and the install guide as its two actions', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('main').getByRole('link', { name: 'Try the demo' }).click();
    await expect(page.locator('h1')).toHaveText('Demo');
    await expect(page.locator('h1')).toBeFocused();
  });

  test('the skip link is the first focusable element and jumps to the main content', async ({
    page,
  }) => {
    await page.goto('/privacy');
    // WebKit does not Tab to links by default, so the first focusable element is found in the
    // DOM, then focused, then activated with the keyboard.
    const first = await page.evaluate(
      () =>
        document.querySelector(
          'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
        )?.textContent,
    );
    expect(first).toBe('Skip to main content');
    await page.getByRole('link', { name: 'Skip to main content' }).focus();
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
  });

  test('the install page copies a command and announces it', async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'Clipboard permissions are granted for Chromium only.');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/install');
    await page.getByRole('button', { name: 'Copy: npx reinvent-compass', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('npx reinvent-compass');
  });
});
