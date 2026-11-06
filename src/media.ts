/**
 * Media-element engine, injected on demand into tabs the extension can't capture (the user
 * never opened it there). It scales every <video>/<audio> on the page:
 * - up to 100% through the element's own volume, so it works on any site;
 * - above 100% through a Web Audio gain, only for media the page can read (same origin, blob:
 *   or CORS). Routing other media through Web Audio would silence it, so those stay at 100%
 *   and the result reports `limited`.
 * Injected into every frame and safe to inject again: the first copy stays in charge.
 */
import type { MediaResult } from './lib/messages.ts';

if (!globalThis.__cyvMedia) {
  let target = 100;
  /** The volume the site itself wants for each element. */
  const base = new WeakMap<HTMLMediaElement, number>();
  /** The volume we last wrote, to tell our own changes apart from the site's. */
  const written = new WeakMap<HTMLMediaElement, number>();
  const gains = new WeakMap<HTMLMediaElement, GainNode>();
  let context: AudioContext | null = null;
  let contextReady = false;

  const write = (el: HTMLMediaElement, volume: number) => {
    const v = Math.min(1, Math.max(0, volume));
    written.set(el, v);
    if (Math.abs(el.volume - v) > 1e-4) el.volume = v;
  };

  const readable = (el: HTMLMediaElement): boolean => {
    if (el.srcObject) return false;
    if (el.crossOrigin !== null) return true;
    const src = el.currentSrc || el.src;
    if (!src) return false;
    try {
      const url = new URL(src, location.href);
      return url.protocol === 'blob:' || url.protocol === 'data:' || url.origin === location.origin;
    } catch {
      return false;
    }
  };

  /** An AudioContext only plays after the page had a user gesture; never route into a mute one. */
  const prepareContext = async (): Promise<boolean> => {
    try {
      context ??= new AudioContext();
      if (context.state !== 'running') {
        await Promise.race([context.resume(), new Promise((r) => setTimeout(r, 300))]);
      }
      contextReady = context.state === 'running';
    } catch {
      contextReady = false;
    }
    return contextReady;
  };

  /** Applies the target to one element. Returns true when it couldn't go above 100%. */
  const apply = (el: HTMLMediaElement): boolean => {
    if (!base.has(el)) base.set(el, el.volume);
    const own = base.get(el) ?? 1;
    const factor = target / 100;
    let gain = gains.get(el);
    if (!gain && factor > 1 && context && contextReady && readable(el)) {
      try {
        gain = context.createGain();
        context.createMediaElementSource(el).connect(gain).connect(context.destination);
        gains.set(el, gain);
      } catch {
        gain = undefined;
      }
    }
    if (gain) {
      write(el, own);
      gain.gain.value = factor;
      return false;
    }
    write(el, own * Math.min(factor, 1));
    return factor > 1;
  };

  const elements = () => [...document.querySelectorAll<HTMLMediaElement>('video, audio')];

  // Media that starts later (next video, new player) gets the current level too.
  document.addEventListener(
    'play',
    (event) => {
      if (event.target instanceof HTMLMediaElement && target !== 100) apply(event.target);
    },
    true,
  );
  // The site changed the volume itself (its own slider): keep its choice and scale it.
  document.addEventListener(
    'volumechange',
    (event) => {
      const el = event.target;
      if (!(el instanceof HTMLMediaElement)) return;
      const last = written.get(el);
      if (last === undefined || Math.abs(el.volume - last) < 1e-3) return;
      base.set(el, el.volume);
      apply(el);
    },
    true,
  );

  globalThis.__cyvMedia = {
    async set(volume: number): Promise<MediaResult> {
      target = volume;
      if (volume > 100) await prepareContext();
      const found = elements();
      const limited = found.map(apply).some(Boolean);
      return { count: found.length, limited };
    },
  };
}
