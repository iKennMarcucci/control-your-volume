/** Pure helpers to describe and group tabs. No chrome.* calls here so they stay unit-testable. */

export interface TabLike {
  id?: number | undefined;
  windowId: number;
  index: number;
  title?: string | undefined;
  url?: string | undefined;
  pendingUrl?: string | undefined;
  favIconUrl?: string | undefined;
  audible?: boolean | undefined;
  active: boolean;
  pinned: boolean;
  incognito: boolean;
  mutedInfo?: { muted: boolean } | undefined;
  lastAccessed?: number | undefined;
}

const RESTRICTED_SCHEMES = [
  'chrome:',
  'chrome-extension:',
  'chrome-search:',
  'chrome-untrusted:',
  'devtools:',
  'edge:',
  'brave:',
  'opera:',
  'vivaldi:',
  'arc:',
  'about:',
  'view-source:',
  'extension:',
];

const RESTRICTED_HOSTS: Array<[host: string, pathPrefix: string]> = [
  ['chromewebstore.google.com', '/'],
  ['chrome.google.com', '/webstore'],
  ['microsoftedge.microsoft.com', '/addons'],
  ['addons.opera.com', '/'],
];

/** Pages where Chromium never lets an extension capture audio. */
export function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return true;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }
  if (RESTRICTED_SCHEMES.includes(parsed.protocol)) return true;
  return RESTRICTED_HOSTS.some(
    ([host, prefix]) => parsed.hostname === host && parsed.pathname.startsWith(prefix),
  );
}

/** Short, human readable origin: "youtube.com", "localhost:3000", "file", etc. */
export function displayHost(url: string | undefined): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'file:')
      return parsed.pathname.split('/').filter(Boolean).pop() ?? 'file';
    if (!parsed.host) return parsed.protocol.replace(':', '');
    return parsed.host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Favicons the popup may load. chrome:// favicons fail inside extension pages, so skip them. */
export function safeFavicon(url: string | undefined): string | null {
  if (!url) return null;
  return /^(https?:|data:image\/)/.test(url) ? url : null;
}

/** Letter used when a tab has no usable favicon. */
export function fallbackLetter(tab: Pick<TabLike, 'title' | 'url'>): string {
  const source = displayHost(tab.url) || tab.title || '?';
  const letter = source.replace(/^[^\p{L}\p{N}]+/u, '').charAt(0);
  return (letter || '?').toUpperCase();
}

export interface TabGroups<T extends TabLike> {
  current: T | null;
  playing: T[];
  others: T[];
}

/**
 * Splits tabs into: the tab the popup was opened on, tabs that are making sound or that the
 * user has adjusted (so they never "disappear" while silent), and everything else.
 */
export function groupTabs<T extends TabLike>(
  tabs: T[],
  currentTabId: number | undefined,
  adjusted: ReadonlySet<number>,
): TabGroups<T> {
  let current: T | null = null;
  const playing: T[] = [];
  const others: T[] = [];
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    if (tab.id === currentTabId) current = tab;
    else if (tab.audible || tab.mutedInfo?.muted || adjusted.has(tab.id)) playing.push(tab);
    else others.push(tab);
  }
  const byPosition = (a: T, b: T) => a.windowId - b.windowId || a.index - b.index;
  playing.sort(
    (a, b) => Number(Boolean(b.audible)) - Number(Boolean(a.audible)) || byPosition(a, b),
  );
  others.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0) || byPosition(a, b));
  return { current, playing, others };
}

/** Maps window ids to a stable 1-based number in the order the browser lists them. */
export function windowNumbers(tabs: TabLike[]): Map<number, number> {
  const numbers = new Map<number, number>();
  for (const tab of tabs) {
    if (!numbers.has(tab.windowId)) numbers.set(tab.windowId, numbers.size + 1);
  }
  return numbers;
}

/** Case and accent insensitive search over title and host. */
export function matchesQuery(tab: Pick<TabLike, 'title' | 'url'>, query: string): boolean {
  const normalize = (s: string) =>
    s
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
  const q = normalize(query.trim());
  if (!q) return true;
  return normalize(`${tab.title ?? ''} ${displayHost(tab.url)}`).includes(q);
}
