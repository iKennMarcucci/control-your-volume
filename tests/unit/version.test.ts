import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// @ts-expect-error plain .mjs build helper without type declarations
import { isPrerelease, toChromeVersion } from '../../scripts/version-utils.mjs';

describe('toChromeVersion', () => {
  it('maps 1.0.0 pre-releases below 1.0.0', () => {
    assert.equal(toChromeVersion('1.0.0-alpha.3'), '0.9.1.3');
    assert.equal(toChromeVersion('1.0.0-beta.2'), '0.9.2.2');
    assert.equal(toChromeVersion('1.0.0-rc.1'), '0.9.3.1');
    assert.equal(toChromeVersion('1.0.0'), '1.0.0');
  });
  it('keeps later pre-releases ordered', () => {
    assert.equal(toChromeVersion('1.1.0-beta.1'), '1.0.9999.2001');
    assert.equal(toChromeVersion('1.0.1-rc.2'), '1.0.0.3002');
  });
  it('rejects unsupported versions', () => {
    assert.throws(() => toChromeVersion('1.0'));
    assert.throws(() => toChromeVersion('1.0.0-preview.1'));
  });
  it('detects pre-releases', () => {
    assert.equal(isPrerelease('1.0.0-alpha.1'), true);
    assert.equal(isPrerelease('1.0.0'), false);
  });
});
