/**
 * Chrome only accepts versions made of 1-4 dot-separated integers, so semver pre-releases
 * are mapped onto a numeric version that still sorts correctly:
 *   1.0.0-alpha.3 → 0.9.1.3   1.0.0-beta.2 → 0.9.2.2   1.0.0-rc.1 → 0.9.3.1   1.0.0 → 1.0.0
 * For later releases (e.g. 1.1.0-beta.1) the pre-release maps onto the previous minor/patch.
 */
const STAGES = { alpha: 1, beta: 2, rc: 3 };

export function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/.exec(version);
  if (!match)
    throw new Error(`Unsupported version "${version}". Use X.Y.Z or X.Y.Z-(alpha|beta|rc).N`);
  const [, major, minor, patch, stage, n] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    stage: stage ?? null,
    n: n === undefined ? null : Number(n),
  };
}

export function toChromeVersion(version) {
  const v = parseSemver(version);
  if (!v.stage) return `${v.major}.${v.minor}.${v.patch}`;
  const stageNumber = STAGES[v.stage];
  // Pre-release of X.Y.Z sorts right below X.Y.Z by borrowing from the previous component.
  if (v.patch > 0) return `${v.major}.${v.minor}.${v.patch - 1}.${stageNumber * 1000 + v.n}`;
  if (v.minor > 0) return `${v.major}.${v.minor - 1}.9999.${stageNumber * 1000 + v.n}`;
  if (v.major > 0) return `${v.major - 1}.9.${stageNumber}.${v.n}`;
  throw new Error('0.0.0 pre-releases are not supported');
}

export function isPrerelease(version) {
  return parseSemver(version).stage !== null;
}
