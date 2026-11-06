import { type SetVolumeResult, sendToBackground } from './lib/messages.ts';
import {
  getInvokedTabs,
  getSettings,
  getTabStates,
  onInvokedTabsChanged,
  onSettingsChanged,
  onTabStatesChanged,
  type Settings,
  saveSettings,
  type TabStateMap,
  type Theme,
} from './lib/storage.ts';
import {
  displayHost,
  fallbackLetter,
  groupTabs,
  isRestrictedUrl,
  matchesQuery,
  safeFavicon,
  windowNumbers,
} from './lib/tabs.ts';
import {
  clampVolume,
  DEFAULT_VOLUME,
  isBoosted,
  LARGE_STEP,
  MAX_VOLUME,
  maxVolume,
  parseVolumeInput,
  SMALL_STEP,
  stepVolume,
} from './lib/volume.ts';

type Tab = chrome.tabs.Tab & { id: number };
type RowState = 'ready' | 'locked' | 'restricted' | 'failed';

const SEARCH_THRESHOLD = 7;

const t = (key: string, sub?: string | number): string =>
  chrome.i18n.getMessage(key, sub === undefined ? undefined : String(sub)) || key;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let settings: Settings;
let tabStates: TabStateMap = {};
let invoked = new Set<number>();
let tabs: Tab[] = [];
let currentTabId: number | undefined;
let query = '';
let othersOpen = false;
/** Rows that failed to capture in this popup session, with the reason. */
const failures = new Map<number, RowState>();
/** Whether the user allowed site access, which lets us control tabs they never visited. */
let siteAccess = false;
const ALL_SITES: chrome.permissions.Permissions = { origins: ['<all_urls>'] };

// ---------------------------------------------------------------------------
// Static text, theme
// ---------------------------------------------------------------------------
function localize(root: ParentNode): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n as string);
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-label]')) {
    const label = t(el.dataset.i18nLabel as string);
    el.setAttribute('aria-label', label);
    el.title = label;
  }
  for (const el of root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]')) {
    el.placeholder = t(el.dataset.i18nPlaceholder as string);
  }
}

function applyTheme(theme: Theme): void {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------
interface Row {
  el: HTMLLIElement;
  tabId: number;
  slider: HTMLInputElement;
  sliderWrap: HTMLElement;
  valueInput: HTMLInputElement;
  title: HTMLButtonElement;
  titleText: HTMLElement;
  img: HTMLImageElement;
  letter: HTMLElement;
  host: HTMLElement;
  tags: HTMLElement;
  mute: HTMLButtonElement;
  notice: HTMLElement;
  noticeText: HTMLElement;
  hint: HTMLElement;
  /** Volume shown locally while the user interacts; storage updates must not fight it. */
  localVolume: number | null;
  dragging: boolean;
  inflight: boolean;
  pending: number | null;
  faviconSrc: string | null;
}

const OWN_PAGES = chrome.runtime.getURL('');

const rows = new Map<number, Row>();
const template = $<HTMLTemplateElement>('row-template');

function createRow(tabId: number): Row {
  const el = (template.content.firstElementChild as HTMLLIElement).cloneNode(true) as HTMLLIElement;
  localize(el);
  const q = <T extends HTMLElement>(sel: string) => el.querySelector(sel) as T;
  const row: Row = {
    el,
    tabId,
    slider: q('.slider'),
    sliderWrap: q('.slider-wrap'),
    valueInput: q('.value-input'),
    title: q('.row-title'),
    titleText: q('.row-title-text'),
    img: q('.favicon img'),
    letter: q('.favicon-letter'),
    host: q('.host'),
    tags: q('.tags'),
    mute: q('.mute-btn'),
    notice: q('.row-notice'),
    noticeText: q('.notice-text'),
    hint: q('.row-hint'),
    localVolume: null,
    dragging: false,
    inflight: false,
    pending: null,
    // Sentinel that never matches a real value, so the first update always sets the favicon.
    faviconSrc: '\u0000',
  };
  el.dataset.tabId = String(tabId);
  row.valueInput.setAttribute('aria-label', t('editVolume'));
  row.img.addEventListener('error', () => {
    row.img.hidden = true;
    row.letter.hidden = false;
  });
  bindRow(row);
  rows.set(tabId, row);
  return row;
}

function bindRow(row: Row): void {
  const { slider, valueInput } = row;

  slider.addEventListener('pointerdown', () => {
    row.dragging = true;
  });
  const endDrag = () => {
    if (!row.dragging) return;
    row.dragging = false;
    scheduleRender();
  };
  slider.addEventListener('pointerup', endDrag);
  slider.addEventListener('pointercancel', endDrag);
  slider.addEventListener('change', endDrag);

  slider.addEventListener('input', () => requestVolume(row, Number(slider.value)));

  slider.addEventListener('keydown', (event) => {
    const keys: Record<string, 1 | -1> = {
      ArrowUp: 1,
      ArrowRight: 1,
      ArrowDown: -1,
      ArrowLeft: -1,
    };
    const direction = keys[event.key];
    if (direction && event.shiftKey) {
      event.preventDefault();
      requestVolume(row, stepVolume(currentVolume(row), direction, LARGE_STEP, settings.boost));
    }
  });

  // Double-click the slider to go back to 100%.
  slider.addEventListener('dblclick', () => requestVolume(row, DEFAULT_VOLUME));

  valueInput.addEventListener('focus', () => valueInput.select());
  valueInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitValueInput(row);
      valueInput.select();
    } else if (event.key === 'Escape') {
      valueInput.value = String(currentVolume(row));
      valueInput.blur();
      event.stopPropagation();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const step = event.shiftKey ? LARGE_STEP : SMALL_STEP;
      requestVolume(
        row,
        stepVolume(currentVolume(row), event.key === 'ArrowUp' ? 1 : -1, step, settings.boost),
      );
      valueInput.select();
    }
  });
  valueInput.addEventListener('blur', () => commitValueInput(row));

  row.mute.addEventListener('click', () => {
    void sendToBackground({ target: 'background', type: 'toggle-mute', tabId: row.tabId });
  });

  const goToTab = async () => {
    const tab = tabs.find((x) => x.id === row.tabId);
    if (!tab) return;
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    window.close();
  };
  row.title.addEventListener('click', goToTab);
  row.el.querySelector('.allow-btn')?.addEventListener('click', () => void requestSiteAccess());
}

