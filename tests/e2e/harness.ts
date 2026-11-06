import { createHash, generateKeyPairSync } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type BrowserContext, chromium, type Page, type Worker } from '@playwright/test';
import type { TabStateMap } from '../../src/lib/storage.ts';

/** Copies dist/ and pins a generated key so the extension id is known before launch. */
function prepareExtension(siteAccess: boolean): { dir: string; id: string } {
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
  // The optional site access can't be granted from a test (it needs a click on a browser
  // prompt), so tests that need it get it at install time instead.
  if (siteAccess) manifest.host_permissions = ['<all_urls>'];
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return { dir, id };
}

export interface Harness {
  context: BrowserContext;
  extensionId: string;
  worker: Worker;
  baseUrl: string;
  /** Same server on another origin, for cross-origin media. */
  otherOrigin: string;
  close: () => Promise<void>;
}

/** One second of a 440 Hz sine as 8 kHz mono 16-bit WAV, for <audio> fixtures. */
function toneWav(): Buffer {
  const rate = 8000;
  const samples = rate;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 0.25 * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

export interface LaunchOptions {
  locale?: string;
  colorScheme?: 'light' | 'dark';
  /**
   * Lets tabCapture work on any tab, as if the user had opened the extension everywhere.
   * Turn it off to behave like a real user who never visited the tab.
   */
  captureEverywhere?: boolean;
  /** Grants the optional "control tabs without visiting them" site access. */
  siteAccess?: boolean;
}

export async function launch(options: LaunchOptions = {}): Promise<Harness> {
  const { dir, id } = prepareExtension(options.siteAccess ?? false);
  const html = readFileSync('tests/fixtures/audio-page.html');
  const mediaHtml = readFileSync('tests/fixtures/media-page.html');
  const wav = toneWav();
  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (path === '/tone.wav') {
      res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': wav.length });
      res.end(wav);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(path === '/media' ? mediaHtml : html);
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
      ...(options.captureEverywhere === false ? [] : [`--allowlisted-extension-id=${id}`]),
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
    otherOrigin: `http://localhost:${port}`,
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

export async function tabStates(h: Harness): Promise<TabStateMap> {
  return h.worker.evaluate(
    async () => ((await chrome.storage.session.get('tabs')).tabs ?? {}) as never,
  );
}

/** Localized string as the extension sees it (the browser UI language decides en/es). */
export function msg(page: Page, key: string, sub?: string): Promise<string> {
  return page.evaluate(([k, s]) => chrome.i18n.getMessage(k as string, s), [key, sub] as const);
}

/** Opens a page playing a looping <audio>; `src` defaults to a same-origin file. */
export async function openMedia(
  h: Harness,
  title: string,
  src = '/tone.wav',
): Promise<{ page: Page; tabId: number; volume: () => Promise<number> }> {
  const page = await h.context.newPage();
  await page.goto(
    `${h.baseUrl}/media?title=${encodeURIComponent(title)}&src=${encodeURIComponent(src)}`,
  );
  await page.waitForFunction(() => !(document.querySelector('audio') as HTMLAudioElement).paused);
  const tabId = await h.worker.evaluate(
    async (t) => (await chrome.tabs.query({ title: t }))[0]?.id ?? -1,
    title,
  );
  const volume = () =>
    page.evaluate(() => (document.querySelector('audio') as HTMLAudioElement).volume);
  return { page, tabId, volume };
}
