import { expect, test } from '@playwright/test';
import { HANDOFF_ID, installClock, mockHandoff, openBoard, openNav, watch } from './support/site';

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

  test('three bundles are labelled bundle N of 3', async ({ page }) => {
    await mockHandoff(page, 'ready-three-bundles');
    await openBoard(page);
    // Each bundle is the official badge, named by its alt text, with a caption under it.
    const badges = page.getByRole('link', { name: /^Add to Apple Wallet \(bundle/ });
    await expect(badges).toHaveCount(3);
    for (const [index, n] of [1, 2, 3].entries()) {
      await expect(badges.nth(index)).toHaveAccessibleName(
        `Add to Apple Wallet (bundle ${String(n)} of 3)`,
      );
    }
    await expect(page.locator('.wallet-badge__caption', { hasText: /^Bundle/ })).toHaveText([
      'Bundle 1 of 3',
      'Bundle 2 of 3',
      'Bundle 3 of 3',
    ]);
    await expect(page.locator('.board-sessions > li')).toHaveCount(24);
  });

  test('every session has its own Apple, Google and calendar button named after its code', async ({
    page,
  }) => {
    await mockHandoff(page, 'ready-one-bundle');
    await openBoard(page);
    const first = page.locator('.board-sessions > li').first();
    await expect(first.getByRole('link')).toHaveCount(3);
    await expect(first.getByRole('link', { name: 'Add to Apple Wallet: ANT398' })).toHaveAttribute(
      'href',
      `/api/v1/handoffs/${HANDOFF_ID}/apple/pass/00000000-0000-4000-8000-000000000001`,
    );
    await expect(first.getByRole('link', { name: 'Add to Google Wallet: ANT398' })).toHaveAttribute(
      'href',
      /^https:\/\/pay\.google\.com\/gp\/v\/save\//,
    );
    await expect(first.getByRole('link', { name: 'Add to Calendar: ANT398' })).toHaveAttribute(
      'href',
      `/api/v1/handoffs/${HANDOFF_ID}/calendar/00000000-0000-4000-8000-000000000001.ics`,
    );
    // Four sessions, three buttons each, and the three buttons at the top.
    await expect(page.locator('.board-session-actions a')).toHaveCount(12);
    await expect(
      page.getByRole('link', { name: /^Add to (Apple Wallet|Google Wallet|Calendar): [A-Z0-9]+$/ }),
    ).toHaveCount(12);
  });

  test('24 passes give three Apple bundles, no top Google button and a Google button on every session', async ({
    page,
  }) => {
    await mockHandoff(page, 'ready-three-bundles');
    await openBoard(page);
    await expect(page.getByRole('link', { name: 'Add to Google Wallet', exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByRole('link', { name: 'Add to Calendar', exact: true })).toHaveCount(1);
    await expect(page.getByRole('link', { name: /^Add to Google Wallet: [A-Z0-9]+$/ })).toHaveCount(
      24,
    );
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
    // Each session offers only the Apple button.
    await expect(page.locator('.board-session-actions a')).toHaveCount(3);
    await expect(page.getByRole('link', { name: /^Add to Apple Wallet: [A-Z0-9]+$/ })).toHaveCount(
      3,
    );
    await expect(page.getByRole('link', { name: /Google Wallet|Calendar/i })).toHaveCount(0);
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