function currentVolume(row: Row): number {
  return row.localVolume ?? tabStates[row.tabId]?.volume ?? DEFAULT_VOLUME;
}

function commitValueInput(row: Row): void {
  const parsed = parseVolumeInput(row.valueInput.value, settings.boost);
  if (parsed !== null && parsed !== currentVolume(row)) requestVolume(row, parsed);
  // Always show the value actually applied (e.g. "150" becomes "100" without the booster).
  row.valueInput.value = String(currentVolume(row));
}

/** Updates the row immediately and sends at most one request at a time per tab. */
function requestVolume(row: Row, volume: number): void {
  const next = clampVolume(volume, settings.boost);
  row.localVolume = next;
  paintVolume(row, next);
  row.pending = next;
  if (!row.inflight) void flush(row);
}

async function flush(row: Row): Promise<void> {
  while (row.pending !== null) {
    const volume = row.pending;
    row.pending = null;
    row.inflight = true;
    let result: SetVolumeResult;
    try {
      result = await sendToBackground<SetVolumeResult>({
        target: 'background',
        type: 'set-volume',
        tabId: row.tabId,
        volume,
      });
    } catch {
      result = { ok: false, reason: 'failed' };
    }
    row.inflight = false;
    if (!result.ok) {
      row.pending = null;
      row.localVolume = null;
      failures.set(row.tabId, result.reason === 'not-invoked' ? 'locked' : result.reason);
      scheduleRender();
      return;
    }
    failures.delete(row.tabId);
  }
  // Keep the local value until storage confirms it, then let storage drive the row again.
  if (!row.dragging && (tabStates[row.tabId]?.volume ?? DEFAULT_VOLUME) === row.localVolume) {
    row.localVolume = null;
  }
}

function paintVolume(row: Row, volume: number): void {
  const max = maxVolume(settings.boost);
  row.slider.max = String(max);
  if (Number(row.slider.value) !== volume) row.slider.value = String(volume);
  row.slider.style.setProperty('--fa', String(Math.min(volume, MAX_VOLUME) / max));
  row.slider.style.setProperty('--fb', String(volume / max));
  row.slider.setAttribute('aria-valuetext', t('percentValue', volume));
  row.sliderWrap.dataset.boost = String(settings.boost);
  if (document.activeElement !== row.valueInput) row.valueInput.value = String(volume);
  row.el.dataset.boosted = String(isBoosted(volume));
}

function rowState(tab: Tab): RowState {
  if (isRestrictedUrl(tab.url || tab.pendingUrl)) return 'restricted';
  const failure = failures.get(tab.id);
  if (failure) return failure;
  if (tab.id === currentTabId || tabStates[tab.id]?.captured || invoked.has(tab.id)) return 'ready';
  // With site access, tabs Chrome won't capture are controlled through their media elements.
  if (siteAccess) return 'ready';
  return 'locked';
}

