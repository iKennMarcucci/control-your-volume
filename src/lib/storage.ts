/** Settings live in storage.sync (follow the user across devices); per-tab state in storage.session. */

export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
  /** Allows volumes above 100%, up to 200%. Off by default. */
  boost: boolean;
  /** Shows the current tab volume on the toolbar icon. */
  badge: boolean;
  theme: Theme;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = { boost: false, badge: true, theme: 'system' };

export interface TabAudioState {
  volume: number;
  /** True while the offscreen document holds a capture stream for the tab. */
  captured: boolean;
}

export type TabStateMap = Record<string, TabAudioState>;

const SETTINGS_KEY = 'settings';
const TABS_KEY = 'tabs';
const INVOKED_KEY = 'invoked';

export function normalizeSettings(value: unknown): Settings {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<Settings>;
  return {
    boost: typeof raw.boost === 'boolean' ? raw.boost : DEFAULT_SETTINGS.boost,
    badge: typeof raw.badge === 'boolean' ? raw.badge : DEFAULT_SETTINGS.badge,
    theme: raw.theme === 'light' || raw.theme === 'dark' ? raw.theme : 'system',
  };
}

export async function getSettings(): Promise<Settings> {
  const data = await chrome.storage.sync.get(SETTINGS_KEY);
  return normalizeSettings(data[SETTINGS_KEY]);
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.sync.set({ [SETTINGS_KEY]: next });
  return next;
}

export function onSettingsChanged(listener: (next: Settings, prev: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    const change = changes[SETTINGS_KEY];
    if (area === 'sync' && change) {
      listener(normalizeSettings(change.newValue), normalizeSettings(change.oldValue));
    }
  });
}

export async function getTabStates(): Promise<TabStateMap> {
  const data = await chrome.storage.session.get(TABS_KEY);
  return (data[TABS_KEY] as TabStateMap | undefined) ?? {};
}

export async function setTabStates(states: TabStateMap): Promise<void> {
  await chrome.storage.session.set({ [TABS_KEY]: states });
}

export function onTabStatesChanged(listener: (states: TabStateMap) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    const change = changes[TABS_KEY];
    if (area === 'session' && change) listener((change.newValue as TabStateMap | undefined) ?? {});
  });
}

/** Tabs where the user invoked the extension, so Chrome lets us capture them. */
export async function getInvokedTabs(): Promise<Set<number>> {
  const data = await chrome.storage.session.get(INVOKED_KEY);
  return new Set((data[INVOKED_KEY] as number[] | undefined) ?? []);
}

export async function setInvokedTabs(ids: Set<number>): Promise<void> {
  await chrome.storage.session.set({ [INVOKED_KEY]: [...ids] });
}

export function onInvokedTabsChanged(listener: (ids: Set<number>) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    const change = changes[INVOKED_KEY];
    if (area === 'session' && change)
      listener(new Set((change.newValue as number[] | undefined) ?? []));
  });
}
