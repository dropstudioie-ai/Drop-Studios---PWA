// Renders the PWA icons from the brand mark using the preinstalled Chromium.
// Usage: npm run icons
import { createRequire } from 'node:module';
// Playwright is preinstalled globally in CI/dev containers (or: npm i -D playwright).
const { chromium } = createRequire(import.meta.url)('playwright');
import { mkdirSync } from 'node:fs';

const drop = (fill) => `<path d="M32 12c7 10 14 18 14 27a14 14 0 0 1-28 0c0-9 7-17 14-27z" fill="${fill}"/>`;
const icons = [
  { file: 'icon-192.png', size: 192, svg: `<rect width="64" height="64" rx="14" fill="#1F43E6"/>${drop('#FF7A00')}` },
  { file: 'icon-512.png', size: 512, svg: `<rect width="64" height="64" rx="14" fill="#1F43E6"/>${drop('#FF7A00')}` },
  { file: 'apple-touch-icon.png', size: 180, svg: `<rect width="64" height="64" fill="#1F43E6"/>${drop('#FF7A00')}` },
  // Maskable: full-bleed background, mark inside the 80% safe zone.
  { file: 'maskable-512.png', size: 512, svg: `<rect width="64" height="64" fill="#1F43E6"/><g transform="translate(9.6 9.6) scale(0.7)">${drop('#FF7A00')}</g>` },
  // Notification badge: monochrome silhouette on transparent.
  { file: 'badge-72.png', size: 72, svg: drop('#FFFFFF'), transparent: true },
];

mkdirSync('public/icons', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const icon of icons) {
  await page.setViewportSize({ width: icon.size, height: icon.size });
  await page.setContent(`<html><body style="margin:0;background:transparent"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${icon.size}" height="${icon.size}">${icon.svg}</svg></body></html>`);
  await page.screenshot({ path: `public/icons/${icon.file}`, omitBackground: Boolean(icon.transparent) || icon.file.startsWith('icon-') });
  console.log('wrote', icon.file);
}
await browser.close();