function updateRow(row: Row, tab: Tab, windowLabel: string | null): void {
  const title = tab.title?.trim() || displayHost(tab.url) || t('untitled');
  const host = displayHost(tab.url || tab.pendingUrl);
  const isCurrent = tab.id === currentTabId;
  const muted = Boolean(tab.mutedInfo?.muted);
  const state = rowState(tab);

  row.el.dataset.audible = String(Boolean(tab.audible));
  row.el.dataset.muted = String(muted);
  row.el.dataset.state = state;

  row.titleText.textContent = title;
  row.title.title = isCurrent ? title : `${t('goToTab')}: ${title}`;
  row.title.disabled = isCurrent;
  row.title.querySelector('.go-icon')?.toggleAttribute('hidden', isCurrent);
  row.host.textContent = host;
  row.host.title = tab.url ?? '';

  // Favicon: the tab's own icon when it's a web or data URL, otherwise Chrome's cached favicon.
  const favicon =
    safeFavicon(tab.favIconUrl) ??
    (tab.url && /^https?:/.test(tab.url)
      ? `/_favicon/?pageUrl=${encodeURIComponent(tab.url)}&size=32`
      : null);
  if (favicon !== row.faviconSrc) {
    row.faviconSrc = favicon;
    row.img.hidden = !favicon;
    row.letter.hidden = Boolean(favicon);
    if (favicon) row.img.src = favicon;
  }
  row.letter.textContent = fallbackLetter(tab);

  const tags: string[] = [];
  if (windowLabel) tags.push(windowLabel);
  if (tab.pinned) tags.push(t('pinned'));
  if (tab.incognito) tags.push(t('incognito'));
  if (muted) tags.push(t('muted'));
  const tagKey = tags.join('|');
  if (row.tags.dataset.key !== tagKey) {
    row.tags.dataset.key = tagKey;
    row.tags.replaceChildren(
      ...tags.map((text) => {
        const span = document.createElement('span');
        span.className = 'tag';
        span.textContent = text;
        return span;
      }),
    );
  }

  const muteLabel = muted ? t('unmute') : t('mute');
  row.mute.setAttribute('aria-label', muteLabel);
  row.mute.title = muteLabel;
  row.mute.setAttribute('aria-pressed', String(muted));
  row.slider.setAttribute('aria-label', t('volumeOf', title));

  const noticeKey = {
    ready: '',
    locked: 'notInvoked',
    restricted: 'restricted',
    failed: 'captureFailed',
  }[state];
  row.notice.hidden = !noticeKey;
  if (noticeKey) row.noticeText.textContent = t(noticeKey);
  (row.el.querySelector('.allow-btn') as HTMLElement).hidden = state !== 'locked';

  const stored = tabStates[tab.id];
  const hintKey =
    state !== 'ready' || !stored?.media
      ? ''
      : stored.noMedia
        ? 'noMedia'
        : stored.limited
          ? 'boostLimited'
          : '';
  row.hint.hidden = !hintKey;
  if (hintKey) row.hint.textContent = t(hintKey);

  if (!row.dragging && !row.inflight && row.pending === null) {
    const stored = tabStates[tab.id]?.volume ?? DEFAULT_VOLUME;
    if (row.localVolume !== null && row.localVolume === stored) row.localVolume = null;
  }
  paintVolume(row, currentVolume(row));
}

