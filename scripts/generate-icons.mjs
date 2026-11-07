// Renders the PWA icons from the brand SVGs (run scripts/build-brand.mjs first).
// Usage: npm run icons
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
// Playwright is preinstalled globally in CI/dev containers (or: npm i -D playwright).
const { chromium } = createRequire(import.meta.url)('playwright');

const icon = readFileSync('public/brand/drop-icon.svg', 'utf8');
const maskable = readFileSync('public/brand/drop-icon-maskable.svg', 'utf8');
// Notification badge: white D-with-play silhouette on transparent.
const badge = icon.replace(/<rect [^>]*fill="#1F43E6"\/>/, '').replace(/fill="#FF7A00"/g, 'fill="#FFFFFF"').replace(/stroke="#FF7A00"/g, 'stroke="#FFFFFF"');

const icons = [
  { file: 'icon-192.png', size: 192, svg: icon, transparent: true },
  { file: 'icon-512.png', size: 512, svg: icon, transparent: true },
  { file: 'apple-touch-icon.png', size: 180, svg: maskable },
  { file: 'maskable-512.png', size: 512, svg: maskable },
  { file: 'badge-72.png', size: 72, svg: badge, transparent: true },
];

mkdirSync('public/icons', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const i of icons) {
  await page.setViewportSize({ width: i.size, height: i.size });
  const sized = i.svg.replace('<svg ', `<svg width="${i.size}" height="${i.size}" `);
  await page.setContent(`<html><body style="margin:0;background:transparent">${sized}</body></html>`);
  await page.screenshot({ path: `public/icons/${i.file}`, omitBackground: Boolean(i.transparent) });
  console.log('wrote', i.file);
}
await browser.close();
