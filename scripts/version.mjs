// Usage: node scripts/version.mjs 1.0.0-beta.1
// Updates package.json; the build derives manifest version/version_name from it.
import { readFileSync, writeFileSync } from 'node:fs';
import { toChromeVersion } from './version-utils.mjs';

const next = process.argv[2];
if (!next) {
  console.error('Usage: node scripts/version.mjs <semver>');
  process.exit(1);
}
const chrome = toChromeVersion(next);
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
pkg.version = next;
writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`package.json → ${next} (Chrome manifest version ${chrome})`);
console.log(
  `Next: git commit -am "chore: release v${next}" && git tag v${next} && git push --follow-tags`,
);
