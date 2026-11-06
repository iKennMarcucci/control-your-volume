import { createHash, generateKeyPairSync } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type BrowserContext, chromium, type Page, type Worker } from '@playwright/test';

/** Copies dist/ and pins a generated key so the extension id is known before launch. */
function prepareExtension(): { dir: string; id: string } {
  const dir = mkdtempSync(join(tmpdir(), 'cyv-ext-'));
  cpSync('dist', dir, { recursive: true });
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const der = publicKey.export({ type: 'spki', format: 'der' });
  const id = [...createHash('sha256').update(der).digest('hex').slice(0, 32)]
    .map((c) => String.fromCharCode(97 + Number.parseInt(c, 16)))
    .join('');
  const manifestPath = join(dir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.key = der.toString('base64');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return { dir, id };
}

export interface Harness {
  context: BrowserContext;
  extensionId: string;
  worker: Worker;
  baseUrl: string;
  close: () => Promise<void>;
}

export async function launch(
  options: { locale?: string; colorScheme?: 'light' | 'dark' } = {},
): Promise<Harness> {
  const { dir, id } = prepareExtension();
  const html = readFileSync('tests/fixtures/audio-page.html');
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  // E2E_BROWSER=/path/to/browser runs the suite in an installed browser (Brave, Edge, Chrome).
  const executablePath = process.env.E2E_BROWSER;
  const context = await chromium.launchPersistentContext('', {
    ...(executablePath ? { executablePath } : { channel: 'chromium' }),
    headless: !process.env.HEADED,
    // Playwright mutes audio by default, which would make every captured tab silent.
    ignoreDefaultArgs: ['--mute-audio'],
    locale: options.locale ?? 'en-US',
    colorScheme: options.colorScheme ?? 'light',
    args: [
      `--disable-extensions-except=${dir}`,
      `--load-extension=${dir}`,
      // Lets tests capture tabs without clicking the toolbar button (which Playwright can't do).
      `--allowlisted-extension-id=${id}`,
      '--autoplay-policy=no-user-gesture-required',
      `--lang=${options.locale ?? 'en-US'}`,
    ],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  return {
    context,
    extensionId: id,
    worker,
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      await context.close();
      server.close();
    },
  };
}

export async function openTone(
  h: Harness,
  title: string,
  hz = 440,
): Promise<{ page: Page; tabId: number }> {
  const page = await h.context.newPage();
  await page.goto(`${h.baseUrl}/?title=${encodeURIComponent(title)}&hz=${hz}`);
  await page.evaluate(() =>
    (window as unknown as { resumeAudio: () => Promise<void> }).resumeAudio(),
  );
  const tabId = await h.worker.evaluate(
    async (t) => (await chrome.tabs.query({ title: t }))[0]?.id ?? -1,
    title,
  );
  return { page, tabId };
}

/** Simulates the user having opened the extension on these tabs (what grants tabCapture). */
export async function markInvoked(h: Harness, tabIds: number[]): Promise<void> {
  await h.worker.evaluate(async (ids) => {
    const data = await chrome.storage.session.get('invoked');
    const set = new Set([...((data.invoked as number[]) ?? []), ...ids]);
    await chrome.storage.session.set({ invoked: [...set] });
  }, tabIds);
}

export async function openPopup(
  h: Harness,
  currentTab?: number,
  size = { width: 360, height: 600 },
): Promise<Page> {
  const page = await h.context.newPage();
  await page.setViewportSize(size);
  await page.goto(
    `chrome-extension://${h.extensionId}/popup.html${currentTab ? `?tab=${currentTab}` : ''}`,
  );
  await page.waitForSelector('#current .row, #playing .row');
  return page;
}

export interface Stats {
  tabId: number;
  gain: number;
  limiter: boolean;
  rms: number;
}

/** Reads the processed level of every captured tab from the offscreen document. */
export async function stats(page: Page): Promise<Stats[]> {
  // The analyser is created on the first call; give it a moment to fill with audio.
  await page.evaluate(() => chrome.runtime.sendMessage({ target: 'offscreen', type: 'stats' }));
  await page.waitForTimeout(400);
  return page.evaluate(() => chrome.runtime.sendMessage({ target: 'offscreen', type: 'stats' }));
}

export async function tabStates(
  h: Harness,
): Promise<Record<string, { volume: number; captured: boolean }>> {
  return h.worker.evaluate(
    async () => ((await chrome.storage.session.get('tabs')).tabs ?? {}) as never,
  );
}

/** Localized string as the extension sees it (the browser UI language decides en/es). */
export function msg(page: Page, key: string, sub?: string): Promise<string> {
  return page.evaluate(([k, s]) => chrome.i18n.getMessage(k as string, s), [key, sub] as const);
}
