/**
 * Renders the popup in the states that matter for UX review. Not assertions: run with
 *   SCREENSHOTS=1 pnpm test:e2e screenshots
 * and look at artifacts/screenshots/.
 */
import { test } from '@playwright/test';
import { launch, markInvoked, openMedia, openPopup, openTone } from './harness.ts';

test.skip(!process.env.SCREENSHOTS, 'Set SCREENSHOTS=1 to render popup screenshots');

const out = (name: string) => `artifacts/screenshots/${name}.png`;

async function setVolume(popup: import('@playwright/test').Page, tabId: number, v: number) {
  await popup.evaluate(
    ([id, volume]) =>
      chrome.runtime.sendMessage({ target: 'background', type: 'set-volume', tabId: id, volume }),
    [tabId, v],
  );
}

async function shoot(popup: import('@playwright/test').Page, name: string) {
  await popup.waitForTimeout(250);
  await popup.locator('#app').screenshot({ path: out(name), animations: 'disabled' });
}

for (const scheme of ['light', 'dark'] as const) {
  test(`main view (${scheme})`, async () => {
    const h = await launch({ colorScheme: scheme });
    const current = await openTone(h, 'Lo-fi beats to relax/study to — 24/7 live radio');
    const podcast = await openTone(h, 'Episode 142: The future of browser audio', 330);
    const meeting = await openTone(h, 'Weekly sync — Google Meet', 550);
    const locked = await openTone(h, 'Trailer — Official 4K', 220);
    for (const title of ['Inbox (3)', 'Pull request #42', 'Docs — Geist']) {
      const page = await h.context.newPage();
      await page.goto(`${h.baseUrl}/?title=${encodeURIComponent(title)}&hz=0`);
    }
    await markInvoked(h, [current.tabId, podcast.tabId, meeting.tabId]);
    await h.worker.evaluate(() =>
      chrome.storage.sync.set({ settings: { boost: true, badge: true, theme: 'system' } }),
    );
    let popup = await openPopup(h, current.tabId);
    await setVolume(popup, current.tabId, 60);
    await setVolume(popup, podcast.tabId, 150);
    await h.worker.evaluate((id) => chrome.tabs.update(id, { muted: true }), meeting.tabId);
    await popup.close();
    popup = await openPopup(h, current.tabId);
    await shoot(popup, `main-${scheme}`);

    await popup.click('#others-toggle');
    await shoot(popup, `main-expanded-${scheme}`);

    await popup.click('#open-settings');
    await shoot(popup, `settings-${scheme}`);
    void locked;
    await h.close();
  });
}

test('empty state and restricted current tab', async () => {
  const h = await launch();
  const page = await h.context.newPage();
  await page.goto('chrome://version');
  const tabId = await h.worker.evaluate(
    async () => (await chrome.tabs.query({ url: 'chrome://version/' }))[0]?.id ?? -1,
  );
  const popup = await openPopup(h, tabId);
  await shoot(popup, 'restricted-light');
  await h.close();
});

test('many tabs with search', async () => {
  const h = await launch();
  const current = await openTone(h, 'Lo-fi beats');
  const titles = [
    'Spotify — Web Player',
    'An extremely long video title that keeps going and going to test truncation in rows',
    'Podcast',
    'Twitch',
    'SoundCloud',
    'Radio',
    'Bandcamp',
    'Vimeo',
  ];
  const ids: number[] = [current.tabId];
  for (const [i, title] of titles.entries())
    ids.push((await openTone(h, title, 200 + i * 40)).tabId);
  await markInvoked(h, ids);
  const popup = await openPopup(h, current.tabId);
  await shoot(popup, 'many-tabs');
  await popup.fill('#search', 'sound');
  await shoot(popup, 'search');
  await h.close();
});

test('free control: locked rows, hints and settings', async () => {
  let h = await launch({ captureEverywhere: false });
  let current = await openTone(h, 'Lo-fi beats to relax/study to — 24/7 live radio');
  await openMedia(h, 'Al Macbook Neo le salió competencia');
  let popup = await openPopup(h, current.tabId);
  await shoot(popup, 'free-locked');
  await h.close();

  h = await launch({ captureEverywhere: false, siteAccess: true });
  await h.worker.evaluate(() =>
    chrome.storage.sync.set({ settings: { boost: true, badge: true, theme: 'system' } }),
  );
  current = await openTone(h, 'Lo-fi beats to relax/study to — 24/7 live radio');
  const same = await openMedia(h, 'Podcast episode 142');
  const cross = await openMedia(h, 'Embedded player', `${h.otherOrigin}/tone.wav`);
  const game = await openTone(h, 'Browser game', 330);
  popup = await openPopup(h, current.tabId);
  await setVolume(popup, same.tabId, 70);
  await setVolume(popup, cross.tabId, 160);
  await setVolume(popup, game.tabId, 40);
  await popup.close();
  popup = await openPopup(h, current.tabId);
  await shoot(popup, 'free-hints');
  await popup.click('#open-settings');
  await shoot(popup, 'free-settings');
  await h.close();
});
