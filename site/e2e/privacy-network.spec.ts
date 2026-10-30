import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { HANDOFF_ID, PAGES, mockHandoff, watch, type Watch, openBoard } from './support/site';

async function expectNothingStored(page: Page, context: BrowserContext): Promise<void> {
  expect(await context.cookies()).toEqual([]);
  const stored = await page.evaluate(async () => ({
    local: localStorage.length,
    session: sessionStorage.length,
    databases: 'databases' in indexedDB ? (await indexedDB.databases()).length : 0,
    caches: 'caches' in window ? (await caches.keys()).length : 0,
    workers:
      'serviceWorker' in navigator ? (await navigator.serviceWorker.getRegistrations()).length : 0,
    cookie: document.cookie,
  }));
  expect(stored).toEqual({ local: 0, session: 0, databases: 0, caches: 0, workers: 0, cookie: '' });
}

function expectSameOrigin(record: Watch, baseURL: string | undefined): void {
  const origin = new URL(baseURL ?? '').origin;
  for (const url of record.requests) {
    expect(new URL(url).origin, url).toBe(origin);
  }
}

test.describe('the site collects nothing and talks only to itself', () => {
  for (const entry of PAGES) {
    test(`${entry.path}`, async ({ page, context, baseURL }) => {
      const record = watch(page);
      await page.goto(entry.path);
      await expect(page.locator('h1')).toHaveText(entry.h1);
      expectSameOrigin(record, baseURL);
      expect(record.requests.some((url) => url.includes('/api/'))).toBe(false);
      await expectNothingStored(page, context);
    });
  }

  test('the demo flow', async ({ page, context, baseURL }) => {
    const record = watch(page);
    await page.goto('/demo');
    await page.getByRole('button', { name: 'Start with a sample week' }).click();
    await expect(page.getByRole('status')).toContainText('Sample week loaded');
    await page.getByRole('button', { name: /^Add ARC228, / }).click();
    await expect(page.getByRole('heading', { name: 'ARC228 was blocked' })).toBeVisible();
    const requestsBefore = record.requests.length;
    await page.getByRole('button', { name: 'Start the safe swap' }).click();
    await page.getByRole('button', { name: 'Reserve the repeat' }).click();
    await expect(page.getByRole('status')).toContainText('Step 1 of 3 done');
    // Once loaded, the demo needs no further request.
    expect(record.requests.length).toBe(requestsBefore);
    expectSameOrigin(record, baseURL);
    await expectNothingStored(page, context);
  });

  test('the board page sends the id only in the hand-off route path and never logs it', async ({
    page,
    context,
    baseURL,
  }) => {
    const record = watch(page);
    await mockHandoff(page, 'ready-many-sessions');
    await openBoard(page);
    await expect(page.locator('h1')).toHaveText('Your boarding passes are ready');
    expectSameOrigin(record, baseURL);
    const withId = record.requests.filter((url) => url.includes(HANDOFF_ID));
    expect(withId).toHaveLength(1);
    expect(new URL(withId[0] as string).pathname).toBe(`/api/v1/handoffs/${HANDOFF_ID}`);
    expect(new URL(withId[0] as string).search).toBe('');
    expect(record.consoleMessages.join('\n')).not.toContain(HANDOFF_ID);
    expect(await page.title()).not.toContain(HANDOFF_ID);
    expect(page.url()).not.toContain(HANDOFF_ID);
    await expectNothingStored(page, context);
  });

  test('an invalid link and an expired one store nothing and send nothing else', async ({
    page,
    context,
    baseURL,
  }) => {
    const record = watch(page);
    await mockHandoff(page, 'not-found');
    await openBoard(page);
    await expect(page.locator('h1')).toHaveText('This link has expired');
    await openBoard(page, '#h=short');
    await expect(page.locator('h1')).toHaveText('This link is not complete');
    expectSameOrigin(record, baseURL);
    await expectNothingStored(page, context);
  });
});
