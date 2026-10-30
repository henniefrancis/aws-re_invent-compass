import { readFileSync } from 'node:fs';
import ICAL from 'ical.js';
import { expect, test, type Page } from '@playwright/test';

const status = (page: Page) => page.getByRole('status');
const addButton = (page: Page, code: string) =>
  page.getByRole('button', { name: new RegExp(`^Add ${code}, `) });

async function loadSample(page: Page): Promise<void> {
  await page.goto('/demo');
  await expect(page.getByText(/These are real re:Invent 2026 sessions/)).toBeVisible();
  await expect(
    page.getByText('Session data: AWS Events API, catalog as of 29 October 2026.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Start with a sample week' }).click();
  await expect(status(page)).toContainText('Sample week loaded: 2 sessions. Try adding CMP340');
}

test.describe('the demo', () => {
  test('lists the real sessions by day with the boarding time and no real schedule', async ({
    page,
  }) => {
    await page.goto('/demo');
    for (const heading of [
      'Monday 30 November',
      'Tuesday 1 December',
      'Wednesday 2 December',
      'Thursday 3 December',
    ]) {
      await expect(page.getByRole('heading', { level: 3, name: heading })).toBeVisible();
    }
    await expect(page.getByText(/Nothing in this demo touches a real schedule/)).toBeVisible();
    await expect(
      page.getByText(/All times are in America\/Los_Angeles \(UTC-08:00\)\./),
    ).toBeVisible();
    await expect(page.locator('.catalog-item')).toHaveCount(17);
    await expect(page.getByText('Seat released at 11:20 AM').first()).toBeVisible();
    await expect(page.getByText('Venue not published').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download sample calendar' })).toBeDisabled();
    await expect(page.getByText('Add a session first.')).toBeVisible();
  });

  test('the guided clash: blocked with reasons, safe swap in three steps, then add the blocked session', async ({
    page,
  }) => {
    await loadSample(page);
    await addButton(page, 'CMP340').click();
    await expect(status(page)).toContainText('Blocked: CMP340 was not added.');
    const panel = page.locator('.verdict').first();
    await expect(panel.getByRole('heading', { name: 'CMP340 was blocked' })).toBeVisible();
    await expect(panel.locator('li').first()).toContainText('overlap');
    await expect(
      panel.getByText('Safe swap: move TNC334-R to its repeat TNC334-R1.'),
    ).toBeVisible();
    await expect(page.locator('section[aria-labelledby="day-2026-11-30"]')).not.toContainText(
      'CMP340',
    );

    await panel.getByRole('button', { name: 'Start the safe swap' }).click();
    await expect(status(page)).toContainText('Step 1 of 3');
    await page.getByRole('button', { name: 'Reserve the repeat' }).click();
    await expect(status(page)).toContainText(
      'Step 1 of 3 done: TNC334-R1 is reserved (simulated).',
    );
    await page.getByRole('button', { name: 'Confirm the schedule' }).click();
    await expect(status(page)).toContainText('Step 2 of 3 done');
    await page.getByRole('button', { name: 'Cancel the original' }).click();
    await expect(status(page)).toContainText(
      'Step 3 of 3 done: TNC334-R is cancelled (simulated).',
    );
    await expect(page.locator('section[aria-labelledby="day-2026-12-03"]')).toContainText(
      'TNC334-R1',
    );
    await expect(page.locator('section[aria-labelledby="day-2026-11-30"]')).toHaveCount(0);

    await page.getByRole('button', { name: 'Add CMP340' }).first().click();
    await expect(status(page)).toContainText('CMP340');
  });

  test('shows the sample pass as an image with every field in its name, and no barcode', async ({
    page,
  }) => {
    await loadSample(page);
    await page.getByRole('button', { name: /Show sample pass for TNC334-R/ }).click();
    const pass = page.getByRole('img', { name: /Boarding pass. Session TNC334-R./ });
    await expect(pass).toBeVisible();
    const name = (await pass.getAttribute('aria-label')) ?? '';
    for (const part of [
      'Terminal: Caesars Palace',
      'Boarding closes: 12:50',
      'Sample pass. Not a real booking.',
      'Unofficial. Your badge is your ticket.',
    ]) {
      expect(name).toContain(part);
    }
    await expect(
      pass.locator('text', { hasText: 'Unofficial. Your badge is your ticket.' }),
    ).toBeVisible();
    // The only image on the pass is the owner's logo (task 21); nothing is embedded as HTML.
    await expect(page.locator('svg.pass foreignObject')).toHaveCount(0);
    await expect(page.locator('svg.pass image')).toHaveCount(1);
    await expect(page.locator('svg.pass image')).toHaveAttribute('href', 'artwork/logo.svg');
  });

  test('downloads a calendar that ical.js can read, with one event per commitment', async ({
    page,
  }) => {
    await loadSample(page);
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download sample calendar' }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe('compass-demo-week.ics');
    const path = await download.path();
    const text = readFileSync(path, 'utf8');
    const events = new ICAL.Component(ICAL.parse(text) as unknown[]).getAllSubcomponents('vevent');
    expect(events).toHaveLength(2);
    expect(text).toContain('PRODID:-//re:Invent Compass//Showcase demo//EN');
    expect(text).toContain('.invalid');
  });

  test('focus follows the action when the focused control is removed (QA M1)', async ({ page }) => {
    await loadSample(page);
    await addButton(page, 'CMP340').click();
    await expect(page.getByRole('heading', { name: 'CMP340 was blocked' })).toBeVisible();

    // Start the safe swap: the verdict panel is replaced by the swap panel.
    await page.getByRole('button', { name: 'Start the safe swap' }).click();
    await expect(page.getByRole('heading', { name: 'Safe swap' })).toBeFocused();
    // Each step button is replaced by the next one, and focus follows.
    await page.getByRole('button', { name: 'Reserve the repeat' }).click();
    await expect(page.getByRole('button', { name: 'Confirm the schedule' })).toBeFocused();
    await page.getByRole('button', { name: 'Confirm the schedule' }).click();
    await expect(page.getByRole('button', { name: 'Cancel the original' })).toBeFocused();
    await page.getByRole('button', { name: 'Cancel the original' }).click();
    await expect(page.getByRole('button', { name: 'Add CMP340' }).first()).toBeFocused();

    // Close the finished swap panel: focus goes to "Your week".
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('heading', { name: 'Your week' })).toBeFocused();

    // Remove an item: focus goes to the Remove button of the item that follows it.
    const removeButtons = page.getByRole('button', { name: /^Remove / });
    const names = await removeButtons.allTextContents();
    await removeButtons.first().click();
    await expect(page.getByRole('button', { name: /^Remove / }).first()).toBeFocused();
    await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(names.length - 1);
  });

  test('Keep my week closes the verdict and focuses the week heading', async ({ page }) => {
    await loadSample(page);
    await addButton(page, 'CMP340').click();
    await page.getByRole('button', { name: 'Keep my week' }).click();
    await expect(page.getByRole('heading', { name: 'Your week' })).toBeFocused();
  });

  test('every item in the week has its own accessible name', async ({ page }) => {
    await loadSample(page);
    await addButton(page, 'CMP340').click();
    await page.getByRole('button', { name: 'Start the safe swap' }).click();
    await page.getByRole('button', { name: 'Reserve the repeat' }).click();
    await page.getByRole('button', { name: 'Confirm the schedule' }).click();
    await page.getByRole('button', { name: 'Cancel the original' }).click();
    await page.getByRole('button', { name: 'Add CMP340' }).first().click();
    const names = await page.getByRole('button', { name: /^Remove / }).allTextContents();
    expect(names.length).toBe(3);
    expect(new Set(names).size).toBe(names.length);
  });

  test('a warning can be confirmed, and the suggested layover can be added to the week', async ({
    page,
  }) => {
    await page.goto('/demo');
    await addButton(page, 'ACT053').click();
    await expect(status(page)).toContainText('ACT053');
    await page.getByRole('button', { name: 'Add anyway' }).click();
    await addButton(page, 'SEC318-R').click();
    await expect(page.locator('.verdict').first()).toContainText(
      'could not be judged because data was missing',
    );
    await page.getByRole('button', { name: 'Add anyway' }).click();
    const layover = page.getByRole('button', { name: /^Add this layover/ });
    await expect(layover).toBeVisible();
    await layover.click();
    await expect(page.getByRole('heading', { name: 'Your week' })).toBeFocused();
    const names = await page.getByRole('button', { name: /^Remove / }).allTextContents();
    expect(names.some((n) => n.includes('Layover at'))).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  test('Start over empties the week', async ({ page }) => {
    await loadSample(page);
    await page.getByRole('button', { name: 'Start over' }).click();
    await expect(page.getByText('Nothing here yet.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download sample calendar' })).toBeDisabled();
  });

  test('adding a session that fits adds it, and Remove takes it out', async ({ page }) => {
    await page.goto('/demo');
    await addButton(page, 'AIM433').click();
    await expect(status(page)).toContainText('AIM433 was added to your week');
    await expect(page.locator('section[aria-labelledby="day-2026-11-30"]')).toContainText('AIM433');
    await page.getByRole('button', { name: /^Remove AIM433/ }).click();
    await expect(page.getByText('Nothing here yet.')).toBeVisible();
  });
});
