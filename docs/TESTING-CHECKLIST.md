# Manual testing checklist

Run this before every beta, release candidate and stable release, on **macOS** and **Windows**, in at least two Chromium browsers (for example Chrome + Brave on macOS, Chrome + Edge on Windows). Automated tests cover the logic. This list covers what only a real browser, real speakers and a real person can confirm.

Record results in the release PR or issue as: `browser + version / OS / ✅ or ❌ + note`.

## Setup

- [ ] Remove any older copy of the extension, then load the release `.zip` (unzipped) with **Load unpacked**.
- [ ] `chrome://extensions` shows the right version (for example `1.0.0-beta.1`) and no errors.
- [ ] Pin the extension to the toolbar. The icon is crisp in light and dark browser themes.

## Basic volume

Open YouTube (or any video), Spotify Web or SoundCloud, and a third site with audio.

- [ ] Open the popup on the video tab. It appears under **This tab** with the right favicon, title and site.
- [ ] Drag the slider to about 30%. The audio gets quieter right away, without clicks or stutter.
- [ ] The browser shows the tab as being shared. That's expected.
- [ ] Type `55` in the value box and press Enter. The volume changes and the box shows `55`.
- [ ] Double-click the slider. It goes back to 100%, and after about a second the "shared" indicator disappears.
- [ ] Arrows move 1%, Shift+arrows move 10%, and Tab moves focus in a logical order.

## Several tabs

- [ ] Open the popup on tab A and set it to 40%. Switch to tab B and set it to 80%. Each tab keeps its own level.
- [ ] Open the popup on tab C. Tabs A and B appear under **Playing audio** and can be adjusted from there.
- [ ] A tab you haven't opened the popup on shows **Go to tab**. Clicking it switches to that tab. After you reopen the popup there, it can be controlled.
- [ ] With 2+ browser windows, rows show **Window N** tags that match the windows.
- [ ] A tab that navigates to another site keeps working, or asks for a visit again.

## Booster

- [ ] By default the slider stops at 100% and typing `150` gives 100.
- [ ] Turn on **Volume booster** in Settings. The slider goes to 200% and shows a tick at 100%.
- [ ] At 150–200% the audio is louder, the slider and value turn amber, and loud music doesn't crackle badly.
- [ ] Turn the booster off. Every boosted tab drops back to 100%.

## Mute, badge, shortcuts

- [ ] The mute button mutes and unmutes the tab, and the speaker icon on the browser tab agrees.
- [ ] The toolbar badge shows the volume (for example `40`) only on tabs that aren't at 100%. Turning **Show volume on icon** off hides it.
- [ ] <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> change the current tab by 10% (⌥⇧ on macOS), <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> toggles mute and <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> opens the popup. If a shortcut clashes with another app, **Customize** opens the shortcuts page.

## Edge cases

- [ ] A `chrome://` / `edge://` / `brave://` page explains that the browser doesn't allow it. Mute still works.
- [ ] Close a tab whose volume you changed. Nothing breaks and the row disappears.
- [ ] Fullscreen a video at 50%. It stays inside the window (known limitation) and the audio stays at 50%.
- [ ] Restart the browser. Everything starts at 100% with no stale state.
- [ ] With 10+ tabs, search finds tabs by title and by site, including accents.

## Look and language

- [ ] Light, dark and system themes look right. Text is readable and focus rings are visible.
- [ ] With the browser in Spanish, all text is in Spanish. In any other language, it's in English.
- [ ] Long titles are truncated cleanly, and hovering shows the full title.
- [ ] On Windows at 125% and 150% display scaling, the popup isn't cut off or blurry.
