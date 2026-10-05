// Capture documentation screenshots of the two shown views (and frames of the dive) from a running
// dev server: `bun run dev` in one terminal, then `bun run scripts/screenshots.ts [port] [outDir] [site]`.
// For the Browser view with a site that refuses framing, use scripts/screenshots-browser.ts.
import { chromium, type Page } from 'playwright';
import { mkdir } from 'node:fs/promises';

const port = process.argv[2] ?? '5173';
const out = process.argv[3] ?? 'docs/screenshots';
const site = process.argv[4] ?? 'https://example.com/';
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });

async function open(width: number, height: number): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
  await page.waitForFunction('typeof window.__artemis === "function"');
  return page;
}
const engage = async (page: Page) => {
  await page.getByRole('textbox', { name: 'Web App' }).fill(site);
  await page.getByRole('button', { name: 'Engage', exact: true }).click();
  await page.waitForFunction('window.__artemis().engaged === true');
};
const settled = (page: Page) => page.waitForFunction('window.__artemis().viewTransition === null', { timeout: 5000 });
const shot = (page: Page, name: string) => page.screenshot({ path: `${out}/${name}.png` });

// Entry screen and the two views at 1440x900, in V order: browser -> cosmos (on the current page).
let page = await open(1440, 900);
await page.waitForTimeout(1500);
await shot(page, 'entry');
await engage(page);
await page.waitForTimeout(4000);
await shot(page, 'browser');

await page.keyboard.press('v');
// Frames of the dive: leaving (the page falling away), midpoint, arriving on the current page.
await page.waitForTimeout(260);
await shot(page, 'dive-1-leaving');
await page.waitForTimeout(260);
await shot(page, 'dive-2-midpoint');
await page.waitForTimeout(260);
await shot(page, 'dive-3-arriving');
await settled(page);
await page.waitForTimeout(1600);
await shot(page, 'cosmos-current-page');

// The whole network: clear the selection, then Focus tours the six sectors and fits everything.
await page.keyboard.press('x');
for (let i = 0; i < 7; i++) {
  await page.keyboard.press('f');
  await page.waitForTimeout(120);
}
await page.waitForTimeout(1800);
await shot(page, 'cosmos');

// The configuration view over the cosmos, Sound chosen, one change waiting for Apply.
await page.keyboard.press(',');
await page.getByRole('dialog', { name: 'Settings' }).waitFor({ state: 'visible' });
await page.getByRole('navigation', { name: 'Setting categories' }).getByRole('button', { name: 'Autopilot', exact: true }).click();
await page.getByRole('checkbox', { name: /Start exploring after Engage/ }).check();
await page.waitForTimeout(900);
await shot(page, 'settings');
await page.keyboard.press(',');
await page.close();

// 1280x800 check.
page = await open(1280, 800);
await engage(page);
await page.waitForTimeout(3500);
await shot(page, 'browser-1280');
await page.keyboard.press('v');
await settled(page);
await page.waitForTimeout(1500);
await shot(page, 'cosmos-current-page-1280');
await page.keyboard.press('v');
await settled(page);
await page.keyboard.press(',');
await page.getByRole('dialog', { name: 'Settings' }).waitFor({ state: 'visible' });
await page.getByRole('searchbox', { name: 'Search settings' }).fill('video');
await page.waitForTimeout(900);
await shot(page, 'settings-browser-1280');
await page.close();

await browser.close();
console.log(`screenshots written to ${out}/`);
