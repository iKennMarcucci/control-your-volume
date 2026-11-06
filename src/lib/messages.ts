/** Typed messages exchanged between the popup, the service worker and the offscreen document. */

export type CaptureError = 'not-invoked' | 'restricted' | 'failed';

export type SetVolumeResult = { ok: true; volume: number } | { ok: false; reason: CaptureError };

export type BackgroundRequest =
  | { target: 'background'; type: 'popup-opened'; tabId: number }
  | { target: 'background'; type: 'set-volume'; tabId: number; volume: number }
  | { target: 'background'; type: 'toggle-mute'; tabId: number }
  | { target: 'background'; type: 'reset-all' }
  | { target: 'background'; type: 'release-media' }
  | { target: 'background'; type: 'capture-ended'; tabId: number };

export type OffscreenRequest =
  | {
      target: 'offscreen';
      type: 'start';
      tabId: number;
      streamId: string;
      volume: number;
      muted: boolean;
    }
  | { target: 'offscreen'; type: 'set'; tabId: number; volume: number }
  | { target: 'offscreen'; type: 'mute'; tabId: number; muted: boolean }
  | { target: 'offscreen'; type: 'stop'; tabId: number }
  | { target: 'offscreen'; type: 'stats' };

export type OffscreenResult = { ok: true } | { ok: false; error: string };

export interface ChainStats {
  tabId: number;
  gain: number;
  limiter: boolean;
  muted: boolean;
  /** Root mean square of the processed signal, 0..1. */
  rms: number;
  context: AudioContextState;
}

export function sendToBackground<T>(message: BackgroundRequest): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

/** What the media-element engine reports back from each frame. */
export interface MediaResult {
  /** <video>/<audio> elements found. */
  count: number;
  /** Some media couldn't go above 100% (cross-origin, or the page never had a user gesture). */
  limited: boolean;
}

declare global {
  // Installed by media.js in the page's isolated world; called through chrome.scripting.
  var __cyvMedia: { set(volume: number): Promise<MediaResult> } | undefined;
}
