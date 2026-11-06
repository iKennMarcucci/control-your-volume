// Renders assets/icon.svg to the PNG sizes the manifest needs, using Playwright's Chromium.
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const svg = readFileSync('assets/icon.svg', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  await page.screenshot({ path: `src/icons/icon-${size}.png`, omitBackground: true });
}
await browser.close();
console.log('Icons written to src/icons/');
