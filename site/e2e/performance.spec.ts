import { expect, test } from '@playwright/test';

// Chromium proxy for the Home_Page Largest Contentful Paint budget (Requirement 21.3), under
// CPU and network throttling. Lighthouse mobile replaces it once the Integrator pins Lighthouse.

const LCP_BUDGET_MS = 2500;

test('the Home_Page LCP is under 2.5 seconds on a throttled phone', async ({
  page,
  context,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'The LCP proxy runs in Chromium only.');
  const client = await context.newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await client.send('Network.enable');
  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await page.addInitScript(() => {
    const store: number[] = [];
    (window as unknown as { __lcp: number[] }).__lcp = store;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        store.push(entry.startTime);
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText('re:Invent Compass');
  await expect
    .poll(async () => page.evaluate(() => (window as unknown as { __lcp: number[] }).__lcp.length))
    .toBeGreaterThan(0);
  const lcp = await page.evaluate(
    () => (window as unknown as { __lcp: number[] }).__lcp.at(-1) ?? 0,
  );
  expect(lcp).toBeLessThan(LCP_BUDGET_MS);
});
