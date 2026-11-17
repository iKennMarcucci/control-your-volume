/**
 * The popup must open instantly. Chromium only shows it once the page has loaded, so nothing
 * slow (network, many tabs) may sit on that path.
 */
import { expect, test } from '@playwright/test';
import { launch, markInvoked, openTone } from './harness.ts';

const TABS = 60;
/** Generous for slow CI machines; locally it's ~30 ms. */
const READY_BUDGET_MS = 400;

test('opens fast with many tabs and makes no network requests', async () => {
  test.setTimeout(120_000);
  const h = await launch();
  const current = await openTone(h, 'Current');
  await markInvoked(h, [current.tabId]);
  for (let i = 0; i < TABS; i++) {
    const page = await h.context.newPage();
    await page.goto(`${h.baseUrl}/page?title=Site%20${i}`);
  }
  // Let the browser pick up every site's favicon, as it would for real tabs.
  await expect
    .poll(async () =>
      h.worker.evaluate(
        async () =>
          (await chrome.tabs.query({})).filter((t) => t.favIconUrl?.startsWith('http')).length,
      ),
    )
    .toBeGreaterThanOrEqual(TABS);

  const popup = await h.context.newPage();
  const network: string[] = [];
  popup.on('request', (request) => {
    if (/^https?:/.test(request.url())) network.push(request.url());
  });
  await popup.setViewportSize({ width: 360, height: 600 });
  await popup.goto(`chrome-extension://${h.extensionId}/popup.html?tab=${current.tabId}`);
  await popup.waitForFunction(() => performance.getEntriesByName('cyv:ready').length > 0);

  const ready = await popup.evaluate(
    () => performance.getEntriesByName('cyv:ready')[0]?.startTime ?? -1,
  );
  console.log(`popup ready after ${Math.round(ready)} ms with ${TABS + 1} tabs`);
  expect(ready).toBeGreaterThan(0);
  expect(ready).toBeLessThan(READY_BUDGET_MS);
  expect(await popup.locator('.row').count()).toBeGreaterThanOrEqual(TABS + 1);

  // Open "Other tabs" so every favicon is requested, then give them time to load.
  await popup.click('#others-toggle');
  await popup.waitForTimeout(500);
  expect(network, 'the popup must not contact any website').toEqual([]);
  await h.close();
});
