// Shared helpers for the browser suite. Waits use application state only: focus, headings and
// live region text. There are no sleeps and no waits on URLs.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, type Route } from '@playwright/test';

/** The id of the hand-off fixtures. */
export const HANDOFF_ID = 'AbCdEfGhIjKlMnOpQrStUw';

const FIXTURES = join(__dirname, '..', 'fixtures', 'handoff');

interface Fixture {
  status: number;
  contentType: string;
  body?: unknown;
  rawBody?: string;
}

export function fixture(name: string): Fixture {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as Fixture;
}

/**
 * Answer the hand-off route with a fixture. `names` are used in turn: the first request gets the
 * first, the second the second, and the last one repeats. Returns a function that counts the
 * requests the route has received.
 */
export async function mockHandoff(page: Page, ...names: string[]): Promise<() => number> {
  let count = 0;
  await page.route(`**/api/v1/handoffs/${HANDOFF_ID}`, async (route: Route) => {
    const chosen = fixture(names[Math.min(count, names.length - 1)] as string);
    count += 1;
    // A ready body carries an expiry that follows the page clock, so the suite never expires.
    const body =
      chosen.status === 200 && chosen.body !== undefined
        ? { ...(chosen.body as object), expiresAt: expiryFor(page) }
        : chosen.body;
    await route.fulfill({
      status: chosen.status,
      contentType: chosen.contentType,
      body: chosen.rawBody ?? JSON.stringify(body),
    });
  });
  return () => count;
}

/** Every request, console message and CSP violation of a page. */
export interface Watch {
  readonly requests: string[];
  readonly consoleMessages: string[];
}

export function watch(page: Page): Watch {
  const record: Watch = { requests: [], consoleMessages: [] };
  page.on('request', (request) => record.requests.push(request.url()));
  page.on('console', (message) => record.consoleMessages.push(message.text()));
  page.on('pageerror', (error) => record.consoleMessages.push(error.message));
  return record;
}

/** Collect securitypolicyviolation events in the page. Call before the first navigation. */
export async function watchCsp(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const store: string[] = [];
    (window as unknown as { __violations: string[] }).__violations = store;
    document.addEventListener('securitypolicyviolation', (event) => {
      store.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return () => page.evaluate(() => (window as unknown as { __violations: string[] }).__violations);
}

/** axe with the WCAG 2.0, 2.1 and 2.2 A and AA rules. Fails with the rule ids. */
export async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
  ).toEqual([]);
}

/** The pages with a plain path. The board page needs a fixture and a fragment. */
export const PAGES = [
  { path: '/', h1: 're:Invent Compass', title: 'Home | re:Invent Compass' },
  { path: '/demo', h1: 'Demo', title: 'Demo | re:Invent Compass' },
  { path: '/install', h1: 'Install', title: 'Install | re:Invent Compass' },
  {
    path: '/privacy',
    h1: 'Privacy: what leaves your machine',
    title: 'Privacy | re:Invent Compass',
  },
] as const;

export const NOTICE =
  're:Invent Compass is an independent community project and is not affiliated with, endorsed by, or sponsored by Amazon Web Services.';

export const boardPath = `/board#h=${HANDOFF_ID}`;

/**
 * Open the board page as a fresh load. The page strips its own fragment, so going to the same
 * address again would be a navigation within the document (no reload); a blank page in between
 * makes it a real new visit, like scanning the QR code again.
 */
export async function openBoard(page: Page, hash: string = `#h=${HANDOFF_ID}`): Promise<void> {
  await page.goto('about:blank');
  await page.goto(`/board${hash}`);
}

const pageClock = new WeakMap<Page, number>();

/**
 * Give the page a fixed clock. mockHandoff then sets expiresAt 15 minutes after this time, so no
 * test depends on the real date.
 */
export async function installClock(page: Page, time: string): Promise<void> {
  const at = new Date(time);
  pageClock.set(page, at.getTime());
  await page.clock.install({ time: at });
}

/** A hand-off expiry 15 minutes after the page clock (or after now), as an ISO date-time in UTC. */
function expiryFor(page: Page): string {
  const now = pageClock.get(page) ?? Date.now();
  return new Date(now + 15 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}
