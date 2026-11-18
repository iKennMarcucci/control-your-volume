/** Volume is expressed as an integer percentage: 0 = silent, 100 = original, 400 = max boost. */
export const DEFAULT_VOLUME = 100;
export const MAX_VOLUME = 100;
export const MAX_BOOSTED_VOLUME = 400;
/**
 * Above this level the extra loudness comes mostly from compression: audio that's already loud
 * (voices in a call, music) is close to full scale, so the peaks are squeezed to let the rest rise.
 */
export const COMPRESSED_FROM = 200;
export const SMALL_STEP = 1;
export const LARGE_STEP = 10;

export function maxVolume(boost: boolean): number {
  return boost ? MAX_BOOSTED_VOLUME : MAX_VOLUME;
}

/**
 * Slider positions. 0–100% always takes the same room (1% per step); with the booster on, the
 * boost range 100–400% takes an equal second half (3% per step), so normal levels stay precise.
 */
const BOOST_SPAN = 100;
const BOOST_PER_STEP = (MAX_BOOSTED_VOLUME - MAX_VOLUME) / BOOST_SPAN;

export function sliderMax(boost: boolean): number {
  return boost ? MAX_VOLUME + BOOST_SPAN : MAX_VOLUME;
}

export function volumeToSlider(volume: number): number {
  return volume <= MAX_VOLUME ? volume : MAX_VOLUME + (volume - MAX_VOLUME) / BOOST_PER_STEP;
}

/** Guide lines on the slider; dragging near one snaps to it. */
export const SNAP_MARKS = [0, 50, 100, 200, 300, 400] as const;

export function snapMarks(boost: boolean): number[] {
  return SNAP_MARKS.filter((mark) => mark <= maxVolume(boost));
}

/**
 * Snaps a slider position to the closest guide mark when it's within `threshold` positions.
 * Returns the position unchanged otherwise.
 */
export function snapPosition(position: number, boost: boolean, threshold: number): number {
  let best = position;
  let distance = threshold;
  for (const mark of snapMarks(boost)) {
    const markPosition = volumeToSlider(mark);
    const d = Math.abs(position - markPosition);
    if (d <= distance) {
      best = markPosition;
      distance = d;
    }
  }
  return best;
}

/** Fine step for arrow keys and the mouse wheel: 1% up to 100%, 5% above (lands on 200/300/400). */
export const BOOST_STEP = 5;

export function fineStep(volume: number, direction: 1 | -1, boost: boolean): number {
  const above = volume > MAX_VOLUME || (volume === MAX_VOLUME && direction === 1);
  return stepVolume(volume, direction, above ? BOOST_STEP : SMALL_STEP, boost);
}

export function sliderToVolume(position: number): number {
  return Math.round(
    position <= MAX_VOLUME ? position : MAX_VOLUME + (position - MAX_VOLUME) * BOOST_PER_STEP,
  );
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

/**
 * Limiter release in seconds. Up to 200% a slow release keeps music natural; above it the release
 * shortens to 50 ms so quiet syllables recover between loud ones (measured: a call voice at 400%
 * gains about +10 dB instead of +9).
 */
export function limiterRelease(volume: number): number {
  const slow = 0.15;
  const fast = 0.05;
  if (volume <= COMPRESSED_FROM) return slow;
  const t = Math.min(1, (volume - COMPRESSED_FROM) / (MAX_BOOSTED_VOLUME - COMPRESSED_FROM));
  return slow + (fast - slow) * t;
}

export function isBoosted(volume: number): boolean {
  return volume > MAX_VOLUME;
}

/** Badge text for the toolbar icon, or an empty string when the badge should be hidden. */
export function badgeText(volume: number): string {
  return volume === DEFAULT_VOLUME ? '' : String(volume);
}
