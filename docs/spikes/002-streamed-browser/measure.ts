// Spike 002 driver: the user's failing flow through a streamed tab shown inside the real console.
// bun measure.ts [appUrl] [dpr] [quality]
import { chromium, type Page } from 'playwright';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { startSiteStream, VIEWER } from './stream';

const appUrl = process.argv[2] ?? 'http://127.0.0.1:5179';
const dpr = Number(process.argv[3] ?? 2);
const quality = Number(process.argv[4] ?? 70);
const target = process.argv[5] ?? 'https://example.com/'; // the site whose sign-in flow is measured
const out = join(import.meta.dir, '../../../data/spike-002', `dpr${dpr}-q${quality}`);
await mkdir(out, { recursive: true });
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const med = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.floor(s.length / 2)] * 10) / 10; };
const p95 = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.floor(s.length * 0.95)] * 10) / 10; };

// Local fixture pages: animation (frame rate), typing (key latency), a select (browser-drawn popup).
const fixture = Bun.serve({
  hostname: 'localhost', port: 0,
  fetch(req) {
    const p = new URL(req.url).pathname;
    const page = (b: string) => new Response(`<!doctype html><meta charset=utf-8><body style="margin:0;font:22px sans-serif;background:#fff">${b}</body>`, { headers: { 'content-type': 'text/html' } });
    if (p === '/anim') return page(`<style>@keyframes s{to{transform:translateX(80vw) rotate(360deg)}}.b{position:absolute;width:30vw;height:30vh;background:linear-gradient(90deg,#c33,#33c);animation:s 2s linear infinite alternate}</style><div class=b style="top:5%"></div><div class=b style="top:40%;animation-duration:1.3s"></div><div class=b style="top:70%;animation-duration:.9s"></div>`);
    if (p === '/type') return page(`<input id=f style="font:28px sans-serif;margin:80px;width:600px">`);
    if (p === '/select') return page(`<div style="margin:80px"><select id=s style="font:24px sans-serif"><option>Alpha</option><option>Bravo</option><option>Charlie</option><option>Delta</option></select></div>`);
    return new Response('nf', { status: 404 });
  }
});
const fx = `http://localhost:${fixture.port}`;

const profile = await mkdtemp(join(import.meta.dir, '../../../data/spike-002', 'site-profile-'));
const stream = await startSiteStream({ profile, dpr, quality });
log('site browser up; UA seen by sites:', stream.userAgent);

const viewerBrowser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const vctx = await viewerBrowser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr });
// The console's iframe must not load the site in parallel: the stream replaces it.
await vctx.route('**/*', (r) => (r.request().resourceType() === 'document' && r.request().frame().parentFrame() ? r.fulfill({ body: '' }) : r.fallback()));
const viewer = await vctx.newPage();
const errors: string[] = [];
viewer.on('pageerror', (e) => errors.push(String(e)));

async function openConsole(v: Page) {
  await v.goto(appUrl, { waitUntil: 'networkidle' });
  await v.waitForFunction('typeof window.__artemis === "function"');
  await v.getByRole('textbox', { name: 'Web App' }).fill(target);
  await v.getByRole('button', { name: 'Engage', exact: true }).click();
  await v.waitForFunction('window.__artemis().engaged === true');
  await v.waitForSelector('.browser-slot');
  await v.waitForTimeout(1200);
}
const consoleFps = async () => (await viewer.evaluate('window.__artemis().perf')) as { fps: number; worstMs: number; busyPct: number } | null;
const inject = () => viewer.evaluate(`(${VIEWER})(${JSON.stringify(stream.wsUrl)})`);
const canvasBox = async () => (await viewer.locator('.stream-canvas').boundingBox())!;
// Click on a site element through the console: site coordinates -> canvas coordinates -> real mouse.
async function clickSite(selector: string) {
  const b = (await stream.page().locator(selector).boundingBox())!;
  const c = await canvasBox();
  await viewer.mouse.click(c.x + b.x + b.width / 2, c.y + b.y + b.height / 2);
}
const resetStats = () => viewer.evaluate(`Object.assign(window.__stream, { frames: 0, bytes: 0, arrivals: [], chromeToViewer: [], serverToViewer: [], decode: [], drawn: 0, keyLat: [] })`);
const streamStats = async () => (await viewer.evaluate('window.__stream')) as { frames: number; bytes: number; arrivals: number[]; chromeToViewer: number[]; serverToViewer: number[]; decode: number[]; drawn: number; keyLat: number[]; nav: string; events: { t: string }[] };

const results: Record<string, unknown> = { dpr, quality, ua: stream.userAgent };

await openConsole(viewer);
await viewer.waitForTimeout(3000);
results.consoleFpsBaseline = await consoleFps();
await inject();
log('viewer injected; slot', await canvasBox());