/** Puts rows in `list` in the given order, moving DOM nodes only when needed (keeps focus). */
function syncList(list: HTMLElement, items: Row[]): void {
  const wanted = new Set<Element>(items.map((r) => r.el));
  for (const child of [...list.children]) {
    if (!wanted.has(child)) child.remove();
  }
  items.forEach((row, index) => {
    if (list.children[index] !== row.el) list.insertBefore(row.el, list.children[index] ?? null);
  });
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
let renderQueued = false;

function scheduleRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function render(): void {
  // Never rebuild under a dragging pointer; the drag end triggers a new render.
  if ([...rows.values()].some((r) => r.dragging)) return;

  const adjusted = new Set(
    Object.entries(tabStates)
      .filter(([, s]) => s.volume !== DEFAULT_VOLUME)
      .map(([id]) => Number(id)),
  );
  const groups = groupTabs(tabs, currentTabId, adjusted);
  const windows = windowNumbers(tabs);
  const multiWindow = windows.size > 1;
  const label = (tab: Tab) => (multiWindow ? t('windowN', windows.get(tab.windowId) ?? 1) : null);

  const searchable = tabs.length >= SEARCH_THRESHOLD;
  $('search-wrap').hidden = !searchable;
  const activeQuery = searchable ? query : '';
  const visible = (tab: Tab) => matchesQuery(tab, activeQuery);

  const seen = new Set<number>();
  const toRows = (list: Tab[]) =>
    list.filter(visible).map((tab) => {
      seen.add(tab.id);
      const row = rows.get(tab.id) ?? createRow(tab.id);
      updateRow(row, tab, label(tab));
      return row;
    });

  const currentRows = groups.current ? toRows([groups.current]) : [];
  const playingRows = toRows(groups.playing);
  const otherRows = toRows(groups.others);

  syncList($('current'), currentRows);
  syncList($('playing'), playingRows);
  syncList($('others'), otherRows);

  for (const [id, row] of rows) {
    if (!seen.has(id)) {
      row.el.remove();
      rows.delete(id);
    }
  }

  const searching = activeQuery.trim().length > 0;
  $('current-section').hidden = currentRows.length === 0;
  $('playing-section').hidden = searching && playingRows.length === 0;
  $('playing-count').textContent = playingRows.length ? String(playingRows.length) : '';
  $('playing-empty').hidden = playingRows.length > 0;
  $('others-section').hidden = otherRows.length === 0;
  $('others-count').textContent = String(otherRows.length);

  const othersExpanded = othersOpen || searching;
  $('others-toggle').setAttribute('aria-expanded', String(othersExpanded));
  $('others').hidden = !othersExpanded;

  const nothing = searching && currentRows.length + playingRows.length + otherRows.length === 0;
  $('no-results').hidden = !nothing;
  if (nothing) $('no-results').textContent = t('noResults', activeQuery.trim());
}

// ---------------------------------------------------------------------------
// Data loading and live updates
// ---------------------------------------------------------------------------
async function reloadTabs(): Promise<void> {
  const all = await chrome.tabs.query({});
  // Our own pages (e.g. the popup opened as a tab) are never worth listing.
  tabs = all.filter(
    (tab): tab is Tab =>
      tab.id !== undefined &&
      tab.id !== chrome.tabs.TAB_ID_NONE &&
      !(tab.url ?? tab.pendingUrl ?? '').startsWith(OWN_PAGES),
  );
  scheduleRender();
}

let reloadTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleReload(): void {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => void reloadTabs(), 60);
}

function watchTabs(): void {
  const relevant: Array<keyof chrome.tabs.OnUpdatedInfo> = [
    'title',
    'url',
    'favIconUrl',
    'audible',
    'mutedInfo',
    'pinned',
    'status',
  ];
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.url) failures.delete(tabId);
    if (relevant.some((key) => key in info)) scheduleReload();
  });
  chrome.permissions.onAdded.addListener(() => {
    void chrome.permissions.contains(ALL_SITES).then(setSiteAccess);
  });
  chrome.permissions.onRemoved.addListener(() => {
    void chrome.permissions.contains(ALL_SITES).then(setSiteAccess);
  });
  chrome.tabs.onCreated.addListener(scheduleReload);
  chrome.tabs.onRemoved.addListener(scheduleReload);
  chrome.tabs.onMoved.addListener(scheduleReload);
  chrome.tabs.onAttached.addListener(scheduleReload);
  chrome.tabs.onDetached.addListener(scheduleReload);
  chrome.tabs.onReplaced.addListener(scheduleReload);

  onTabStatesChanged((next) => {
    tabStates = next;
    scheduleRender();
  });
  onInvokedTabsChanged((next) => {
    invoked = next;
    scheduleRender();
  });
  onSettingsChanged((next) => {
    settings = next;
    applyTheme(next.theme);
    syncSettingsForm();
    scheduleRender();
  });
}

// ---------------------------------------------------------------------------
// Settings view
// ---------------------------------------------------------------------------
function showView(view: 'tabs' | 'settings'): void {
  $('app').dataset.view = view;
  $('view-tabs').hidden = view !== 'tabs';
  $('header-tabs').hidden = view !== 'tabs';
  $('view-settings').hidden = view !== 'settings';
  $('header-settings').hidden = view !== 'settings';
  if (view === 'settings') {
    void renderShortcuts();
    $('close-settings').focus();
  } else {
    $('open-settings').focus();
  }
}

/** Must run straight from a click: the browser only shows the prompt for a user gesture. */
async function requestSiteAccess(): Promise<boolean> {
  const granted = await chrome.permissions.request(ALL_SITES).catch(() => false);
  setSiteAccess(granted);
  return granted;
}

