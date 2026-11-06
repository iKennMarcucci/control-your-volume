/** Typed messages exchanged between the popup, the service worker and the offscreen document. */

export type CaptureError = 'not-invoked' | 'restricted' | 'failed';

export type SetVolumeResult = { ok: true; volume: number } | { ok: false; reason: CaptureError };

export type BackgroundRequest =
  | { target: 'background'; type: 'popup-opened'; tabId: number }
  | { target: 'background'; type: 'set-volume'; tabId: number; volume: number }
  | { target: 'background'; type: 'reset-all' }
  | { target: 'background'; type: 'capture-ended'; tabId: number };

export type OffscreenRequest =
  | { target: 'offscreen'; type: 'start'; tabId: number; streamId: string; volume: number }
  | { target: 'offscreen'; type: 'set'; tabId: number; volume: number }
  | { target: 'offscreen'; type: 'stop'; tabId: number }
  | { target: 'offscreen'; type: 'stats' };

export type OffscreenResult = { ok: true } | { ok: false; error: string };

export interface ChainStats {
  tabId: number;
  gain: number;
  limiter: boolean;
  /** Root mean square of the processed signal, 0..1. */
  rms: number;
  context: AudioContextState;
}

export function sendToBackground<T>(message: BackgroundRequest): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}
