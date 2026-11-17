/** Volume is expressed as an integer percentage: 0 = silent, 100 = original, 200 = max boost. */
export const DEFAULT_VOLUME = 100;
export const MAX_VOLUME = 100;
export const MAX_BOOSTED_VOLUME = 200;
export const SMALL_STEP = 1;
export const LARGE_STEP = 10;

export function maxVolume(boost: boolean): number {
  return boost ? MAX_BOOSTED_VOLUME : MAX_VOLUME;
}

/** Clamps any input (including NaN or fractional values) to a valid integer volume. */
export function clampVolume(value: number, boost: boolean): number {
  if (!Number.isFinite(value)) return DEFAULT_VOLUME;
  return Math.min(maxVolume(boost), Math.max(0, Math.round(value)));
}

/** Parses free text typed by the user ("85", "85%", " 120 % "). Returns null when unusable. */
export function parseVolumeInput(text: string, boost: boolean): number | null {
  const match = /^\s*(\d{1,3}(?:[.,]\d+)?)\s*%?\s*$/.exec(text);
  if (!match?.[1]) return null;
  return clampVolume(Number(match[1].replace(',', '.')), boost);
}

/** Steps a volume up or down, snapping to the step grid so 47 + 10 becomes 50, not 57. */
export function stepVolume(
  current: number,
  direction: 1 | -1,
  step: number,
  boost: boolean,
): number {
  const snapped =
    direction === 1
      ? Math.floor(current / step) * step + step
      : Math.ceil(current / step) * step - step;
  return clampVolume(snapped, boost);
}

/**
 * The percentage is perceived loudness, not amplitude: people hear +10 dB as twice as loud and
 * -10 dB as half as loud. So 50% is -10 dB and 200% is +10 dB, which makes gain = (v/100)^1.66.
 * (A plain linear gain makes 50% sound like about two thirds and 200% barely louder.)
 */
export const LOUDNESS_EXPONENT = Math.log2(10) / 2;

/** Amplitude gain for a volume percentage. */
export function volumeToGain(volume: number): number {
  return (Math.max(0, volume) / 100) ** LOUDNESS_EXPONENT;
}

/** Lowest threshold of the limiter used above 100%, in dB. */
export const LIMITER_FLOOR_DB = -1.5;
export const LIMITER_RATIO = 20;

/**
 * Limiter threshold for a boosted volume. It follows the boost down to -1.5 dB, so a small boost
 * only limits a little and the level never drops when going from 100% to 101%. Chromium's
 * compressor adds its own makeup gain on top; the soft clipper after it keeps peaks below 1.0.
 */
export function limiterThreshold(volume: number): number {
  const boostDb = 20 * Math.log10(Math.max(volumeToGain(volume), 1));
  return -Math.min(-LIMITER_FLOOR_DB, boostDb);
}

export function isBoosted(volume: number): boolean {
  return volume > MAX_VOLUME;
}

/** Badge text for the toolbar icon, or an empty string when the badge should be hidden. */
export function badgeText(volume: number): string {
  return volume === DEFAULT_VOLUME ? '' : String(volume);
}
