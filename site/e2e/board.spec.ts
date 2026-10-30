import { expect, test } from '@playwright/test';
import { HANDOFF_ID, installClock, mockHandoff, openBoard, openNav, watch } from './support/site';

const heading = (page: import('@playwright/test').Page) => page.locator('h1');

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

test.describe('board states from the fixtures', () => {
  // These tests look for every wallet, so they present as a computer on every profile.
  test.use({ userAgent: DESKTOP_UA });

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
    await expect(
      page.getByRole('link', { name: 'Add to Apple Wallet', exact: true }),
    ).toHaveAttribute('href', `/api/v1/handoffs/${HANDOFF_ID}/apple/0`);
    await expect(
      page.getByRole('link', { name: 'Add to Google Wallet', exact: true }),
    ).toHaveAttribute('href', /^https:\/\/pay\.google\.com\/gp\/v\/save\//);
    await expect(page.getByRole('link', { name: 'Add to Calendar', exact: true })).toHaveAttribute(
      'href',
      `/api/v1/handoffs/${HANDOFF_ID}/calendar.ics`,
    );
    await expect(page.locator('.board-sessions > li')).toHaveCount(4);
    await expect(page.getByText(/Apple Wallet is for iPhone/)).toBeVisible();
    await expect(page.getByText(/This link works for about \d+ more minutes?\./)).toBeVisible();
    await expect(page.getByText(/Times are event local time \(UTC-08:00\)\./)).toBeVisible();
  });

  test('eight sessions or fewer show only the top actions, none on the sessions', async ({
    page,
  }) => {
    await mockHandoff(page, 'ready-one-bundle');
    await openBoard(page);
    await expect(page.getByText('Choose how to add your passes.')).toBeVisible();
    await expect(page.locator('.board-actions a')).toHaveCount(3);
    await expect(page.locator('.board-session-actions')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /^Add to .*: [A-Z0-9]+$/ })).toHaveCount(0);
    await expect(page.locator('.board-sessions > li')).toHaveCount(4);
  });

  test('more than eight sessions show only the week calendar at the top and every button on each session', async ({
    page,
  }) => {
    await mockHandoff(page, 'ready-many-sessions');
    await openBoard(page);
    await expect(
      page.getByText('Add each session below, or the whole week to your calendar.'),
    ).toBeVisible();
    await expect(page.locator('.board-actions a')).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Add to Calendar', exact: true })).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Add to Apple Wallet', exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByRole('link', { name: 'Add to Google Wallet', exact: true })).toHaveCount(
      0,
    );
    const first = page.locator('.board-sessions > li').first();
    await expect(first.getByRole('link')).toHaveCount(2);
    await expect(first.getByRole('link', { name: 'Add to Apple Wallet: ANT398' })).toHaveAttribute(
      'href',
      `/api/v1/handoffs/${HANDOFF_ID}/apple/pass/00000000-0000-4000-8000-000000000001`,
    );
    await expect(first.getByRole('link', { name: 'Add to Google Wallet: ANT398' })).toHaveAttribute(
      'href',
      /^https:\/\/pay\.google\.com\/gp\/v\/save\//,
    );
    await expect(page.locator('.board-session-actions a')).toHaveCount(48);
    await expect(page.locator('.board-sessions > li')).toHaveCount(24);
  });

  test('Apple only shows no Google and no calendar link', async ({ page }) => {
    await mockHandoff(page, 'ready-apple-only');
    await openBoard(page);
    await expect(
      page.getByRole('link', { name: 'Add to Apple Wallet', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Add to Google Wallet', exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByRole('link', { name: 'Add to Calendar', exact: true })).toHaveCount(0);
    await expect(page.locator('.board-session-actions')).toHaveCount(0);
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
    await mockHandoff(page, 'ready-many-sessions');
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

test.describe('history (security L-3)', () => {
  test('Back and Forward never bring the fragment back', async ({ page }) => {
    await mockHandoff(page, 'ready-one-bundle');
    await openBoard(page);
    await expect(heading(page)).toHaveText('Your boarding passes are ready');
    expect(page.url()).not.toContain('#');
    await openNav(page, 'Product');
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: /^Install/ })
      .click();
    await expect(heading(page)).toHaveText('Install');
    await page.goBack();
    await expect(heading(page)).toBeVisible();
    expect(page.url()).not.toContain('#');
    expect(page.url()).not.toContain(HANDOFF_ID);
    await page.goForward();
    await expect(heading(page)).toHaveText('Install');
    expect(page.url()).not.toContain('#');
    const entries = await page.evaluate(() => history.length);
    expect(entries).toBeGreaterThan(0);
  });

  test('the address has no fragment from the first moment the page runs', async ({ page }) => {
    await page.addInitScript(() => {
      const seen: string[] = [];
      (window as unknown as { __urls: string[] }).__urls = seen;
      const original = history.replaceState.bind(history);
      history.replaceState = (state: unknown, unused: string, url?: string | URL | null) => {
        seen.push(String(url));
        original(state, unused, url);
      };
      const originalPush = history.pushState.bind(history);
      history.pushState = (state: unknown, unused: string, url?: string | URL | null) => {
        seen.push(String(url));
        originalPush(state, unused, url);
      };
    });
    await mockHandoff(page, 'ready-one-bundle');
    await openBoard(page);
    await expect(heading(page)).toHaveText('Your boarding passes are ready');
    const urls = await page.evaluate(() => (window as unknown as { __urls: string[] }).__urls);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).not.toContain('#');
    }
  });
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

test.describe('waking up', () => {
  test('a page that slept past expiresAt is expired when it is shown again', async ({ page }) => {
    await installClock(page, '2026-11-30T08:00:00-08:00');
    await mockHandoff(page, 'ready-one-bundle');
    await openBoard(page);
    await expect(heading(page)).toHaveText('Your boarding passes are ready');
    // The clock jumps past expiresAt without any timer firing, as when a phone sleeps.
    await page.clock.setSystemTime(new Date('2026-11-30T08:20:00-08:00'));
    await page.evaluate(() => {
      window.dispatchEvent(new Event('pageshow'));
    });
    await expect(heading(page)).toHaveText('This link has expired');
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

test.describe('the wallet of the device (task 37)', () => {
  const apple = (page: import('@playwright/test').Page) =>
    page.getByRole('link', { name: /^Add to Apple Wallet/ });
  const google = (page: import('@playwright/test').Page) =>
    page.getByRole('link', { name: /^Add to Google Wallet/ });
  const calendar = (page: import('@playwright/test').Page) =>
    page.getByRole('link', { name: /^Add to Calendar/ });

  test.describe('on an iPhone', () => {
    test.use({ userAgent: IPHONE_UA });

    test('only Apple Wallet and the calendar show, and the device line is in the lead line', async ({
      page,
    }) => {
      await mockHandoff(page, 'ready-one-bundle');
      await openBoard(page);
      await expect(
        page.getByText('Choose how to add your passes. Showing Apple Wallet for your iPhone.'),
      ).toBeVisible();
      await expect(page.getByText(/Apple Wallet is for iPhone/)).toHaveCount(0);
      await expect(apple(page)).toHaveCount(1);
      await expect(calendar(page)).toHaveCount(1);
      await expect(google(page)).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Show all wallets' })).toHaveCount(0);
    });

    test('the session buttons follow the same rule', async ({ page }) => {
      await mockHandoff(page, 'ready-many-sessions');
      await openBoard(page);
      await expect(page.getByRole('link', { name: /^Add to Google Wallet: / })).toHaveCount(0);
      await expect(page.getByRole('link', { name: /^Add to Apple Wallet: / })).toHaveCount(24);
      await expect(page.getByRole('link', { name: /^Add to Calendar: / })).toHaveCount(0);
    });
  });

  test.describe('on an Android phone', () => {
    test.use({ userAgent: ANDROID_UA });

    test('only Google Wallet and the calendar show', async ({ page, browserName }) => {
      // Chromium keeps reporting its real client hints under a replaced user agent.
      test.skip(browserName === 'chromium', 'Client hints cannot be replaced in Chromium.');
      await mockHandoff(page, 'ready-one-bundle');
      await openBoard(page);
      await expect(
        page.getByText(
          'Choose how to add your passes. Showing Google Wallet for your Android phone.',
        ),
      ).toBeVisible();
      await expect(google(page)).toHaveCount(1);
      await expect(calendar(page)).toHaveCount(1);
      await expect(apple(page)).toHaveCount(0);
    });
  });

  test.describe('on a computer or anything else', () => {
    test.use({ userAgent: DESKTOP_UA });

    test('everything shows, in one row, with the help paragraph apart', async ({ page }) => {
      await mockHandoff(page, 'ready-one-bundle');
      await openBoard(page);
      await expect(apple(page)).toHaveCount(1);
      await expect(google(page)).toHaveCount(1);
      await expect(calendar(page)).toHaveCount(1);
      await expect(page.getByText(/Apple Wallet is for iPhone/)).toBeVisible();
      // The wallet and calendar badges share one row where the screen is wide enough.
      test.skip((page.viewportSize()?.width ?? 0) < 700, 'Three badges wrap on a phone.');
      const tops = await page
        .locator('.board-actions a')
        .evaluateAll((links) => links.map((a) => Math.round(a.getBoundingClientRect().top)));
      expect(new Set(tops).size).toBe(1);
    });
  });
});
