import { expect, test } from '@playwright/test';
import {
  type Harness,
  launch,
  markInvoked,
  msg,
  openPopup,
  openTone,
  stats,
  tabStates,
} from './harness.ts';

let h: Harness;

test.beforeEach(async () => {
  h = await launch();
});

test.afterEach(async () => {
  await h.close();
});

const rowOf = (tabId: number) => `.row[data-tab-id="${tabId}"]`;

test('lowers one tab without touching another', async () => {
  const a = await openTone(h, 'Tone A');
  const b = await openTone(h, 'Tone B', 660);
  await markInvoked(h, [a.tabId, b.tabId]);
  const popup = await openPopup(h, a.tabId);

  const input = popup.locator(`${rowOf(a.tabId)} .value-input`);
  await input.fill('25');
  await input.press('Enter');

  await expect.poll(async () => (await tabStates(h))[a.tabId]?.volume).toBe(25);
  const [chain] = await stats(popup);
  expect(chain?.tabId).toBe(a.tabId);
  expect(chain?.gain).toBeCloseTo(0.25, 2);
  expect(chain?.limiter).toBe(false);
  // Source tone is 0.25 amplitude → RMS ≈ 0.177; at 25% it should be ≈ 0.044.
  expect(chain?.rms).toBeGreaterThan(0.02);
  expect(chain?.rms).toBeLessThan(0.07);
  expect((await tabStates(h))[b.tabId]).toBeUndefined();
});

test('keyboard on the slider: arrows step 1, Shift+arrows step 10', async () => {
  const a = await openTone(h, 'Tone A');
  await markInvoked(h, [a.tabId]);
  const popup = await openPopup(h, a.tabId);
  const slider = popup.locator(`${rowOf(a.tabId)} .slider`);

  await slider.focus();
  await slider.press('Shift+ArrowLeft');
  await slider.press('Shift+ArrowLeft');
  await slider.press('ArrowLeft');
  await expect.poll(async () => (await tabStates(h))[a.tabId]?.volume).toBe(79);
  await expect(popup.locator(`${rowOf(a.tabId)} .value-input`)).toHaveValue('79');
  await expect(slider).toHaveAttribute('aria-valuetext', await msg(popup, 'percentValue', '79'));
});

test('booster is off by default, allows 200% when enabled and clamps when disabled', async () => {
  const a = await openTone(h, 'Tone A');
  await markInvoked(h, [a.tabId]);
  const popup = await openPopup(h, a.tabId);
  const row = popup.locator(rowOf(a.tabId));
  const input = row.locator('.value-input');

  await expect(row.locator('.slider')).toHaveAttribute('max', '100');
  await input.fill('150');
  await input.press('Enter');
  await expect(input).toHaveValue('100');

  await popup.click('#open-settings');
  await expect(popup.locator('#setting-boost')).not.toBeChecked();
  await popup.click('#setting-boost');
  await popup.click('#close-settings');

  await expect(row.locator('.slider')).toHaveAttribute('max', '200');
  await input.fill('150');
  await input.press('Enter');
  await expect.poll(async () => (await tabStates(h))[a.tabId]?.volume).toBe(150);
  await expect(row).toHaveAttribute('data-boosted', 'true');
  const [boosted] = await stats(popup);
  expect(boosted?.gain).toBeCloseTo(1.5, 2);
  expect(boosted?.limiter).toBe(true);

  await popup.click('#open-settings');
  await popup.click('#setting-boost');
  await popup.click('#close-settings');
  await expect.poll(async () => (await tabStates(h))[a.tabId]?.volume ?? 100).toBe(100);
  await expect(row.locator('.slider')).toHaveAttribute('max', '100');
});

test('returning to 100% releases the capture', async () => {
  const a = await openTone(h, 'Tone A');
  await markInvoked(h, [a.tabId]);
  const popup = await openPopup(h, a.tabId);
  const input = popup.locator(`${rowOf(a.tabId)} .value-input`);

  await input.fill('60');
  await input.press('Enter');
  await expect.poll(async () => (await stats(popup)).length).toBe(1);

  await input.fill('100');
  await input.press('Enter');
  await expect.poll(async () => (await tabStates(h))[a.tabId], { timeout: 5000 }).toBeUndefined();
});

test('closing a tab cleans up its state', async () => {
  const a = await openTone(h, 'Tone A');
  await markInvoked(h, [a.tabId]);
  const popup = await openPopup(h, a.tabId);
  const input = popup.locator(`${rowOf(a.tabId)} .value-input`);
  await input.fill('40');
  await input.press('Enter');
  await expect.poll(async () => (await tabStates(h))[a.tabId]?.volume).toBe(40);

  await a.page.close();
  await expect.poll(async () => (await tabStates(h))[a.tabId]).toBeUndefined();
  await expect(popup.locator(rowOf(a.tabId))).toHaveCount(0);
});

test('tabs never opened with the extension explain how to control them', async () => {
  const a = await openTone(h, 'Tone A');
  const b = await openTone(h, 'Tone B', 660);
  const popup = await openPopup(h, a.tabId);

  const locked = popup.locator(rowOf(b.tabId));
  await expect(locked).toHaveAttribute('data-state', 'locked');
  await expect(locked.locator('.notice-text')).toHaveText(await msg(popup, 'notInvoked'));
  await expect(locked.locator('.go-btn')).toBeVisible();
  await expect(locked.locator('.slider')).toBeHidden();
  await expect(popup.locator(rowOf(a.tabId))).toHaveAttribute('data-state', 'ready');
});

test('mute uses the browser mute and shows it on the row', async () => {
  const a = await openTone(h, 'Tone A');
  await markInvoked(h, [a.tabId]);
  const popup = await openPopup(h, a.tabId);
  const row = popup.locator(rowOf(a.tabId));

  await row.locator('.mute-btn').click();
  await expect(row).toHaveAttribute('data-muted', 'true');
  await expect(row.locator('.mute-btn')).toHaveAttribute('aria-label', await msg(popup, 'unmute'));
  const muted = await h.worker.evaluate(
    async (id) => (await chrome.tabs.get(id)).mutedInfo?.muted,
    a.tabId,
  );
  expect(muted).toBe(true);
});

test('search filters tabs by title and host', async () => {
  const a = await openTone(h, 'Tone A');
  for (const title of ['Lo-fi beats', 'Podcast', 'News', 'Docs', 'Mail']) await openTone(h, title);
  const popup = await openPopup(h, a.tabId);

  const search = popup.locator('#search');
  await expect(search).toBeVisible();
  await search.fill('podc');
  await expect(popup.locator('.row:visible')).toHaveCount(1);
  await expect(popup.locator('.row:visible .row-title-text')).toHaveText('Podcast');
  await search.fill('zzz');
  await expect(popup.locator('#no-results')).toBeVisible();
});

test('restricted pages show why they cannot be controlled', async () => {
  const page = await h.context.newPage();
  await page.goto('chrome://version');
  const tabId = await h.worker.evaluate(
    async () => (await chrome.tabs.query({ url: 'chrome://version/' }))[0]?.id ?? -1,
  );
  const popup = await openPopup(h, tabId);
  const row = popup.locator(rowOf(tabId));
  await expect(row).toHaveAttribute('data-state', 'restricted');
  await expect(row.locator('.go-btn')).toBeHidden();
});
