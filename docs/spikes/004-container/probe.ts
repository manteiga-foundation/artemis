// Spike 004's operator: a Chromium on the host opens the console served by serve.ts (on the host or
// in the container), engages the fixture, presses D to max and waits for the flight to end, then
// reads what arrived: pages in the cosmos, the feed's batches and latency, the server's flight
// events, the database. Prints a JSON report and saves screenshots next to it.
//   bun run docs/spikes/004-container/probe.ts [consoleUrl] [siteUrl] [outDir]
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const consoleUrl = process.argv[2] ?? 'http://127.0.0.1:5173';
const outDir = process.argv[4] ?? join(process.env.TMPDIR ?? '/tmp', 'spike-004');
await mkdir(outDir, { recursive: true });
const state = async () => (await fetch(`${consoleUrl}/api/state`)).json() as Promise<Record<string, any>>;
const siteUrl = process.argv[3] || (await state()).fixture;

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
const t0 = Date.now();
await page.goto(consoleUrl);
await page.getByRole('textbox', { name: 'Web App' }).fill(siteUrl);
await page.getByRole('button', { name: 'Engage' }).click();
await page.waitForSelector('.boot', { state: 'detached', timeout: 20_000 }).catch(() => {});
// The site is live when the address strip shows the fixture's address (via the WebSocket).
await page.waitForFunction((u) => document.body.innerText.includes(new URL(u).host), siteUrl, { timeout: 20_000 });
const engagedMs = Date.now() - t0;
await page.screenshot({ path: join(outDir, 'browser-view.png') });

// D x3: max. The console tells the shim, the shim tells the server, the autopilot reads the speed.
for (let i = 0; i < 3; i++) {
  await page.keyboard.press('d');
  await page.waitForTimeout(150);
}
const tFlight = Date.now();
let s = await state();
const until = Date.now() + 120_000;
while (Date.now() < until && !s.flight.some((e: any) => e.event === 'done')) {
  await new Promise((r) => setTimeout(r, 500));
  s = await state();
}
const flightMs = Date.now() - tFlight;
await page.waitForTimeout(600);
await page.screenshot({ path: join(outDir, 'browser-after-flight.png') });

// V: the cosmos, the live recording around the current page.
await page.keyboard.press('v');
await page.waitForTimeout(2500);
await page.screenshot({ path: join(outDir, 'cosmos.png') });
const cosmos = await page.evaluate(() => ({
  labels: document.querySelectorAll('.hub-label').length,
  labelTexts: [...document.querySelectorAll('.hub-label .hub-text')].map((e) => e.textContent?.trim()).filter(Boolean).slice(0, 40),
  selected: document.querySelector('.hub-label.is-selected .hub-text')?.textContent?.trim() ?? null,
  feed: (window as any).__artemisFeedStats
}));
const lat = [...(cosmos.feed?.latencyMs ?? [])].sort((a: number, b: number) => a - b);
const pct = (p: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] : null);

const done = s.flight.find((e: any) => e.event === 'done');
console.log(
  JSON.stringify(
    {
      console: consoleUrl,
      site: siteUrl,
      server: { platform: s.platform, arch: s.arch, bun: s.bun, database: s.database, har: s.har, actions: s.actions },
      engagedMs,
      flightMs,
      flight: { events: s.flight.length, visited: done?.visited ?? null, pending: done?.pending ?? null, speeds: s.flight.filter((e: any) => e.event === 'speed').map((e: any) => e.speed) },
      cosmos: { labels: cosmos.labels, selected: cosmos.selected, labelTexts: cosmos.labelTexts },
      feed: { batches: cosmos.feed?.batches, events: cosmos.feed?.events, latencyMs: { median: pct(0.5), p95: pct(0.95), max: lat.at(-1) ?? null } },
      pageErrors: errors,
      screenshots: outDir
    },
    null,
    2
  )
);
await browser.close();
