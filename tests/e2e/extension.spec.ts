import { expect, type Page, test } from '@playwright/test';
import { volumeToGain } from '../../src/lib/volume.ts';
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
  // 25% is a quarter of the loudness: -20 dB, a gain of 0.1.
  expect(chain?.gain).toBeCloseTo(0.1, 3);
  expect(chain?.limiter).toBe(false);
  // Source tone is 0.25 amplitude → RMS ≈ 0.177; at 25% it should be ≈ 0.018.
  expect(chain?.rms).toBeGreaterThan(0.012);
  expect(chain?.rms).toBeLessThan(0.025);
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
  expect(boosted?.gain).toBeCloseTo(volumeToGain(150), 3);
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
  await expect(locked.locator('.allow-btn')).toBeVisible();
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
  await expect(row.locator('.allow-btn')).toBeHidden();
});

test('mute silences a tab whose volume was changed', async () => {
  const a = await openTone(h, 'Tone A');
  await markInvoked(h, [a.tabId]);
  const popup = await openPopup(h, a.tabId);
  const row = popup.locator(rowOf(a.tabId));
  const input = row.locator('.value-input');

  await input.fill('50');
  await input.press('Enter');
  await expect.poll(async () => (await stats(popup))[0]?.rms ?? 0).toBeGreaterThan(0.05);

  // The captured copy of the audio plays from the extension, so muting must silence it too.
  await row.locator('.mute-btn').click();
  await expect(row).toHaveAttribute('data-muted', 'true');
  await expect.poll(async () => (await stats(popup))[0]?.rms ?? 1).toBeLessThan(0.002);

  await row.locator('.mute-btn').click();
  await expect.poll(async () => (await stats(popup))[0]?.rms ?? 0).toBeGreaterThan(0.05);

  // Changing the volume while muted must not bring the sound back.
  await row.locator('.mute-btn').click();
  await input.fill('80');
  await input.press('Enter');
  await expect.poll(async () => (await tabStates(h))[a.tabId]?.volume).toBe(80);
  await expect.poll(async () => (await stats(popup))[0]?.rms ?? 1).toBeLessThan(0.002);
});

test('a tab muted before its volume changes stays silent', async () => {
  const a = await openTone(h, 'Tone A');
  await markInvoked(h, [a.tabId]);
  await h.worker.evaluate((id) => chrome.tabs.update(id, { muted: true }), a.tabId);
  const popup = await openPopup(h, a.tabId);
  const input = popup.locator(`${rowOf(a.tabId)} .value-input`);

  await input.fill('150');
  await input.press('Enter');
  await input.fill('60');
  await input.press('Enter');
  await expect.poll(async () => (await stats(popup)).length).toBe(1);
  await expect.poll(async () => (await stats(popup))[0]?.rms ?? 1).toBeLessThan(0.002);
});

const SINE_RMS = Math.SQRT1_2;
const db = (ratio: number) => 20 * Math.log10(ratio);

async function enableBoost(h: Harness): Promise<void> {
  await h.worker.evaluate(() =>
    chrome.storage.sync.set({ settings: { boost: true, badge: true, theme: 'system' } }),
  );
}

async function setVolume(popup: Page, tabId: number, volume: number): Promise<void> {
  const input = popup.locator(`${rowOf(tabId)} .value-input`);
  await input.fill(String(volume));
  await input.press('Enter');
}

test('50% sounds half as loud (-10 dB) and 200% twice as loud (+10 dB)', async () => {
  const a = await openTone(h, 'Tone A', 440, 0.25);
  await markInvoked(h, [a.tabId]);
  await enableBoost(h);
  const popup = await openPopup(h, a.tabId);
  const source = 0.25 * SINE_RMS;

  await setVolume(popup, a.tabId, 50);
  await expect
    .poll(async () => db(((await stats(popup))[0]?.rms ?? 0) / source))
    .toBeCloseTo(-10, 0);

  await setVolume(popup, a.tabId, 200);
  await expect.poll(async () => (await stats(popup))[0]?.limiter).toBe(true);
  const [boosted] = await stats(popup);
  // +10 dB, plus up to ~1 dB of makeup gain from the limiter.
  expect(db((boosted?.rms ?? 0) / source)).toBeGreaterThan(9.5);
  expect(db((boosted?.rms ?? 0) / source)).toBeLessThan(11.5);
  expect(boosted?.peak).toBeLessThan(1);
});

test('boosting audio that is already loud never clips and keeps getting louder up to 400%', async () => {
  const a = await openTone(h, 'Loud tone', 440, 0.9);
  await markInvoked(h, [a.tabId]);
  await enableBoost(h);
  const popup = await openPopup(h, a.tabId);
  const source = 0.9 * SINE_RMS;
  const hint = popup.locator(`${rowOf(a.tabId)} .row-hint`);

  let previous = -Infinity;
  for (const volume of [101, 150, 200, 300, 400]) {
    await setVolume(popup, a.tabId, volume);
    await expect.poll(async () => (await tabStates(h))[a.tabId]?.volume).toBe(volume);
    await popup.waitForTimeout(300);
    const [chain] = await stats(popup);
    const level = db((chain?.rms ?? 0) / source);
    expect(chain?.peak, `peak at ${volume}%`).toBeLessThan(1);
    expect(level, `level at ${volume}%`).toBeGreaterThan(-0.3);
    expect(level, `level at ${volume}% vs. the step before`).toBeGreaterThan(previous - 0.1);
    previous = level;
    // Above 200% the row says the sound is being compressed.
    if (volume > 200) await expect(hint).toHaveText(await msg(popup, 'compressedBoost'));
    else await expect(hint).toBeHidden();
  }
});

