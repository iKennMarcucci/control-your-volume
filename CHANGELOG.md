# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [semver](https://semver.org/).

## [Unreleased]

### Changed

- Volume now follows perceived loudness: 50% sounds half as loud (-10 dB) and 200% about twice as loud (+10 dB). Before, 50% only lowered the signal by 6 dB and 200% raised it by 6 dB, which most people hear as about two thirds and barely louder.
- New limiter above 100%, shared by both engines. It never clips, it never makes a tab quieter than at 100%, and free control now uses it too (before, boosting a `<video>`/`<audio>` had no limiter).

### Fixed

- The popup could take a long time to open. It loaded each tab's icon from the site itself, a network request per open tab every time. Icons now come from the browser's cache, all startup data loads in one parallel step, and a test keeps the popup under 400 ms with 60 tabs and no network requests.
- A tab that started playing while the popup was opening could stay under **Other tabs**.
- The popup kept stale rows if the browser paused animation frames.

## [1.0.0-beta.1] - 2026-11-06

First beta. Same features as 1.0.0-alpha.2.

### Changed

- Passed the manual testing checklist on macOS (Brave) and Windows.

## [1.0.0-alpha.2] - 2026-11-06

### Added

- **Control tabs without visiting them** (optional, in Settings). With site access, tabs you never opened the extension on are adjusted through their `<video>`/`<audio>` elements, without the "shared" indicator. Tabs you did open it on keep using capture. Rows explain when a site can't go above 100% or has no media to adjust.
- Rows for tabs that can't be controlled yet offer an **Allow** button instead of **Go to tab**.

### Fixed

- Muting a tab whose volume isn't 100% now silences it. While a tab is captured its sound plays from the extension, so the browser's mute alone didn't reach it.
- The mute button and the mute shortcut now silence the captured audio immediately instead of waiting for the browser's tab event.

## [1.0.0-alpha.1] - 2026-11-06

First public alpha.

### Added

- Per-tab volume from 0% to 100% using `tabCapture` and an offscreen Web Audio graph.
- Optional booster up to 200% (off by default) with a limiter above 100%. Turning it off brings boosted tabs back to 100%.
- Popup showing the current tab, tabs playing audio and other tabs, with favicon, title, site, window number, pinned/muted/incognito tags and a playing indicator.
- Search when 7 or more tabs are open.
- Keyboard control: arrows, Shift+arrows, typing an exact value, double-click to reset.
- Global shortcuts to raise, lower or mute the current tab and to open the popup.
- Toolbar badge with the current tab's volume.
- Settings: booster, badge, theme (system/light/dark), shortcuts, reset all.
- English and Spanish.
- Capture is released automatically when a tab goes back to 100%.

[Unreleased]: https://github.com/iKennMarcucci/control-your-volume/compare/v1.0.0-beta.1...HEAD
[1.0.0-beta.1]: https://github.com/iKennMarcucci/control-your-volume/compare/v1.0.0-alpha.2...v1.0.0-beta.1
[1.0.0-alpha.2]: https://github.com/iKennMarcucci/control-your-volume/compare/v1.0.0-alpha.1...v1.0.0-alpha.2
[1.0.0-alpha.1]: https://github.com/iKennMarcucci/control-your-volume/releases/tag/v1.0.0-alpha.1
