# Privacy policy

_Last updated: 2026-11-06_

Control Your Volume! does not collect, store, sell or send any personal data.

- **Audio** from a tab is processed only in memory, inside your browser, to change its volume. It's never recorded, saved or sent anywhere.
- **Tab titles, addresses and icons** are read only to show them in the popup. They never leave your device.
- **Settings** (booster, badge, theme) are saved with `chrome.storage.sync`. If you turned on browser sync, your browser syncs them to your other devices.
- **Per-tab volumes** live in `chrome.storage.session` and are cleared when the browser closes.
- The extension makes **no network requests**, has no analytics and asks for no host permissions.

## Permissions

| Permission   | Why                                                              |
| ------------ | ---------------------------------------------------------------- |
| `tabCapture` | Capture a tab's audio to change its volume.                      |
| `offscreen`  | Run the audio processing in a hidden extension page.             |
| `tabs`       | Show each tab's title, site and icon so you can tell them apart. |
| `storage`    | Remember your settings and each tab's volume.                    |
| `favicon`    | Show site icons from the browser's own cache.                    |

Questions: open an issue at https://github.com/iKennMarcucci/control-your-volume/issues.
