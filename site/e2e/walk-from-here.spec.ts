import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations, installClock, mockHandoff, openBoard, watch } from './support/site';

// "Walk from here" on the board page (showcase-site task 40, ADR-037). The browser location is
// mocked. The fixture's first session starts at 08:30 at The Venetian; the clock is 08:00.

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const FORUM = { latitude: 36.1189571, longitude: -115.1661889 };

const walkButton = (page: Page) => page.getByRole('button', { name: 'Walk from here' });
const walkArea = (page: Page) => page.locator('.board-walk');

async function openReady(page: Page): Promise<void> {
  await installClock(page, '2026-11-30T08:00:00-08:00');
  await mockHandoff(page, 'ready-one-bundle');
  await openBoard(page);
}

test.describe('with location allowed', () => {
  test.use({ userAgent: DESKTOP_UA, permissions: ['geolocation'], geolocation: FORUM });

  test('only the next session has the button, and nothing is asked before the tap', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
      navigator.geolocation.getCurrentPosition = (...args) => {
        (window as unknown as { __asked: boolean }).__asked = true;
        original(...args);
      };
    });
    await openReady(page);
    await expect(walkButton(page)).toHaveCount(1);
    await expect(page.locator('.board-sessions > li').first().getByRole('button')).toHaveText(
      'Walk from here',
    );
    const asked = await page.evaluate(
      () => (window as unknown as { __asked?: boolean }).__asked === true,
    );
    expect(asked).toBe(false);
  });

  test('the page is served with a Permissions-Policy that allows the location for itself', async ({
    page,
  }) => {
    const response = await page.goto('/board');
    expect(response?.headers()['permissions-policy']).toContain('geolocation=(self)');
  });

  test('shows the walk, the leave-by time and a Google Maps link, and sends nothing', async ({
    page,
    context,
    baseURL,
  }) => {
    await openReady(page);
    const record = watch(page);
    await walkButton(page).click();
    // Forum to The Venetian is 329 m in a straight line: 8 minutes, plus 15 to get inside.
    await expect(walkArea(page).getByText('About 8 min walk.')).toBeVisible();
    await expect(walkArea(page).getByText('Leave by 8:07 AM.')).toBeVisible();
    // The tap happened at 8:00 AM event time, and the page says so.
    await expect(walkArea(page).getByText(/Worked out at 8:00 AM\./)).toBeVisible();
    await expect(walkArea(page).getByText(/This is an estimate\./)).toBeVisible();
    const link = page.getByRole('link', {
      name: 'Directions to The Venetian in Google Maps (opens in a new tab)',
    });
    await expect(link).toHaveAttribute(
      'href',
      'https://www.google.com/maps/dir/?api=1&destination=36.121912,-115.166229&travelmode=walking',
    );
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(
      walkArea(page).getByText(/gets your location only when you open this link/),
    ).toBeVisible();
    await expect(page.getByRole('status')).toContainText('About 8 min walk.');
    // Nothing left the phone and nothing was stored.
    const origin = new URL(baseURL ?? '').origin;
    for (const url of record.requests) {
      expect(new URL(url).origin, url).toBe(origin);
      expect(url).not.toContain('36.1');
    }
    expect(await context.cookies()).toEqual([]);
    expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  });

  test('has no axe violations with the estimate showing', async ({ page }) => {
    test.slow();
    await openReady(page);
    await walkButton(page).click();
    await expect(walkArea(page).getByText('About 8 min walk.')).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('a prompt that is never answered times out, and the next tap works', async ({ page }) => {
    await page.addInitScript(() => {
      const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
      let calls = 0;
      navigator.geolocation.getCurrentPosition = (...args) => {
        calls += 1;
        // The first prompt is dismissed with no answer, as Firefox "Not now" does.
        if (calls > 1) {
          original(...args);
        }
      };
    });
    await openReady(page);
    await walkButton(page).click();
    await expect(walkButton(page)).toHaveAttribute('aria-busy', 'true');
    await expect(walkButton(page)).toHaveAttribute('aria-disabled', 'true');
    await page.clock.fastForward('00:21');
    await expect(walkArea(page).getByText(/could not find where you are/)).toBeVisible();
    await expect(walkButton(page)).not.toHaveAttribute('aria-busy', 'true');
    await walkButton(page).click();
    await expect(walkArea(page).getByText(/^About \d+ min walk\./)).toBeVisible();
  });

  test('works from the keyboard', async ({ page }) => {
    await openReady(page);
    await walkButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(walkArea(page).getByText('About 8 min walk.')).toBeVisible();
  });

  test('a phone far from Las Vegas gets a message and no estimate', async ({ page, context }) => {
    await context.setGeolocation({ latitude: 37.7749, longitude: -122.4194 });
    await openReady(page);
    await walkButton(page).click();
    await expect(walkArea(page).getByText(/more than 20 km from this venue/)).toBeVisible();
    await expect(walkArea(page).getByText(/min walk/)).toHaveCount(0);
    await expect(page.getByRole('link', { name: /^Directions/ })).toHaveCount(0);
  });
});

test.describe('on an iPhone', () => {
  test.use({ userAgent: IPHONE_UA, permissions: ['geolocation'], geolocation: FORUM });

  test('the Directions link opens Apple Maps', async ({ page }) => {
    await openReady(page);
    await walkButton(page).click();
    await expect(
      page.getByRole('link', {
        name: 'Directions to The Venetian in Apple Maps (opens in a new tab)',
      }),
    ).toHaveAttribute('href', 'https://maps.apple.com/?daddr=36.121912,-115.166229&dirflg=w');
  });
});

test.describe('with location not allowed', () => {
  test.use({ userAgent: DESKTOP_UA });

  test('says so plainly and shows no estimate', async ({ page }) => {
    // The same answer the browser gives when the attendee taps Block.
    await page.addInitScript(() => {
      navigator.geolocation.getCurrentPosition = (_ok, fail) => {
        fail?.({ code: 1, message: 'denied' } as GeolocationPositionError);
      };
    });
    await openReady(page);
    await walkButton(page).click();
    await expect(walkArea(page).getByText(/We could not use your location/)).toBeVisible();
    await expect(walkArea(page).getByText(/min walk/)).toHaveCount(0);
  });
});
