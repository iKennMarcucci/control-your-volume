# Privacy policy

_Last updated: 2026-11-06_

Control Your Volume! does not collect, store, sell or send any personal data.

- **Audio** from a tab is processed only in memory, inside your browser, to change its volume. It's never recorded, saved or sent anywhere.
- **Tab titles, addresses and icons** are read only to show them in the popup. They never leave your device.
- **Settings** (booster, badge, theme) are saved with `chrome.storage.sync`. If you turned on browser sync, your browser syncs them to your other devices.
- **Per-tab volumes** live in `chrome.storage.session` and are cleared when the browser closes.
- The extension makes **no network requests** and has no analytics.
- **Site access is optional.** It's requested only if you turn on **Control tabs without visiting them**. With it, the extension injects a small script into a tab only when you change that tab's volume. The script sets the volume of the page's `<video>` and `<audio>` elements and does nothing else: it doesn't read page content, forms or cookies. Turn the setting off to give the access back.

## Permissions

| Permission                           | Why                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------- |
| `tabCapture`                         | Capture a tab's audio to change its volume.                               |
| `offscreen`                          | Run the audio processing in a hidden extension page.                      |
| `tabs`                               | Show each tab's title, site and icon so you can tell them apart.          |
| `storage`                            | Remember your settings and each tab's volume.                             |
| `favicon`                            | Show site icons from the browser's own cache.                             |
| `scripting`                          | Set the volume of `<video>`/`<audio>` when free control is on.            |
| Site access (optional, `<all_urls>`) | Only with free control: lets the volume script run in the tab you adjust. |

Questions: open an issue at https://github.com/iKennMarcucci/control-your-volume/issues.
