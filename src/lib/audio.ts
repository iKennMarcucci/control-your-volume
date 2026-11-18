/**
 * The boost stage shared by both engines (captured tabs and <video>/<audio>):
 *   input → limiter (DynamicsCompressor) → soft clipper → output
 * The limiter holds most peaks; the soft clipper rounds off what slips through (the compressor's
 * attack and makeup gain), so the output never reaches full scale and never clips harshly.
 */
import { LIMITER_RATIO, limiterRelease, limiterThreshold } from './volume.ts';

/** The WaveShaper curve covers ±CLIP_RANGE; a gain of 1/CLIP_RANGE maps it onto [-1, 1]. */
const CLIP_RANGE = 2;
/** Linear up to this level, then a smooth knee that approaches 1.0 without reaching it. */
const CLIP_KNEE = 0.9;

let clipCurve: Float32Array<ArrayBuffer> | null = null;

function softClipCurve(): Float32Array<ArrayBuffer> {
  if (clipCurve) return clipCurve;
  const size = 4097;
  clipCurve = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = ((i / (size - 1)) * 2 - 1) * CLIP_RANGE;
    const a = Math.abs(x);
    const y =
      a <= CLIP_KNEE
        ? a
        : CLIP_KNEE + (1 - CLIP_KNEE) * Math.tanh((a - CLIP_KNEE) / (1 - CLIP_KNEE));
    clipCurve[i] = Math.sign(x) * y;
  }
  return clipCurve;
}

export interface BoostStage {
  input: AudioNode;
  output: AudioNode;
  /** Applies the limiter settings for this volume (call on every volume change). */
  setVolume(volume: number): void;
  disconnect(): void;
}

export function createBoostStage(ctx: BaseAudioContext): BoostStage {
  const limiter = ctx.createDynamicsCompressor();
  limiter.knee.value = 0;
  limiter.ratio.value = LIMITER_RATIO;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.15;
  const scale = ctx.createGain();
  scale.gain.value = 1 / CLIP_RANGE;
  const clipper = ctx.createWaveShaper();
  clipper.curve = softClipCurve();
  clipper.oversample = '2x';
  limiter.connect(scale).connect(clipper);

  return {
    input: limiter,
    output: clipper,
    setVolume(volume: number) {
      limiter.threshold.value = limiterThreshold(volume);
      limiter.release.value = limiterRelease(volume);
    },
    disconnect() {
      for (const node of [limiter, scale, clipper]) node.disconnect();
    },
  };
}
