// Capture documentation screenshots of the three views (and frames of the dive) from a running dev
// server: `bun run dev` in one terminal, then `bun run scripts/screenshots.ts [port] [outDir]`.
import { chromium, type Page } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.argv[2] ?? '5173';
const out = process.argv[3] ?? 'docs/screenshots';
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });

async function open(width: number, height: number): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
  await page.evaluate('import("/src/store.ts").then(m => { window.__artemis = m.getState; })');
  return page;
}

const settled = (page: Page) => page.waitForFunction('window.__artemis().viewTransition === null', { timeout: 5000 });
const shot = (page: Page, name: string) => page.screenshot({ path: `${out}/${name}.png` });

// Entry screen and the three views at 1440x900.
let page = await open(1440, 900);
await page.waitForTimeout(1500);
await shot(page, 'entry');
await page.getByRole('button', { name: 'Engage', exact: true }).click();
await page.waitForTimeout(4200); // let the layout settle and the HUD finish assembling
await shot(page, 'cosmos');

await page.keyboard.press('v');
// Frames of the dive: leaving (old view rushing past), midpoint, arriving.
await page.waitForTimeout(260);
await shot(page, 'dive-1-leaving');
await page.waitForTimeout(260);
await shot(page, 'dive-2-midpoint');
await page.waitForTimeout(260);
await shot(page, 'dive-3-arriving');
await settled(page);
await page.waitForTimeout(1600);
await shot(page, 'page');
await page.keyboard.press('d');
await page.waitForTimeout(900);
await shot(page, 'page-depth-2');

await page.keyboard.press('v');
await settled(page);
await page.waitForTimeout(1600);
await shot(page, 'browser');
await page.close();

// 1280x800 check of the page and browser views.
page = await open(1280, 800);
await page.getByRole('button', { name: 'Engage', exact: true }).click();
await page.waitForTimeout(3500);
await page.keyboard.press('v');
await settled(page);
await page.waitForTimeout(1500);
await shot(page, 'page-1280');
await page.keyboard.press('v');
await settled(page);
await page.waitForTimeout(1500);
await shot(page, 'browser-1280');
await page.close();

await browser.close();
console.log(`screenshots written to ${out}/`);
