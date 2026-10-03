// Spike 002, by hand: the console in its own window with the Browser view showing a streamed tab.
// bun try.ts [appUrl]   (Engage any address; reload the console and it comes back to the same page)
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ownBrowser } from '../../../server/owned-browser';
import { startSiteStream, VIEWER } from './stream';

const appUrl = process.argv[2] ?? 'http://127.0.0.1:5179';
const profile = join(import.meta.dir, '../../../data/spike-002/site-profile'); // logins made in the streamed tab survive restarts
await mkdir(profile, { recursive: true });
const stream = await startSiteStream({ profile, dpr: 2, quality: 70 });
const consoleProfile = join(import.meta.dir, '../../../data/spike-002/console-profile');
await mkdir(consoleProfile, { recursive: true });
const owned = await ownBrowser({ appUrl, userDataDir: consoleProfile, headless: process.argv.includes('--headless') });
const { page, context } = owned;
// The console's own iframe stays empty; the stream replaces it.
await context.route('**/*', (r) => (r.request().resourceType() === 'document' && r.request().frame().parentFrame() ? r.fulfill({ body: '' }) : r.fallback()));
console.log(`spike 002: console open on ${appUrl}; site tab streams from ${stream.wsUrl}`);

// --auto=<url>: engage by itself, wait, screenshot, report, exit (for verification).
const auto = process.argv.find((a) => a.startsWith('--auto='))?.slice(7);
if (auto) {
  await page.waitForFunction('typeof window.__artemis === "function"');
  await page.getByRole('textbox', { name: 'Web App' }).fill(auto);
  await page.getByRole('button', { name: 'Engage', exact: true }).click();
  setTimeout(async () => {
    await page.screenshot({ path: join(import.meta.dir, '../../../data/spike-002/try-auto.png') });
    const st = await page.evaluate('({ frames: window.__stream?.frames, nav: window.__stream?.nav, strip: document.querySelector(".browser-url")?.textContent, canvas: !!document.querySelector(".stream-canvas") })');
    console.log('spike 002 auto:', JSON.stringify(st));
    await owned.close(); await stream.close(); process.exit(0);
  }, 12000);
}

let lastTarget: string | null = null;
// Each time the console is engaged (first time, or after a reload) attach the viewer to the slot.
for (;;) {
  if (page.isClosed()) break;
  const s = (await page.evaluate('window.__artemis ? { engaged: window.__artemis().engaged, url: window.__artemis().targetUrl, attached: !!document.querySelector(".stream-canvas"), slot: !!document.querySelector(".browser-slot") } : null').catch(() => null)) as { engaged: boolean; url: string; attached: boolean; slot: boolean } | null;
  if (s?.engaged && s.slot && !s.attached) {
    await page.evaluate(`(${VIEWER})(${JSON.stringify(stream.wsUrl)})`).catch(() => {});
    if (s.url !== lastTarget) {
      lastTarget = s.url;
      await stream.goto(s.url);
    }
    console.log(`spike 002: viewer attached, site tab on ${stream.page().url().slice(0, 80)}`);
  }
  await Bun.sleep(400);
}
await stream.close();
process.exit(0);
