import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  displayHost,
  fallbackLetter,
  groupTabs,
  isRestrictedUrl,
  matchesQuery,
  safeFavicon,
  type TabLike,
  windowNumbers,
} from '../../src/lib/tabs.ts';

const tab = (patch: Partial<TabLike> & { id: number }): TabLike => ({
  windowId: 1,
  index: patch.id,
  active: false,
  pinned: false,
  incognito: false,
  ...patch,
});

describe('isRestrictedUrl', () => {
  it('blocks browser and store pages', () => {
    for (const url of [
      'chrome://settings',
      'edge://extensions',
      'brave://newtab',
      'about:blank',
      'chrome-extension://abc/popup.html',
      'https://chromewebstore.google.com/detail/x',
      'https://chrome.google.com/webstore/category',
      'https://microsoftedge.microsoft.com/addons/detail/x',
      'not a url',
      undefined,
    ]) {
      assert.equal(isRestrictedUrl(url), true, String(url));
    }
  });
  it('allows regular pages', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=1',
      'http://localhost:3000',
      'file:///Users/me/song.mp3',
      'https://chrome.google.com/search',
    ]) {
      assert.equal(isRestrictedUrl(url), false, url);
    }
  });
});

describe('displayHost', () => {
  it('strips www and keeps ports', () => {
    assert.equal(displayHost('https://www.youtube.com/watch'), 'youtube.com');
    assert.equal(displayHost('http://localhost:5173/'), 'localhost:5173');
  });
  it('handles files and special schemes', () => {
    assert.equal(displayHost('file:///Users/me/song.mp3'), 'song.mp3');
    assert.equal(displayHost('chrome://settings'), 'settings');
    assert.equal(displayHost('about:blank'), 'about');
    assert.equal(displayHost(undefined), '');
  });
});

describe('favicons', () => {
  it('only trusts http(s) and data images', () => {
    assert.equal(safeFavicon('https://a.com/f.ico'), 'https://a.com/f.ico');
    assert.equal(safeFavicon('data:image/png;base64,AA'), 'data:image/png;base64,AA');
    assert.equal(safeFavicon('chrome://favicon/x'), null);
    assert.equal(safeFavicon(undefined), null);
  });
  it('builds a fallback letter', () => {
    assert.equal(fallbackLetter({ url: 'https://www.spotify.com' }), 'S');
    assert.equal(fallbackLetter({ title: '¡Hola!', url: undefined }), 'H');
    assert.equal(fallbackLetter({}), '?');
  });
});

describe('groupTabs', () => {
  const tabs = [
    tab({ id: 1, active: true }),
    tab({ id: 2, audible: true }),
    tab({ id: 3 }),
    tab({ id: 4, mutedInfo: { muted: true } }),
    tab({ id: 5, lastAccessed: 50 }),
    tab({ id: 6, windowId: 2, index: 0, audible: true }),
  ];
  it('separates current, playing and other tabs', () => {
    const groups = groupTabs(tabs, 1, new Set([3]));
    assert.equal(groups.current?.id, 1);
    assert.deepEqual(
      groups.playing.map((t) => t.id),
      [2, 6, 3, 4],
    );
    assert.deepEqual(
      groups.others.map((t) => t.id),
      [5],
    );
  });
  it('works when the current tab is unknown', () => {
    const groups = groupTabs(tabs, undefined, new Set());
    assert.equal(groups.current, null);
    assert.equal(groups.playing.length + groups.others.length, tabs.length);
  });
});

describe('windowNumbers and search', () => {
  it('numbers windows in order of appearance', () => {
    const numbers = windowNumbers([tab({ id: 1, windowId: 9 }), tab({ id: 2, windowId: 4 })]);
    assert.equal(numbers.get(9), 1);
    assert.equal(numbers.get(4), 2);
  });
  it('matches title and host ignoring case and accents', () => {
    const t = { title: 'Canción del día', url: 'https://music.youtube.com/watch' };
    assert.equal(matchesQuery(t, 'CANCION'), true);
    assert.equal(matchesQuery(t, 'youtube'), true);
    assert.equal(matchesQuery(t, 'spotify'), false);
    assert.equal(matchesQuery(t, '  '), true);
  });
});