function setSiteAccess(granted: boolean): void {
  siteAccess = granted;
  if (granted) {
    for (const [id, reason] of failures) if (reason === 'locked') failures.delete(id);
  }
  syncSettingsForm();
  scheduleRender();
}

function syncSettingsForm(): void {
  for (const [id, on] of [
    ['setting-boost', settings.boost],
    ['setting-badge', settings.badge],
    ['setting-free', siteAccess],
  ] as const) {
    const input = $<HTMLInputElement>(id);
    input.checked = on;
    input.setAttribute('aria-checked', String(on));
  }
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="theme"]')) {
    radio.checked = radio.value === settings.theme;
  }
}

async function renderShortcuts(): Promise<void> {
  const order = ['_execute_action', 'volume-up', 'volume-down', 'toggle-mute'];
  const commands = (await chrome.commands.getAll()).sort(
    (a, b) => order.indexOf(a.name ?? '') - order.indexOf(b.name ?? ''),
  );
  const list = $('shortcuts');
  list.replaceChildren();
  for (const command of commands) {
    const description = command.name === '_execute_action' ? t('cmdOpen') : command.description;
    if (!description) continue;
    const dt = document.createElement('dt');
    dt.textContent = description;
    const dd = document.createElement('dd');
    const kbd = document.createElement('kbd');
    kbd.textContent = command.shortcut || '—';
    dd.append(kbd);
    list.append(dt, dd);
  }
}

function bindSettings(): void {
  $('open-settings').addEventListener('click', () => showView('settings'));
  $('close-settings').addEventListener('click', () => showView('tabs'));

  $<HTMLInputElement>('setting-boost').addEventListener('change', (event) => {
    void saveSettings({ boost: (event.target as HTMLInputElement).checked });
  });
  $<HTMLInputElement>('setting-free').addEventListener('change', async (event) => {
    if ((event.target as HTMLInputElement).checked) {
      await requestSiteAccess();
      return;
    }
    // Put media-controlled tabs back to 100% while we can still reach them.
    await sendToBackground({ target: 'background', type: 'release-media' });
    const removed = await chrome.permissions.remove(ALL_SITES).catch(() => false);
    setSiteAccess(!removed);
  });
  $<HTMLInputElement>('setting-badge').addEventListener('change', (event) => {
    void saveSettings({ badge: (event.target as HTMLInputElement).checked });
  });
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="theme"]')) {
    radio.addEventListener('change', () => {
      applyTheme(radio.value as Theme);
      void saveSettings({ theme: radio.value as Theme });
    });
  }
  $('customize-shortcuts').addEventListener('click', () => {
    void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });
  $('reset-all').addEventListener('click', async () => {
    await sendToBackground({ target: 'background', type: 'reset-all' });
    failures.clear();
    $('reset-status').textContent = t('resetDone');
  });

  const manifest = chrome.runtime.getManifest();
  $('version').textContent = t('version', manifest.version_name ?? manifest.version);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  document.documentElement.lang = chrome.i18n.getUILanguage();
  localize(document);

  const [settingsValue, states, invokedValue, [active], access] = await Promise.all([
    getSettings(),
    getTabStates(),
    getInvokedTabs(),
    chrome.tabs.query({ active: true, currentWindow: true }),
    chrome.permissions.contains(ALL_SITES).catch(() => false),
  ]);
  settings = settingsValue;
  siteAccess = access;
  tabStates = states;
  invoked = invokedValue;
  // `?tab=<id>` lets tests and screenshots open the popup as a page for a given tab.
  const forced = Number(new URLSearchParams(location.search).get('tab'));
  currentTabId = Number.isInteger(forced) && forced > 0 ? forced : active?.id;
  applyTheme(settings.theme);
  syncSettingsForm();

  if (currentTabId !== undefined) {
    // Opening the popup grants access to this tab; remember it so it stays controllable.
    invoked.add(currentTabId);
    void sendToBackground({ target: 'background', type: 'popup-opened', tabId: currentTabId });
  }

  bindSettings();
  $('others-toggle').addEventListener('click', () => {
    othersOpen = !othersOpen;
    render();
  });
  $<HTMLInputElement>('search').addEventListener('input', (event) => {
    query = (event.target as HTMLInputElement).value;
    render();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && $('app').dataset.view === 'settings') {
      event.preventDefault();
      showView('tabs');
    }
  });

  watchTabs();
  await reloadTabs();
  render();
}

void main();
