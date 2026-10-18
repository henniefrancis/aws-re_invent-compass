import { expect, test, type Page } from '@playwright/test';
import { PAGES, boardPath, mockHandoff } from './support/site';

const TARGETS = 'button, a.button, .site-nav a, .brand-link, .footer-list a, .footer-list span';

async function openAll(page: Page, path: string): Promise<void> {
  if (path === boardPath) {
    await mockHandoff(page, 'ready-three-bundles');
    await page.goto(boardPath);
    await expect(page.locator('h1')).toHaveText('Your boarding passes are ready');
  } else {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
    if (path === '/demo') {
      await page.getByRole('button', { name: 'Start with a sample week' }).click();
      await expect(page.getByRole('status')).toContainText('Sample week loaded');
    }
  }
}

const ALL = [...PAGES.map((p) => p.path), boardPath];

test.describe('controls are at least 44 by 44 pixels', () => {
  for (const path of ALL) {
    test(path, async ({ page }) => {
      await openAll(page, path);
      const small = await page.evaluate((selector) => {
        return [...document.querySelectorAll<HTMLElement>(selector)]
          .filter((element) => !element.classList.contains('skip-link'))
          .map((element) => ({
            text: (element.textContent ?? '').trim().slice(0, 30),
            box: element.getBoundingClientRect(),
          }))
          .filter(
            ({ box }) => box.width > 0 && box.height > 0 && (box.width < 44 || box.height < 44),
          )
          .map(
            ({ text, box }) =>
              `${text}: ${String(Math.round(box.width))}x${String(Math.round(box.height))}`,
          );
      }, TARGETS);
      expect(small).toEqual([]);
    });
  }
});

test.describe('reflow at 320 pixels', () => {
  for (const path of ALL) {
    test(path, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 700 });
      await openAll(page, path);
      const widths = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(widths.scroll).toBeLessThanOrEqual(widths.client);
    });
  }
});

test.describe('no positioned overlays and no hidden focus', () => {
  for (const path of ALL) {
    test(path, async ({ page }) => {
      await openAll(page, path);
      const fixed = await page.evaluate(() =>
        [...document.querySelectorAll('*')]
          .filter((element) => ['fixed', 'sticky'].includes(getComputedStyle(element).position))
          .map((element) => element.tagName),
      );
      expect(fixed).toEqual([]);

      // Focus each control in turn (WebKit does not Tab to links by default) and check that
      // nothing sits on top of its centre.
      const covered = await page.evaluate(() => {
        const focusables = [
          ...document.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), [tabindex="0"]',
          ),
        ];
        const hidden: string[] = [];
        for (const element of focusables) {
          element.focus();
          element.scrollIntoView({ block: 'nearest' });
          const box = element.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) {
            continue;
          }
          const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          if (top !== null && top !== element && !element.contains(top)) {
            hidden.push((element.textContent ?? '').trim().slice(0, 30));
          }
        }
        return hidden;
      });
      expect(covered).toEqual([]);
    });
  }
});

test.describe('the board page on a phone', () => {
  test('shows its first action in the first viewport', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'iphone-portrait',
      'The first viewport rule is for iPhone portrait.',
    );
    await mockHandoff(page, 'ready-three-bundles');
    await page.goto(boardPath);
    const first = page.getByRole('link', { name: /^Add to Apple Wallet/ }).first();
    await expect(first).toBeVisible();
    const box = await first.boundingBox();
    const height = page.viewportSize()?.height ?? 0;
    expect(box).not.toBeNull();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(height);
  });
});
