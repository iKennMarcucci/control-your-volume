import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  badgeText,
  clampVolume,
  fineStep,
  isBoosted,
  LIMITER_FLOOR_DB,
  limiterRelease,
  limiterThreshold,
  maxVolume,
  parseVolumeInput,
  sliderMax,
  sliderToVolume,
  snapMarks,
  snapPosition,
  stepVolume,
  volumeToGain,
  volumeToSlider,
} from '../../src/lib/volume.ts';

describe('clampVolume', () => {
  it('caps at 100% without the booster and 400% with it', () => {
    assert.equal(clampVolume(150, false), 100);
    assert.equal(clampVolume(150, true), 150);
    assert.equal(clampVolume(250, true), 250);
    assert.equal(clampVolume(450, true), 400);
    assert.equal(maxVolume(false), 100);
    assert.equal(maxVolume(true), 400);
  });
  it('never goes below zero and rounds fractions', () => {
    assert.equal(clampVolume(-5, true), 0);
    assert.equal(clampVolume(49.6, false), 50);
  });
  it('falls back to 100% on garbage', () => {
    assert.equal(clampVolume(Number.NaN, false), 100);
    assert.equal(clampVolume(Number.POSITIVE_INFINITY, true), 100);
  });
});

describe('parseVolumeInput', () => {
  it('accepts plain numbers, percent signs and spaces', () => {
    assert.equal(parseVolumeInput('85', false), 85);
    assert.equal(parseVolumeInput(' 85 % ', false), 85);
    assert.equal(parseVolumeInput('12,6', false), 13);
  });
  it('clamps to the active maximum', () => {
    assert.equal(parseVolumeInput('180', false), 100);
    assert.equal(parseVolumeInput('180', true), 180);
  });
  it('rejects text it cannot understand', () => {
    assert.equal(parseVolumeInput('', false), null);
    assert.equal(parseVolumeInput('loud', false), null);
    assert.equal(parseVolumeInput('-20', false), null);
    assert.equal(parseVolumeInput('1000', true), null);
  });
});

describe('stepVolume', () => {
  it('snaps to the step grid', () => {
    assert.equal(stepVolume(47, 1, 10, false), 50);
    assert.equal(stepVolume(47, -1, 10, false), 40);
    assert.equal(stepVolume(50, 1, 10, false), 60);
    assert.equal(stepVolume(50, -1, 10, false), 40);
  });
  it('respects bounds', () => {
    assert.equal(stepVolume(100, 1, 10, false), 100);
    assert.equal(stepVolume(100, 1, 10, true), 110);
    assert.equal(stepVolume(0, -1, 10, true), 0);
    assert.equal(stepVolume(199, 1, 1, true), 200);
  });
});

describe('gain and badge', () => {
  const db = (gain: number) => 20 * Math.log10(gain);
  it('maps percent to perceived loudness: half is -10 dB, double is +10 dB', () => {
    assert.equal(volumeToGain(100), 1);
    assert.ok(Math.abs(db(volumeToGain(50)) - -10) < 1e-9);
    assert.ok(Math.abs(db(volumeToGain(200)) - 10) < 1e-9);
    assert.ok(Math.abs(db(volumeToGain(25)) - -20) < 1e-9);
    assert.equal(volumeToGain(0), 0);
    assert.equal(volumeToGain(-1), 0);
  });
  it('gets louder with every step', () => {
    for (let v = 1; v <= 400; v++) assert.ok(volumeToGain(v) > volumeToGain(v - 1), `at ${v}`);
  });
  it('limits more as the boost grows, down to the floor', () => {
    assert.equal(limiterThreshold(100), -0);
    assert.ok(limiterThreshold(101) > -0.2, 'barely limits a tiny boost');
    assert.equal(limiterThreshold(200), LIMITER_FLOOR_DB);
    for (let v = 101; v <= 400; v++) {
      assert.ok(limiterThreshold(v) <= limiterThreshold(v - 1), `at ${v}`);
      assert.ok(limiterThreshold(v) >= LIMITER_FLOOR_DB, `at ${v}`);
    }
  });
  it('flags boosted volumes', () => {
    assert.equal(isBoosted(100), false);
    assert.equal(isBoosted(101), true);
  });
  it('hides the badge at 100%', () => {
    assert.equal(badgeText(100), '');
    assert.equal(badgeText(0), '0');
    assert.equal(badgeText(150), '150');
  });
});

describe('slider positions', () => {
  it('keeps 0–100% at 1% per step and gives the boost range an equal half', () => {
    assert.equal(sliderMax(false), 100);
    assert.equal(sliderMax(true), 200);
    assert.equal(sliderToVolume(50), 50);
    assert.equal(sliderToVolume(100), 100);
    assert.equal(sliderToVolume(101), 103);
    assert.equal(sliderToVolume(200), 400);
    assert.equal(volumeToSlider(400), 200);
  });
  it('round-trips every volume and only ever moves forward', () => {
    for (let v = 0; v <= 400; v++) assert.equal(sliderToVolume(volumeToSlider(v)), v);
    for (let p = 1; p <= 200; p++) assert.ok(sliderToVolume(p) > sliderToVolume(p - 1), `at ${p}`);
  });
});

describe('limiter release', () => {
  it('stays slow up to 200% and speeds up toward 400%', () => {
    assert.equal(limiterRelease(150), 0.15);
    assert.equal(limiterRelease(200), 0.15);
    assert.ok(Math.abs(limiterRelease(400) - 0.05) < 1e-9);
    for (let v = 201; v <= 400; v++)
      assert.ok(limiterRelease(v) < limiterRelease(v - 1), `at ${v}`);
  });
});

describe('guide marks and snapping', () => {
  it('offers 0/50/100 without the booster and up to 400 with it', () => {
    assert.deepEqual(snapMarks(false), [0, 50, 100]);
    assert.deepEqual(snapMarks(true), [0, 50, 100, 200, 300, 400]);
  });
  it('snaps only within the threshold, to the closest mark', () => {
    assert.equal(snapPosition(48, false, 3), 50);
    assert.equal(snapPosition(46, false, 3), 46);
    assert.equal(snapPosition(98.5, true, 3), 100);
    // 200% sits at position 133.33 with the booster on.
    assert.equal(sliderToVolume(snapPosition(131, true, 3)), 200);
    assert.equal(sliderToVolume(snapPosition(120, true, 3)), 160);
    assert.equal(snapPosition(1, true, 3), 0);
  });
});

describe('fine steps (arrows and wheel)', () => {
  it('moves 1% up to 100% and 5% above, landing on 200/300/400', () => {
    assert.equal(fineStep(50, 1, true), 51);
    assert.equal(fineStep(100, 1, true), 105);
    assert.equal(fineStep(100, -1, true), 99);
    assert.equal(fineStep(103, 1, true), 105);
    assert.equal(fineStep(103, -1, true), 100);
    assert.equal(fineStep(195, 1, true), 200);
    assert.equal(fineStep(400, 1, true), 400);
    assert.equal(fineStep(100, 1, false), 100);
  });
});
