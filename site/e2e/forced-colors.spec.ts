import { expect, test } from '@playwright/test';
import { PAGES, boardPath, expectNoAxeViolations, mockHandoff } from './support/site';

// Forced colors are emulated in Chromium only.
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Forced colors run in Chromium only.');
  await page.emulateMedia({ forcedColors: 'active' });
});

test.describe('forced colors', () => {
  test('buttons, links and the focus ring stay visible with system colours', async ({ page }) => {
    await page.goto('/install');
    await expect(page.locator('h1')).toBeVisible();
    expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true);

    const button = page.getByRole('button', { name: 'Copy: npx reinvent-compass', exact: true });
    const borders = await button.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        width: style.borderTopWidth,
        style: style.borderTopStyle,
        colour: style.borderTopColor,
      };
    });
    expect(borders.style).toBe('solid');
    expect(borders.width).toBe('2px');
    expect(borders.colour).not.toBe('rgba(0, 0, 0, 0)');

    await button.focus();
    const ring = await button.evaluate((element) => {
      const style = getComputedStyle(element);
      return { width: style.outlineWidth, style: style.outlineStyle, colour: style.outlineColor };
    });
    expect(ring.style).toBe('solid');
    expect(ring.width).toBe('3px');
    expect(ring.colour).not.toBe('rgba(0, 0, 0, 0)');

    const cardBorder = await page
      .locator('.command code')
      .first()
      .evaluate((element) => getComputedStyle(element).borderTopStyle);
    expect(cardBorder).toBe('solid');
  });

  for (const entry of PAGES) {
    test(`${entry.path} still has no axe violation`, async ({ page }) => {
      await page.goto(entry.path);
      await expect(page.locator('h1')).toHaveText(entry.h1);
      await expectNoAxeViolations(page);
    });
  }

  test('the board page and the demo keep their controls visible', async ({ page }) => {
    await mockHandoff(page, 'ready-one-bundle');
    await page.goto(boardPath);
    await expect(
      page.getByRole('link', { name: 'Add to Apple Wallet', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Add to Apple Wallet: ANT398' })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.goto('/demo');
    await page.getByRole('button', { name: 'Start with a sample week' }).click();
    await expect(page.getByRole('status')).toContainText('Sample week loaded');
    await expectNoAxeViolations(page);
  });
});
