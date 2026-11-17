import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  badgeText,
  clampVolume,
  isBoosted,
  LIMITER_FLOOR_DB,
  limiterThreshold,
  maxVolume,
  parseVolumeInput,
  stepVolume,
  volumeToGain,
} from '../../src/lib/volume.ts';

describe('clampVolume', () => {
  it('caps at 100% without the booster and 200% with it', () => {
    assert.equal(clampVolume(150, false), 100);
    assert.equal(clampVolume(150, true), 150);
    assert.equal(clampVolume(250, true), 200);
    assert.equal(maxVolume(false), 100);
    assert.equal(maxVolume(true), 200);
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
    for (let v = 1; v <= 200; v++) assert.ok(volumeToGain(v) > volumeToGain(v - 1), `at ${v}`);
  });
  it('limits more as the boost grows, down to the floor', () => {
    assert.equal(limiterThreshold(100), -0);
    assert.ok(limiterThreshold(101) > -0.2, 'barely limits a tiny boost');
    assert.equal(limiterThreshold(200), LIMITER_FLOOR_DB);
    for (let v = 101; v <= 200; v++) {
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
