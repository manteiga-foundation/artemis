// Render the app icon: public/icon.svg (the source, also the console's favicon) to shell/icon.png,
// the 1024x1024 PNG the Electron shell puts on the Dock (macOS) or the window (elsewhere).
// Electron's nativeImage reads PNG, not SVG. Run after changing the SVG; the PNG is committed.
//   bun run scripts/icon.ts
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url).pathname;
const svg = await Bun.file(root + 'public/icon.svg').text();
const out = root + 'shell/icon.png';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><body style="margin:0;background:transparent">${svg}</body>`);
  await page.locator('svg').screenshot({ path: out, omitBackground: true });
} finally {
  await browser.close();
}
console.log(out);