// 1. The user's flow, driven from the console.
await stream.goto(target);
await stream.page().waitForSelector('#username', { timeout: 30000 });
await viewer.waitForTimeout(1500);
await viewer.screenshot({ path: join(out, '1-pingone-in-console.png') });
await clickSite('#username');
await viewer.keyboard.type('artemis.probe.nonexistent', { delay: 25 });
await viewer.waitForTimeout(400);
results.typedValue = await stream.page().locator('#username').inputValue();
log('typed through the console:', results.typedValue);
await clickSite('#btnSignIn');
await stream.page().waitForURL(/login\.microsoftonline\.com/, { timeout: 30000 });
for (let i = 0; i < 60; i++) {
  const shown = await stream.page().evaluate(() => !!document.body && getComputedStyle(document.body).display !== 'none' && document.readyState !== 'loading').catch(() => false);
  if (shown) break;
  await Bun.sleep(250);
}
await viewer.waitForTimeout(4000);
results.microsoft = await stream.page().evaluate(() => ({ url: location.host, top: window.top === window.self, bodyDisplay: getComputedStyle(document.body).display, text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 200) }));
log('microsoft:', results.microsoft);
const s1 = await streamStats();
results.addressStrip = await viewer.locator('.browser-url').textContent();
await viewer.screenshot({ path: join(out, '2-microsoft-in-console.png') });
await stream.page().screenshot({ path: join(out, '2-microsoft-direct.png') });
results.canvas = await viewer.evaluate(() => { const c = document.querySelector('.stream-canvas') as HTMLCanvasElement; const r = c.getBoundingClientRect(); return { backing: [c.width, c.height], css: [r.width, r.height], dpr: devicePixelRatio }; });
results.flowFrames = { frames: s1.frames, avgKB: Math.round(s1.bytes / Math.max(1, s1.frames) / 1024) };

// 2. Reload the console: the site tab keeps its place, the last frame comes straight back.
await viewer.reload();
await openConsole(viewer);
await inject();
await viewer.waitForTimeout(1500);
const s2 = await streamStats();
results.afterReload = { framesWithin1500ms: s2.frames, nav: s2.nav, siteUrl: stream.page().url().slice(0, 60) };
await viewer.screenshot({ path: join(out, '3-after-console-reload.png') });
log('after reload:', results.afterReload);

// 2b. Browser shortcuts from the console act on the site tab: Cmd+[ goes back.
await viewer.evaluate(() => (document.querySelector('.stream-canvas') as HTMLElement).focus());
await viewer.keyboard.press('Meta+BracketLeft');
await viewer.waitForTimeout(2500);
results.backFromConsole = { siteHost: new URL(stream.page().url()).host, addressStrip: ((await viewer.locator('.browser-url').textContent()) ?? '').slice(0, 60) };
log('back:', results.backFromConsole);

// 3. Frame rate while the site animates, and what it costs the console.
await stream.goto(`${fx}/anim`);
await viewer.waitForTimeout(1500);
await resetStats();
await viewer.waitForTimeout(5000);
const s3 = await streamStats();
results.animation = {
  fps: Math.round(s3.frames / 5),
  drawnFps: Math.round(s3.drawn / 5),
  avgKB: Math.round(s3.bytes / Math.max(1, s3.frames) / 1024),
  MBps: Math.round((s3.bytes / 5 / 1048576) * 10) / 10,
  chromeToViewerMs: { med: med(s3.chromeToViewer), p95: p95(s3.chromeToViewer) },
  serverToViewerMs: { med: med(s3.serverToViewer), p95: p95(s3.serverToViewer) },
  decodeMs: { med: med(s3.decode), p95: p95(s3.decode) },
  consoleFpsWhileStreaming: await consoleFps(),
  serverSkipped: stream.stats.skipped
};
log('animation:', results.animation);

// 4. Key-to-frame latency: each key typed in the console until the next frame shows it.
await stream.goto(`${fx}/type`);
await viewer.waitForTimeout(800);
await clickSite('#f');
await viewer.waitForTimeout(800);
await resetStats();
for (const ch of 'streamed browser ok') { await viewer.keyboard.press(ch === ' ' ? 'Space' : ch); await viewer.waitForTimeout(150); }
await viewer.waitForTimeout(300);
const s4 = await streamStats();
results.typing = { value: await stream.page().locator('#f').inputValue(), keyToFrameMs: { med: med(s4.keyLat), p95: p95(s4.keyLat), n: s4.keyLat.length } };
log('typing:', results.typing);

// 5. A select: does the browser-drawn popup appear in the stream?
await stream.goto(`${fx}/select`);
await viewer.waitForTimeout(800);
const c = await canvasBox();
await viewer.screenshot({ path: join(out, '5-select-closed.png'), clip: { x: c.x, y: c.y, width: 500, height: 400 } });
await clickSite('#s');
await viewer.waitForTimeout(900);
await viewer.screenshot({ path: join(out, '5-select-open.png'), clip: { x: c.x, y: c.y, width: 500, height: 400 } });
await stream.page().screenshot({ path: join(out, '5-select-open-direct.png'), clip: { x: 0, y: 0, width: 500, height: 400 } });
await viewer.keyboard.press('ArrowDown');
await viewer.keyboard.press('Enter');
await viewer.waitForTimeout(500);
results.select = { valueAfterArrowDownEnter: await stream.page().locator('#s').inputValue() };
log('select:', results.select);

results.pageErrors = errors;
await Bun.write(join(out, 'results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await viewerBrowser.close();
await stream.close();
fixture.stop(true);
