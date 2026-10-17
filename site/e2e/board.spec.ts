import { expect, test } from '@playwright/test';
import { HANDOFF_ID, installClock, mockHandoff, watch, openBoard } from './support/site';

const heading = (page: import('@playwright/test').Page) => page.locator('h1');

test.describe('board states from the fixtures', () => {
  test('ready with one bundle shows the three actions, the sessions and the expiry', async ({
    page,
  }) => {
    await mockHandoff(page, 'ready-one-bundle');
    await openBoard(page);
    await expect(heading(page)).toHaveText('Your boarding passes are ready');
    await expect(heading(page)).toBeFocused();
    await expect(page.getByRole('status')).toContainText(
      'Your boarding passes are ready. 4 sessions.',
    );
    await expect(page.getByRole('link', { name: 'Add to Apple Wallet' })).toHaveAttribute(
      'href',
      `/api/v1/handoffs/${HANDOFF_ID}/apple/0`,
    );
    await expect(page.getByRole('link', { name: 'Save to Google Wallet' })).toHaveAttribute(
      'href',
      /^https:\/\/pay\.google\.com\/gp\/v\/save\//,
    );
    await expect(page.getByRole('link', { name: 'Download calendar' })).toHaveAttribute(
      'href',
      `/api/v1/handoffs/${HANDOFF_ID}/calendar.ics`,
    );
    await expect(page.locator('.board-sessions li')).toHaveCount(4);
    await expect(page.getByText(/Apple Wallet is for iPhone/)).toBeVisible();
    await expect(page.getByText(/This link works for about \d+ more minutes?\./)).toBeVisible();
    await expect(page.getByText(/Times are event local time \(UTC-08:00\)\./)).toBeVisible();
  });

  test('three bundles are labelled bundle N of 3', async ({ page }) => {
    await mockHandoff(page, 'ready-three-bundles');
    await openBoard(page);
    await expect(page.getByRole('link', { name: /^Add to Apple Wallet/ })).toHaveText([
      'Add to Apple Wallet (bundle 1 of 3)',
      'Add to Apple Wallet (bundle 2 of 3)',
      'Add to Apple Wallet (bundle 3 of 3)',
    ]);
    await expect(page.locator('.board-sessions li')).toHaveCount(24);
  });

  test('Apple only shows no Google and no calendar link', async ({ page }) => {
    await mockHandoff(page, 'ready-apple-only');
    await openBoard(page);
    await expect(page.getByRole('link', { name: 'Add to Apple Wallet' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Save to Google Wallet' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Download calendar' })).toHaveCount(0);
  });

  test('404 is the expired state with one message and no retry', async ({ page }) => {
    await mockHandoff(page, 'not-found');
    await openBoard(page);
    await expect(heading(page)).toHaveText('This link has expired');
    await expect(heading(page)).toBeFocused();
    await expect(
      page.locator('.board-panel').getByText(/Create a new one on your computer/),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  });

  test('every refused or failed answer is the unavailable state and shows nothing from the body', async ({
    page,
  }) => {
    for (const name of [
      'server-error',
      'malformed',
      'wrong-bundle-path',
      'foreign-google-host',
      'no-action',
      'wrong-content-type',
    ]) {
      await page.unrouteAll();
      await mockHandoff(page, name);
      await openBoard(page);
      await expect(heading(page), name).toHaveText('We could not load your passes');
      await expect(page.getByRole('link', { name: /Wallet|calendar/ }), name).toHaveCount(0);
      await expect(page.locator('body')).not.toContainText('internal_error');
      await expect(page.locator('body')).not.toContainText('this is not json');
    }
  });
});

test.describe('retry and errors', () => {
  test('429 asks to wait, and Try again sends exactly one more request', async ({ page }) => {
    const requests = await mockHandoff(page, 'rate-limited', 'ready-one-bundle');
    await openBoard(page);
    await expect(heading(page)).toHaveText('Too many tries');
    expect(requests()).toBe(1);
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(heading(page)).toHaveText('Your boarding passes are ready');
    await expect(heading(page)).toBeFocused();
    expect(requests()).toBe(2);
  });

  test('the loading state marks the content busy and then settles', async ({ page }) => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**/api/v1/handoffs/${HANDOFF_ID}`, async (route) => {
      await gate;
      await route.fulfill({ status: 404, contentType: 'application/problem+json', body: '{}' });
    });
    await openBoard(page);
    await expect(page.locator('.board-panel')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('.board-panel').getByText('Loading your passes.')).toBeVisible();
    release();
    await expect(heading(page)).toHaveText('This link has expired');
    await expect(page.locator('.board-panel')).toHaveAttribute('aria-busy', 'false');
  });

  test('the request is one same-origin GET without credentials or a body', async ({ page }) => {
    let method = '';
    let headers: Record<string, string> = {};
    let body: string | null = 'unset';
    await page.route(`**/api/v1/handoffs/${HANDOFF_ID}`, async (route) => {
      method = route.request().method();
      headers = route.request().headers();
      body = route.request().postData();
      await route.fulfill({ status: 404, contentType: 'application/problem+json', body: '{}' });
    });
    await openBoard(page);
    await expect(heading(page)).toHaveText('This link has expired');
    expect(method).toBe('GET');
    expect(body).toBeNull();
    expect(headers['cookie']).toBeUndefined();
    expect(JSON.stringify(headers)).not.toContain(HANDOFF_ID);
  });
});

test.describe('the fragment', () => {
  for (const hash of ['', '#', '#h=short', '#x=1', `#h=${HANDOFF_ID}&x=1`, `#H=${HANDOFF_ID}`]) {
    test(`"${hash}" is an invalid link and sends no request`, async ({ page }) => {
      const record = watch(page);
      await mockHandoff(page, 'ready-one-bundle');
      await page.goto(`/board${hash}`);
      await expect(heading(page)).toHaveText('This link is not complete');
      await expect(heading(page)).toBeFocused();
      expect(record.requests.some((url) => url.includes('/api/'))).toBe(false);
    });
  }

  test('the fragment is gone from the address bar once the page has read it', async ({ page }) => {
    await mockHandoff(page, 'ready-one-bundle');
    await openBoard(page);
    await expect(heading(page)).toHaveText('Your boarding passes are ready');
    expect(page.url()).toMatch(/\/board$/);
    expect(await page.evaluate(() => location.hash)).toBe('');
  });

  test('the id is not in the title, the text or the console', async ({ page }) => {
    const record = watch(page);
    await mockHandoff(page, 'ready-three-bundles');
    await openBoard(page);
    await expect(heading(page)).toHaveText('Your boarding passes are ready');
    await expect(page).not.toHaveTitle(new RegExp(HANDOFF_ID));
    await expect(page.locator('body')).not.toContainText(HANDOFF_ID);
    expect(record.consoleMessages.join('\n')).not.toContain(HANDOFF_ID);
  });
});

test.describe('the suite does not depend on the date', () => {
  for (const day of ['2026-11-30T08:00:00-08:00', '2031-06-15T12:00:00Z']) {
    test(`a ready hand-off is ready when the page clock says ${day}`, async ({ page }) => {
      await installClock(page, day);
      await mockHandoff(page, 'ready-one-bundle');
      await openBoard(page);
      await expect(heading(page)).toHaveText('Your boarding passes are ready');
      await expect(page.getByText('This link works for about 15 more minutes.')).toBeVisible();
    });
  }
});

test.describe('local expiry', () => {
  test('the page switches to expired and removes every action when the clock reaches expiresAt', async ({
    page,
  }) => {
    await installClock(page, '2026-11-30T08:00:00-08:00');
    await mockHandoff(page, 'ready-one-bundle');
    await openBoard(page);
    await expect(heading(page)).toHaveText('Your boarding passes are ready');
    await page.clock.fastForward('16:00');
    await expect(heading(page)).toHaveText('This link has expired');
    await expect(heading(page)).toBeFocused();
    await expect(page.getByRole('link', { name: /Wallet|calendar/ })).toHaveCount(0);
  });
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('the page says it needs JavaScript to open the link', async ({ page }) => {
    await openBoard(page);
    await expect(
      page.getByText('This page needs JavaScript to open your hand-off link.'),
    ).toBeVisible();
  });
});
