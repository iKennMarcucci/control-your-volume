// Bundles the extension into dist/. `--watch` rebuilds on change.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { context } from 'esbuild';
import { toChromeVersion } from './version-utils.mjs';

const watch = process.argv.includes('--watch');
const outdir = 'dist';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

function copyStatic() {
  for (const path of ['popup.html', 'offscreen.html', '_locales', 'icons', 'fonts']) {
    cpSync(`src/${path}`, `${outdir}/${path}`, { recursive: true });
  }
  const manifest = JSON.parse(readFileSync('src/manifest.json', 'utf8'));
  manifest.version = toChromeVersion(pkg.version);
  manifest.version_name = pkg.version;
  writeFileSync(`${outdir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
}

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

const ctx = await context({
  entryPoints: ['src/background.ts', 'src/offscreen.ts', 'src/popup.ts', 'src/popup.css'],
  outdir,
  bundle: true,
  format: 'esm',
  target: 'chrome123',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  legalComments: 'none',
  external: ['/fonts/*'],
  logLevel: 'info',
  plugins: [{ name: 'static', setup: (build) => build.onEnd(copyStatic) }],
});

if (watch) {
  await ctx.watch();
  console.log('Watching for changes… load dist/ as an unpacked extension.');
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
