import { readFileSync } from 'node:fs';
import ICAL from 'ical.js';
import { expect, test, type Page } from '@playwright/test';

const status = (page: Page) => page.getByRole('status');
const addButton = (page: Page, code: string) =>
  page.getByRole('button', { name: new RegExp(`^Add ${code}, `) });

async function loadSample(page: Page): Promise<void> {
  await page.goto('/demo');
  await expect(page.getByText(/These sessions are made up/)).toBeVisible();
  await page.getByRole('button', { name: 'Start with a sample week' }).click();
  await expect(status(page)).toContainText('Sample week loaded: 5 sessions. Try adding STG487');
}

test.describe('the demo', () => {
  test('lists the made-up sessions by day with the boarding time and no real schedule', async ({
    page,
  }) => {
    await page.goto('/demo');
    await expect(page.getByRole('heading', { level: 3, name: 'Tuesday 1 December' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Friday 4 December' })).toBeVisible();
    await expect(page.getByText(/Nothing in this demo touches a real schedule/)).toBeVisible();
    await expect(
      page.getByText(/All times are in America\/Los_Angeles \(UTC-08:00\)\./),
    ).toBeVisible();
    await expect(page.locator('.catalog-item')).toHaveCount(15);
    await expect(page.getByText('Seat released at 11:20 AM').first()).toBeVisible();
    await expect(page.getByText('Venue not published').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download sample calendar' })).toBeDisabled();
    await expect(page.getByText('Add a session first.')).toBeVisible();
  });

  test('the guided clash: blocked with reasons, safe swap in three steps, then add the blocked session', async ({
    page,
  }) => {
    await loadSample(page);
    await addButton(page, 'STG487').click();
    await expect(status(page)).toContainText('Blocked: STG487 was not added.');
    const panel = page.locator('.verdict').first();
    await expect(panel.getByRole('heading', { name: 'STG487 was blocked' })).toBeVisible();
    await expect(panel.locator('li').first()).toContainText('overlap');
    await expect(panel.getByText('Safe swap: move ANT163 to its repeat ANT163-R.')).toBeVisible();
    await expect(page.locator('section[aria-labelledby="day-2026-12-04"]')).not.toContainText(
      'STG487',
    );

    await panel.getByRole('button', { name: 'Start the safe swap' }).click();
    await expect(status(page)).toContainText('Step 1 of 3');
    await page.getByRole('button', { name: 'Reserve the repeat' }).click();
    await expect(status(page)).toContainText('Step 1 of 3 done: ANT163-R is reserved (simulated).');
    await page.getByRole('button', { name: 'Confirm the schedule' }).click();
    await expect(status(page)).toContainText('Step 2 of 3 done');
    await page.getByRole('button', { name: 'Cancel the original' }).click();
    await expect(status(page)).toContainText('Step 3 of 3 done: ANT163 is cancelled (simulated).');
    await expect(page.locator('section[aria-labelledby="day-2026-12-01"]')).toContainText(
      'ANT163-R',
    );
    await expect(page.locator('section[aria-labelledby="day-2026-12-04"]')).not.toContainText(
      'ANT163',
    );

    await page.getByRole('button', { name: 'Add STG487' }).first().click();
    await expect(status(page)).toContainText('STG487');
  });

  test('shows the sample pass as an image with every field in its name, and no barcode', async ({
    page,
  }) => {
    await loadSample(page);
    await page.getByRole('button', { name: /Show sample pass for AIM321/ }).click();
    const pass = page.getByRole('img', { name: /Boarding pass for AIM321/ });
    await expect(pass).toBeVisible();
    const name = (await pass.getAttribute('aria-label')) ?? '';
    for (const part of [
      'Gate: MGM Grand',
      'Seat released at 11:20 AM',
      'Sample pass. Made-up session.',
      'Unofficial. Your badge is your ticket.',
    ]) {
      expect(name).toContain(part);
    }
    await expect(
      pass.locator('text', { hasText: 'Unofficial. Your badge is your ticket.' }),
    ).toBeVisible();
    await expect(page.locator('svg.pass image, svg.pass foreignObject')).toHaveCount(0);
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
    expect(events).toHaveLength(5);
    expect(text).toContain('PRODID:-//re:Invent Compass//Showcase demo//EN');
    expect(text).toContain('.invalid');
  });

  test('Start over empties the week', async ({ page }) => {
    await loadSample(page);
    await page.getByRole('button', { name: 'Start over' }).click();
    await expect(page.getByText('Nothing here yet.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download sample calendar' })).toBeDisabled();
  });

  test('adding a session that fits adds it, and Remove takes it out', async ({ page }) => {
    await page.goto('/demo');
    await addButton(page, 'DAT204').click();
    await expect(status(page)).toContainText('DAT204 was added to your week');
    await expect(page.locator('section[aria-labelledby="day-2026-12-01"]')).toContainText('DAT204');
    await page.getByRole('button', { name: /^Remove DAT204/ }).click();
    await expect(page.getByText('Nothing here yet.')).toBeVisible();
  });
});
