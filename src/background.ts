import type {
  BackgroundRequest,
  CaptureError,
  OffscreenRequest,
  OffscreenResult,
  SetVolumeResult,
} from './lib/messages.ts';
import {
  getInvokedTabs,
  getSettings,
  getTabStates,
  onSettingsChanged,
  setInvokedTabs,
  setTabStates,
  type TabAudioState,
  type TabStateMap,
} from './lib/storage.ts';
import { isRestrictedUrl } from './lib/tabs.ts';
import {
  badgeText,
  clampVolume,
  DEFAULT_VOLUME,
  isBoosted,
  LARGE_STEP,
  stepVolume,
} from './lib/volume.ts';

const OFFSCREEN_PATH = 'offscreen.html';
/** Time a tab must stay at 100% before we release its capture (removes the "sharing" indicator). */
const RELEASE_DELAY_MS = 1500;
const BADGE_COLOR = '#0070f3';
const BADGE_BOOST_COLOR = '#f5a524';

// ---------------------------------------------------------------------------
// Serialized state updates: every read-modify-write of storage goes through here.
// ---------------------------------------------------------------------------
let stateQueue: Promise<unknown> = Promise.resolve();

function updateStates(mutate: (states: TabStateMap) => void | Promise<void>): Promise<TabStateMap> {
  const run = stateQueue.then(async () => {
    const states = await getTabStates();
    await mutate(states);
    await setTabStates(states);
    return states;
  });
  stateQueue = run.catch(() => undefined);
  return run;
}

function updateInvoked(mutate: (ids: Set<number>) => void): Promise<void> {
  const run = stateQueue.then(async () => {
    const ids = await getInvokedTabs();
    mutate(ids);
    await setInvokedTabs(ids);
  });
  stateQueue = run.catch(() => undefined);
  return run;
}

// ---------------------------------------------------------------------------
// Offscreen document lifecycle
// ---------------------------------------------------------------------------
let creatingOffscreen: Promise<void> | null = null;

async function hasOffscreen(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  });
  return contexts.length > 0;
}

async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreen()) return;
  creatingOffscreen ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: 'Process captured tab audio to change its volume.',
    })
    .finally(() => {
      creatingOffscreen = null;
    });
  await creatingOffscreen;
}

async function closeOffscreenIfIdle(): Promise<void> {
  const states = await getTabStates();
  if (Object.values(states).some((s) => s.captured)) return;
  if (await hasOffscreen()) await chrome.offscreen.closeDocument().catch(() => undefined);
}

async function sendToOffscreen(message: OffscreenRequest): Promise<OffscreenResult> {
  if (!(await hasOffscreen())) return { ok: false, error: 'offscreen-missing' };
  try {
    return (
      ((await chrome.runtime.sendMessage(message)) as OffscreenResult | undefined) ?? {
        ok: false,
        error: 'no-response',
      }
    );
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------
async function refreshBadge(tabId: number, volume: number): Promise<void> {
  const { badge } = await getSettings();
  const text = badge ? badgeText(volume) : '';
  await chrome.action.setBadgeText({ tabId, text }).catch(() => undefined);
  if (text) {
    const color = isBoosted(volume) ? BADGE_BOOST_COLOR : BADGE_COLOR;
    await chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => undefined);
    if (chrome.action.setBadgeTextColor) {
      await chrome.action.setBadgeTextColor({ tabId, color: '#ffffff' }).catch(() => undefined);
    }
  }
}

async function refreshAllBadges(): Promise<void> {
  const states = await getTabStates();
  await Promise.all(Object.entries(states).map(([id, s]) => refreshBadge(Number(id), s.volume)));
}

// ---------------------------------------------------------------------------
// Volume
// ---------------------------------------------------------------------------
const releaseTimers = new Map<number, ReturnType<typeof setTimeout>>();
const tabChains = new Map<number, Promise<unknown>>();
const latestRequest = new Map<number, number>();
let requestCounter = 0;

function classifyCaptureError(error: unknown): CaptureError {
  const message = error instanceof Error ? error.message : String(error);
  if (/invoked|activeTab|permission/i.test(message)) return 'not-invoked';
  if (/chrome pages|cannot be captured/i.test(message)) return 'restricted';
  return 'failed';
}

async function startCapture(tabId: number, volume: number): Promise<SetVolumeResult> {
  let streamId: string;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  } catch (error) {
    const reason = classifyCaptureError(error);
    if (reason === 'not-invoked') await updateInvoked((ids) => ids.delete(tabId));
    return { ok: false, reason };
  }
  await ensureOffscreen();
  const result = await sendToOffscreen({
    target: 'offscreen',
    type: 'start',
    tabId,
    streamId,
    volume,
  });
  if (!result.ok) {
    console.warn('[cyv] capture failed', tabId, result.error);
    return { ok: false, reason: 'failed' };
  }
  await updateInvoked((ids) => ids.add(tabId));
  return { ok: true, volume };
}

async function stopCapture(tabId: number): Promise<void> {
  clearTimeout(releaseTimers.get(tabId));
  releaseTimers.delete(tabId);
  await sendToOffscreen({ target: 'offscreen', type: 'stop', tabId });
}

