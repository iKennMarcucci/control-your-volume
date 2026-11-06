/**
 * Free control: tabs the user never opened the extension on, controlled through their
 * <video>/<audio> elements. These run like a real user (no capture allowlist).
 */
import { expect, type Page, test } from '@playwright/test';
import { type Harness, launch, msg, openMedia, openPopup, openTone, tabStates } from './harness.ts';

const rowOf = (tabId: number) => `.row[data-tab-id="${tabId}"]`;

async function setVolume(popup: Page, tabId: number, volume: number): Promise<void> {
  const input = popup.locator(`${rowOf(tabId)} .value-input`);
  await input.fill(String(volume));
  await input.press('Enter');
}

test.describe('with site access', () => {
  let h: Harness;
  test.beforeEach(async () => {
    h = await launch({ captureEverywhere: false, siteAccess: true });
  });
  test.afterEach(async () => {
    await h.close();
  });

  test('controls a tab that was never visited, keeping the site’s own volume', async () => {
    const current = await openTone(h, 'Current');
    const music = await openMedia(h, 'Music');
    const popup = await openPopup(h, current.tabId);
    const row = popup.locator(rowOf(music.tabId));
    await expect(row).toHaveAttribute('data-state', 'ready');

    await setVolume(popup, music.tabId, 50);
    await expect.poll(music.volume).toBeCloseTo(0.5, 2);
    await expect
      .poll(async () => (await tabStates(h))[music.tabId])
      .toMatchObject({
        volume: 50,
        captured: false,
        media: true,
      });

    // The site moves its own volume slider: its choice is kept and scaled.
    await music.page.evaluate(() => {
      (document.querySelector('audio') as HTMLAudioElement).volume = 0.8;
    });
    await expect.poll(music.volume).toBeCloseTo(0.4, 2);

    // A new page in the same tab gets the tab's level again.
    await music.page.reload();
    await expect.poll(music.volume).toBeCloseTo(0.5, 2);

    await setVolume(popup, music.tabId, 100);
    await expect.poll(music.volume).toBeCloseTo(1, 2);
    await expect.poll(async () => (await tabStates(h))[music.tabId]).toBeUndefined();
  });

  test('boosts readable media and explains when a site can’t be boosted', async () => {
    const current = await openTone(h, 'Current');
    const same = await openMedia(h, 'Same origin');
    const cross = await openMedia(h, 'Cross origin', `${h.otherOrigin}/tone.wav`);
    await h.worker.evaluate(() =>
      chrome.storage.sync.set({ settings: { boost: true, badge: true, theme: 'system' } }),
    );
    const popup = await openPopup(h, current.tabId);

    await setVolume(popup, same.tabId, 150);
    await expect
      .poll(async () => (await tabStates(h))[same.tabId])
      .toMatchObject({
        volume: 150,
        media: true,
        limited: false,
      });
    // The boost is applied by a gain node; the element itself stays at the site's volume.
    expect(await same.volume()).toBeCloseTo(1, 2);
    await expect(popup.locator(`${rowOf(same.tabId)} .row-hint`)).toBeHidden();

    await setVolume(popup, cross.tabId, 150);
    await expect.poll(async () => (await tabStates(h))[cross.tabId]?.limited).toBe(true);
    const hint = popup.locator(`${rowOf(cross.tabId)} .row-hint`);
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(await msg(popup, 'boostLimited'));

    // Lowering a cross-origin tab still works through the element's volume.
    await setVolume(popup, cross.tabId, 30);
    await expect.poll(cross.volume).toBeCloseTo(0.3, 2);
    await expect(hint).toBeHidden();
  });

  test('says so when a page has no video or audio to adjust', async () => {
    const current = await openMedia(h, 'Current');
    const game = await openTone(h, 'Web Audio game');
    const popup = await openPopup(h, current.tabId);

    await setVolume(popup, game.tabId, 50);
    const hint = popup.locator(`${rowOf(game.tabId)} .row-hint`);
    await expect(hint).toHaveText(await msg(popup, 'noMedia'));
  });

  test('turning free control off puts tabs back to 100%', async () => {
    const current = await openTone(h, 'Current');
    const music = await openMedia(h, 'Music');
    const popup = await openPopup(h, current.tabId);

    await setVolume(popup, music.tabId, 20);
    await expect.poll(music.volume).toBeCloseTo(0.2, 2);
    await popup.evaluate(() =>
      chrome.runtime.sendMessage({ target: 'background', type: 'release-media' }),
    );
    await expect.poll(music.volume).toBeCloseTo(1, 2);
    await expect.poll(async () => (await tabStates(h))[music.tabId]).toBeUndefined();
  });
});

test('without site access, a never-visited tab offers to allow free control', async () => {
  const h = await launch({ captureEverywhere: false });
  const current = await openTone(h, 'Current');
  const music = await openMedia(h, 'Music');
  const popup = await openPopup(h, current.tabId);
  const row = popup.locator(rowOf(music.tabId));

  await expect(row).toHaveAttribute('data-state', 'locked');
  await expect(row.locator('.notice-text')).toHaveText(await msg(popup, 'notInvoked'));
  await expect(row.locator('.allow-btn')).toBeVisible();
  await expect(popup.locator('#setting-free')).not.toBeChecked();
  await h.close();
});
