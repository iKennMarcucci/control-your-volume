# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [semver](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/iKennMarcucci/control-your-volume/compare/v1.0.0-alpha.1...HEAD
[1.0.0-alpha.1]: https://github.com/iKennMarcucci/control-your-volume/releases/tag/v1.0.0-alpha.1
