import { expect, test, type Page } from '@playwright/test';
import { PAGES, boardPath, expectNoAxeViolations, mockHandoff } from './support/site';

const addButton = (page: Page, code: string) =>
  page.getByRole('button', { name: new RegExp(`^Add ${code}, `) });

test.describe('axe on every page', () => {
  for (const entry of PAGES) {
    test(`${entry.path} has no WCAG 2.2 A or AA violation`, async ({ page }) => {
      await page.goto(entry.path);
      await expect(page.locator('h1')).toHaveText(entry.h1);
      await expectNoAxeViolations(page);
    });
  }
});

test.describe('axe on every board state', () => {
  const states: [string, string, string][] = [
    ['ready-one-bundle', 'ready', 'Your boarding passes are ready'],
    ['ready-three-bundles', 'ready', 'Your boarding passes are ready'],
    ['ready-apple-only', 'ready', 'Your boarding passes are ready'],
    ['not-found', 'expired', 'This link has expired'],
    ['rate-limited', 'rate limited', 'Too many tries'],
    ['server-error', 'unavailable', 'We could not load your passes'],
  ];
  for (const [fixtureName, label, heading] of states) {
    test(`board ${label} (${fixtureName})`, async ({ page }) => {
      await mockHandoff(page, fixtureName);
      await page.goto(boardPath);
      await expect(page.locator('h1')).toHaveText(heading);
      await expectNoAxeViolations(page);
    });
  }

  test('board invalid link', async ({ page }) => {
    await page.goto('/board#h=short');
    await expect(page.locator('h1')).toHaveText('This link is not complete');
    await expectNoAxeViolations(page);
  });

  test('board loading', async ({ page }) => {
    await page.route('**/api/v1/handoffs/**', () => new Promise(() => undefined));
    await page.goto(boardPath);
    await expect(page.locator('.board-panel')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('.board-panel').getByText('Loading your passes.')).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('axe on the demo states', () => {
  test('sample week, blocked clash, swap steps, sample pass', async ({ page }) => {
    // Six axe runs in one test: allow for a loaded machine.
    test.slow();
    await page.goto('/demo');
    await expectNoAxeViolations(page);

    await page.getByRole('button', { name: 'Start with a sample week' }).click();
    await expect(page.getByRole('status')).toContainText('Sample week loaded');
    await expectNoAxeViolations(page);

    await addButton(page, 'STG487').click();
    await expect(page.getByRole('heading', { name: 'STG487 was blocked' })).toBeVisible();
    await expectNoAxeViolations(page);

    await page.getByRole('button', { name: 'Start the safe swap' }).click();
    await expect(page.getByRole('heading', { name: 'Safe swap' })).toBeVisible();
    await expectNoAxeViolations(page);

    await page.getByRole('button', { name: 'Reserve the repeat' }).click();
    await page.getByRole('button', { name: 'Confirm the schedule' }).click();
    await page.getByRole('button', { name: 'Cancel the original' }).click();
    await expect(page.getByText('The swap is done.')).toBeVisible();
    await expectNoAxeViolations(page);

    await page.getByRole('button', { name: /Show sample pass for AIM321/ }).click();
    await expect(page.getByRole('img', { name: /Boarding pass for AIM321/ })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('a warning', async ({ page }) => {
    await page.goto('/demo');
    await page.getByRole('button', { name: 'Start with a sample week' }).click();
    await addButton(page, 'AIM147').click();
    await expect(page.getByRole('status')).toContainText('AIM147');
    await expectNoAxeViolations(page);
  });
});