async function applyVolume(tabId: number, requested: number): Promise<SetVolumeResult> {
  const { boost } = await getSettings();
  const volume = clampVolume(requested, boost);

  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return { ok: false, reason: 'failed' };
  }
  if (isRestrictedUrl(tab.url || tab.pendingUrl)) return { ok: false, reason: 'restricted' };

  clearTimeout(releaseTimers.get(tabId));
  releaseTimers.delete(tabId);

  const current: TabAudioState | undefined = (await getTabStates())[tabId];
  let captured = current?.captured ?? false;

  if (captured) {
    const result = await sendToOffscreen({ target: 'offscreen', type: 'set', tabId, volume });
    // The offscreen document may have been closed or crashed: start over.
    if (!result.ok) captured = false;
  }
  if (!captured && volume !== DEFAULT_VOLUME) {
    const result = await startCapture(tabId, volume);
    if (!result.ok) return result;
    captured = true;
  }

  await updateStates((states) => {
    if (volume === DEFAULT_VOLUME && !captured) delete states[tabId];
    else states[tabId] = { volume, captured };
  });
  await refreshBadge(tabId, volume);

  if (captured && volume === DEFAULT_VOLUME) scheduleRelease(tabId);
  return { ok: true, volume };
}

function scheduleRelease(tabId: number): void {
  releaseTimers.set(
    tabId,
    setTimeout(async () => {
      releaseTimers.delete(tabId);
      const state = (await getTabStates())[tabId];
      if (!state || state.volume !== DEFAULT_VOLUME) return;
      await stopCapture(tabId);
      await updateStates((states) => {
        delete states[tabId];
      });
      await closeOffscreenIfIdle();
    }, RELEASE_DELAY_MS),
  );
}

/**
 * Requests for the same tab run one after another; if several arrive while one is in flight
 * (dragging a slider), only the most recent one is applied.
 */
function setVolume(tabId: number, volume: number): Promise<SetVolumeResult> {
  const id = ++requestCounter;
  latestRequest.set(tabId, id);
  const run = (): Promise<SetVolumeResult> =>
    latestRequest.get(tabId) === id
      ? applyVolume(tabId, volume)
      : Promise.resolve({ ok: true, volume });
  const next = (tabChains.get(tabId) ?? Promise.resolve()).then(run, run);
  tabChains.set(
    tabId,
    next.catch(() => undefined),
  );
  return next;
}

async function forgetTab(tabId: number): Promise<void> {
  const state = (await getTabStates())[tabId];
  if (state?.captured) await stopCapture(tabId);
  await updateStates((states) => {
    delete states[tabId];
  });
  await updateInvoked((ids) => ids.delete(tabId));
  latestRequest.delete(tabId);
  tabChains.delete(tabId);
  await closeOffscreenIfIdle();
}

async function resetAll(): Promise<void> {
  const states = await getTabStates();
  await Promise.all(
    Object.entries(states).map(async ([id, s]) => {
      const tabId = Number(id);
      if (s.captured) await stopCapture(tabId);
      await chrome.action.setBadgeText({ tabId, text: '' }).catch(() => undefined);
    }),
  );
  await updateStates((all) => {
    for (const key of Object.keys(all)) delete all[key];
  });
  await closeOffscreenIfIdle();
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message: BackgroundRequest, _sender, sendResponse) => {
  if (message?.target !== 'background') return false;
  const respond = (promise: Promise<unknown>) => {
    promise.then(sendResponse, (error) => {
      console.error('[cyv]', error);
      sendResponse({ ok: false, reason: 'failed' });
    });
    return true;
  };
  switch (message.type) {
    case 'popup-opened':
      // Opening the popup grants activeTab on that tab, which is what tabCapture needs.
      return respond(updateInvoked((ids) => ids.add(message.tabId)));
    case 'set-volume':
      return respond(setVolume(message.tabId, message.volume));
    case 'reset-all':
      return respond(resetAll());
    case 'capture-ended':
      return respond(
        updateStates((states) => {
          delete states[message.tabId];
        }).then(() => refreshBadge(message.tabId, DEFAULT_VOLUME)),
      );
    default:
      return false;
  }
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  const tabId = tab?.id;
  if (tabId === undefined) return;
  // Keyboard shortcuts also grant activeTab for the focused tab.
  await updateInvoked((ids) => ids.add(tabId));
  if (command === 'toggle-mute') {
    await chrome.tabs.update(tabId, { muted: !tab?.mutedInfo?.muted });
    return;
  }
  const direction = command === 'volume-up' ? 1 : command === 'volume-down' ? -1 : 0;
  if (!direction) return;
  const { boost } = await getSettings();
  const current = (await getTabStates())[tabId]?.volume ?? DEFAULT_VOLUME;
  await setVolume(tabId, stepVolume(current, direction, LARGE_STEP, boost));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void forgetTab(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // A new document revokes activeTab, so Chrome will refuse new captures until re-invoked.
  if (changeInfo.status === 'loading' && changeInfo.url) {
    void updateInvoked((ids) => ids.delete(tabId));
  }
  if (changeInfo.status === 'complete') {
    void getTabStates().then((states) => {
      const state = states[tabId];
      if (state) void refreshBadge(tabId, state.volume);
    });
  }
});

onSettingsChanged(async (next, prev) => {
  if (prev.boost && !next.boost) {
    const states = await getTabStates();
    await Promise.all(
      Object.entries(states)
        .filter(([, s]) => isBoosted(s.volume))
        .map(([id]) => setVolume(Number(id), 100)),
    );
  }
  if (prev.badge !== next.badge) await refreshAllBadges();
});

chrome.runtime.onStartup.addListener(() => {
  // Captures never survive a browser restart; drop any stale state.
  void chrome.storage.session.clear();
});