test('the booster goes up to 400% and the slider keeps 0–100% precise', async () => {
  const a = await openTone(h, 'Tone A');
  await markInvoked(h, [a.tabId]);
  await enableBoost(h);
  const popup = await openPopup(h, a.tabId);
  const row = popup.locator(rowOf(a.tabId));
  const input = row.locator('.value-input');
  const slider = row.locator('.slider');

  await input.fill('450');
  await input.press('Enter');
  await expect(input).toHaveValue('400');
  await expect.poll(async () => (await tabStates(h))[a.tabId]?.volume).toBe(400);
  await expect(slider).toHaveValue('200');

  // Arrow keys: 1% per step below 100%, 5% per step above.
  await setVolume(popup, a.tabId, 100);
  await slider.focus();
  await slider.press('ArrowRight');
  await expect(input).toHaveValue('105');
  await slider.press('ArrowLeft');
  await slider.press('ArrowLeft');
  await expect(input).toHaveValue('99');
});

/** Drags the slider thumb to a slider position (0–100, or 0–200 with the booster). */
async function dragSlider(
  popup: Page,
  tabId: number,
  position: number,
  max: number,
): Promise<void> {
  const slider = popup.locator(`${rowOf(tabId)} .slider`);
  const box = await slider.boundingBox();
  if (!box) throw new Error('slider not visible');
  const xOf = (p: number) => box.x + 7 + ((box.width - 14) * p) / max;
  const current = Number(await slider.inputValue());
  const y = box.y + box.height / 2;
  await popup.mouse.move(xOf(current), y);
  await popup.mouse.down();
  await popup.mouse.move(xOf(position), y, { steps: 8 });
  await popup.mouse.up();
}

test('dragging near a guide mark snaps onto it', async () => {
  const a = await openTone(h, 'Tone A');
  await markInvoked(h, [a.tabId]);
  await enableBoost(h);
  const popup = await openPopup(h, a.tabId);
  const row = popup.locator(rowOf(a.tabId));
  const input = row.locator('.value-input');

  // Guide marks at 50, 100, 200 and 300 (0 and 400 are the ends); 100 is highlighted.
  await expect(row.locator('.tick')).toHaveCount(4);
  await expect(row.locator('.tick[data-mark="100"]')).toHaveAttribute('data-active', 'true');

  await dragSlider(popup, a.tabId, 70, 200);
  await expect(input).toHaveValue('70');
  await dragSlider(popup, a.tabId, 48.5, 200);
  await expect(input).toHaveValue('50');
  await dragSlider(popup, a.tabId, 131.5, 200);
  await expect(input).toHaveValue('200');
  await expect(row.locator('.tick[data-mark="200"]')).toHaveAttribute('data-active', 'true');
  await dragSlider(popup, a.tabId, 120, 200);
  await expect(input).toHaveValue('160');
  await expect.poll(async () => (await tabStates(h))[a.tabId]?.volume).toBe(160);
});

test('the mouse wheel and arrow keys work while the pointer is over the slider', async () => {
  const a = await openTone(h, 'Tone A');
  await markInvoked(h, [a.tabId]);
  await enableBoost(h);
  const popup = await openPopup(h, a.tabId);
  const row = popup.locator(rowOf(a.tabId));
  const input = row.locator('.value-input');
  const box = await row.locator('.slider').boundingBox();
  if (!box) throw new Error('slider not visible');
  await popup.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  // A wheel notch is one step: 5% above 100%, 1% below.
  await popup.mouse.wheel(0, -100);
  await expect(input).toHaveValue('105');
  await popup.mouse.wheel(0, 100);
  await popup.mouse.wheel(0, 100);
  await expect(input).toHaveValue('99');

  // Trackpads send small deltas: about 50 px of scrolling make one step.
  await popup.waitForTimeout(350);
  for (let i = 0; i < 5; i++) await popup.mouse.wheel(0, -12);
  await expect(input).toHaveValue('100');

  // Arrow keys without clicking the slider first.
  await popup.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await popup.keyboard.press('ArrowLeft');
  await expect(input).toHaveValue('99');
  await popup.keyboard.press('Shift+ArrowRight');
  await expect(input).toHaveValue('100');
  await popup.keyboard.press('Shift+ArrowRight');
  await expect(input).toHaveValue('110');
  await expect.poll(async () => (await tabStates(h))[a.tabId]?.volume).toBe(110);

  // Away from the slider, the arrow keys don't change anything.
  await popup.mouse.move(5, 5);
  await popup.keyboard.press('ArrowRight');
  await popup.waitForTimeout(200);
  await expect(input).toHaveValue('110');
});

test('scrolling the list over a slider keeps scrolling instead of changing its volume', async () => {
  const tones = [];
  for (let i = 0; i < 9; i++) tones.push(await openTone(h, `Tone ${i}`, 200 + i * 50));
  const first = tones[0];
  if (!first) throw new Error('no tone');
  await markInvoked(
    h,
    tones.map((t) => t.tabId),
  );
  const popup = await openPopup(h, first.tabId);
  const list = popup.locator('#view-tabs');
  await expect.poll(() => list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);

  // Start scrolling over a title, then keep scrolling as the pointer crosses a slider.
  const title = await popup.locator(`${rowOf(first.tabId)} .row-title`).boundingBox();
  if (!title) throw new Error('title not visible');
  await popup.mouse.move(title.x + 10, title.y + title.height / 2);
  await popup.mouse.wheel(0, 120);
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const target = popup.locator('#playing .row').nth(2);
  const box = await target.locator('.slider').boundingBox();
  if (!box) throw new Error('slider not visible');
  await popup.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await popup.mouse.wheel(0, 120);
  await popup.waitForTimeout(200);
  await expect(target.locator('.value-input')).toHaveValue('100');
  expect(Object.keys(await tabStates(h))).toHaveLength(0);
});
