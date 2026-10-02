// Measure the frame rate of the view dive (V) at several viewport sizes and pixel densities, with
// and without the blur effects, using the console's own FPS sampler. Needs a running dev server.
//   bun run scripts/measure-dive.ts [port]
import { chromium, type Page } from 'playwright';

const port = process.argv[2] ?? '5173';
const configs = [
  { name: 'laptop window  1440x900 @1x', width: 1440, height: 900, dpr: 1 },
  { name: 'laptop window  1440x900 @2x', width: 1440, height: 900, dpr: 2 },
  { name: 'full screen    1728x1117 @2x', width: 1728, height: 1117, dpr: 2 },
  { name: 'large display  2560x1440 @2x', width: 2560, height: 1440, dpr: 2 }
];
const variants = [
  { name: 'as shipped', css: '' },
  { name: 'no dive blur', css: '.stage { filter: none !important; }' },
  { name: 'no blur at all', css: '.stage { filter: none !important; } .panel, .browser-bar, .console-status, .console-readout, .hud-header { backdrop-filter: none !important; }' }
];

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });

async function engage(page: Page) {
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
  await page.waitForFunction('typeof window.__artemis === "function"');
  await page.getByRole('textbox', { name: 'Web App' }).fill('example.com');
  await page.getByRole('button', { name: 'Engage', exact: true }).click();
  await page.waitForFunction('window.__artemis().engaged === true');
}

/** Press V and read the per-second FPS samples until the dive settles; returns the lowest. */
async function diveFps(page: Page): Promise<number> {
  const before = (await page.evaluate('window.__artemis().perf?.history.length ?? 0')) as number;
  const view = (await page.evaluate('window.__artemis().view')) as string;
  await page.keyboard.press('v');
  try {
    await page.waitForFunction('window.__artemis().view !== null && window.__artemis().viewTransition === null', null, { timeout: 8000, polling: 100 });
  } catch (e) {
    console.log('  stalled leaving', view, await page.evaluate('JSON.stringify(window.__artemis().viewTransition)'));
    throw e;
  }
  await page.waitForTimeout(1100);
  const history = (await page.evaluate('window.__artemis().perf.history')) as number[];
  const during = history.slice(before);
  return during.length ? Math.min(...during) : NaN;
}

console.log('config'.padEnd(32), 'variant'.padEnd(16), 'idle fps', ' dive min fps (browser->page, page->cosmos, cosmos->browser)');
for (const c of configs) {
  for (const v of variants) {
    const page = await browser.newPage({ viewport: { width: c.width, height: c.height }, deviceScaleFactor: c.dpr });
    await engage(page);
    if (v.css) await page.addStyleTag({ content: v.css });
    await page.waitForTimeout(3200);
    const idle = (await page.evaluate('window.__artemis().perf.fps')) as number;
    const dives: number[] = [];
    for (let i = 0; i < 3; i++) dives.push(await diveFps(page));
    console.log(c.name.padEnd(32), v.name.padEnd(16), String(idle).padStart(8), ' ', dives.join(', '));
    await page.close();
  }
}
await browser.close();
