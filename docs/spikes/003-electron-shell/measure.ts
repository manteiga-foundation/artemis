// Spike 003 driver: the Electron shell under Playwright, on the user's real flow plus automation checks.
// bun measure.ts [appUrl] [site]
import { _electron as electron, chromium, type Page } from 'playwright';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import electronPath from 'electron';

const appUrl = process.argv[2] ?? 'http://127.0.0.1:5179';
const dir = import.meta.dir;
const out = join(dir, '../../../data/spike-003');
await mkdir(out, { recursive: true });
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const R: Record<string, unknown> = {};

const fixture = Bun.serve({
  hostname: 'localhost', port: 0,
  fetch(req) {
    const p = new URL(req.url).pathname;
    const html = (b: string) => new Response(`<!doctype html><meta charset=utf-8><title>Fixture</title><body style="margin:0;font:20px sans-serif;background:#f4f4f4">${b}</body>`, { headers: { 'content-type': 'text/html' } });
    if (p === '/plain') return html(`<h1 style="margin:40px">Fixture</h1><input id=f style="margin:40px;font:20px sans-serif"><p id=c style="margin:40px">clicks: 0</p><script>let n=0;addEventListener('click',()=>{c.textContent='clicks: '+(++n)})</script>`);
    return new Response('nf', { status: 404 });
  }
});
const fx = `http://localhost:${fixture.port}`;

const shell = () => app.evaluate(() => (globalThis as any).__shell) as Promise<{ passThrough: boolean; siteVisible: boolean; editable: boolean; keysForwarded: number; layout: { x: number; y: number; w: number; h: number } | null }>;
async function until<T>(fn: () => Promise<T | undefined | null | false> | T | undefined | null | false, ms = 20000): Promise<T | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v as T; await Bun.sleep(150); }
  return null;
}
async function engage(page: Page, target: string) {
  await page.waitForFunction('typeof window.__artemis === "function"', null, { timeout: 20000 });
  await page.getByRole('textbox', { name: 'Web App' }).fill(target);
  await page.getByRole('button', { name: 'Engage', exact: true }).click();
  await page.waitForFunction('window.__artemis().engaged === true');
}

// ---------------------------------------------------------------- A. Playwright launches the shell
const app = await electron.launch({
  executablePath: electronPath as unknown as string,
  args: [join(dir, 'main.cjs')],
  cwd: dir,
  env: { ...process.env, APP_URL: appUrl } as Record<string, string>,
  recordVideo: { dir: join(out, 'video'), size: { width: 1440, height: 900 } }
});
const ctx = app.context();
await ctx.tracing.start({ screenshots: true, snapshots: true });
await app.firstWindow();
const overlay = (await until(() => app.windows().find((p) => p.url().includes('shell=electron'))))!;
const errors: string[] = [];
overlay.on('pageerror', (e) => errors.push(String(e)));
log('windows:', app.windows().map((p) => p.url()));

const siteUrl = process.argv[3] ?? 'https://example.com/';
await engage(overlay, siteUrl);
const site = await until(() => app.windows().find((p) => p.url().startsWith(new URL(siteUrl).origin)));
R.siteIsPlaywrightPage = !!site;
log('site view as a Playwright page:', !!site, ctx.pages().map((p) => p.url().slice(0, 50)));
if (!site) throw new Error('site view not exposed');

// The user's flow, by Playwright automation on the native site view.
await site.locator('#username').waitFor({ timeout: 30000 });
await site.locator('#username').fill('artemis.probe.nonexistent');
await site.locator('#btnSignIn').click();
await site.waitForURL(/login\.microsoftonline\.com/, { timeout: 30000 });
await until(() => site.evaluate(() => !!document.body && getComputedStyle(document.body).display !== 'none' && document.readyState !== 'loading').catch(() => false), 15000);
await site.waitForTimeout(3000);
R.microsoft = await site.evaluate(() => ({ host: location.host, top: window.top === window.self, body: getComputedStyle(document.body).display, text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 80), ua: navigator.userAgent }));
R.addressStrip = ((await overlay.locator('.browser-url').textContent()) ?? '').slice(0, 60);
R.layout = (await shell()).layout;
log('microsoft:', R.microsoft, R.addressStrip);

// What the operator sees: the native site under the transparent console, composed from each
// surface's own capture (this terminal has no screen-recording permission for an OS capture).
const caps = await app.evaluate(async ({ BrowserWindow, BaseWindow }) => {
  const g = globalThis as any;
  const wins = BaseWindow.getAllWindows();
  const base = wins.find((w: any) => !(w instanceof BrowserWindow))!;
  const ov = BrowserWindow.getAllWindows()[0];
  const siteView = base.contentView.children[0] as any;
  const [a, b] = await Promise.all([siteView.webContents.capturePage(), ov.webContents.capturePage()]);
  return { site: a.toPNG().toString('base64'), overlay: b.toPNG().toString('base64'), layout: g.__shell.layout, overlaySize: ov.getContentBounds() };
});
await Bun.write(join(out, 'a-site.png'), Buffer.from(caps.site, 'base64'));
await Bun.write(join(out, 'a-overlay.png'), Buffer.from(caps.overlay, 'base64'));
{
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage({ viewport: { width: caps.overlaySize.width, height: caps.overlaySize.height }, deviceScaleFactor: 2 });
  await p.setContent(`<body style="margin:0;background:#02061a"><img id=s src="data:image/png;base64,${caps.site}" style="position:absolute;left:${caps.layout.x}px;top:${caps.layout.y}px;width:${caps.layout.w}px;height:${caps.layout.h}px"><img src="data:image/png;base64,${caps.overlay}" style="position:absolute;inset:0;width:100%;height:100%"></body>`);
  await p.waitForTimeout(300);
  await p.screenshot({ path: join(out, 'a-composite.png') });
  await b.close();
}

// Session: Playwright's storageState opens helper pages (Target.createTarget), which Electron
// refuses; measure it, then cookies through Playwright and through Electron's own session API.
let storageStateResult = 'ok';
try { await ctx.storageState({ path: join(out, 'storage-state.json') }); } catch (e) { storageStateResult = String(e).split('\n')[0].slice(0, 120); }
const cookies = await ctx.cookies();
const domains = [...new Set(cookies.map((c) => c.domain))];
await Bun.write(join(out, 'cookies.json'), JSON.stringify(cookies));
await ctx.clearCookies();
const afterClear = (await ctx.cookies()).length;
await ctx.addCookies(cookies);
const afterRestore = (await ctx.cookies()).length;
const electronSession = await app.evaluate(async ({ session }) => {
  const all = await session.defaultSession.cookies.get({});
  return { cookies: all.length, persistentPartitionSupported: typeof session.fromPartition === 'function' };
});
const localStorageViaPage = await site.evaluate(() => Object.keys(localStorage).length).catch(() => -1);
R.session = { storageState: storageStateResult, cookies: cookies.length, domains, afterClear, afterRestore, electronSession, localStorageKeysReadOnPage: localStorageViaPage };
log('session:', R.session);

// Automation on a fixture: navigation, routing, hotkeys typed in the site, a field keeps its keys.
let routed = 0;
await ctx.route('**/plain*', (r) => { routed++; return r.continue(); });
await site.goto(`${fx}/plain`);
await site.locator('h1').waitFor();
R.route = { routedRequests: routed };
await ctx.unroute('**/plain*');
await site.waitForTimeout(500);
await site.mouse.click(700, 600); // empty area of the page
await site.keyboard.press('v');
const toPage = await until(() => overlay.evaluate('window.__artemis().view === "page"'), 4000);
await overlay.waitForTimeout(1600); // the dive
const sh1 = await shell();
R.hotkeyFromSite = { viewChangedToPage: !!toPage, keysForwarded: sh1.keysForwarded, inputEventsSeen: (sh1 as any).inputEvents, editableAtPress: sh1.editable, siteHiddenInPageView: !sh1.siteVisible };
await overlay.keyboard.press('v');
await overlay.waitForTimeout(1600);
await overlay.keyboard.press('v');
await until(() => shell().then((s) => s.siteVisible), 4000);
R.backToBrowser = { siteVisible: (await shell()).siteVisible, siteUrl: site.url(), clicksKept: await site.locator('#c').textContent() };
await site.locator('#f').click();
await site.keyboard.type('v');
await site.waitForTimeout(400);
R.typingInField = { value: await site.locator('#f').inputValue(), view: await overlay.evaluate('window.__artemis().view'), editable: (await shell()).editable };
log('hotkeys:', R.hotkeyFromSite, R.backToBrowser, R.typingInField);

// Click pass-through decisions: over the site vs over a panel.
const lay = (await shell()).layout!;
await overlay.mouse.move(lay.x + lay.w / 2, lay.y + lay.h / 3);
await overlay.waitForTimeout(250);
const overSite = (await shell()).passThrough;
await overlay.mouse.move(200, 20);
await overlay.waitForTimeout(250);
const overHeader = (await shell()).passThrough;
R.passThrough = { overSite, overHeader };
log('pass-through:', R.passThrough);

// Console performance with the native site under it.
await overlay.waitForTimeout(2500);
R.consolePerf = await overlay.evaluate('(({ fps, worstMs, busyPct }) => ({ fps, worstMs, busyPct }))(window.__artemis().perf || {})');

// Reload the console: the site view is a separate page and keeps its place.
const beforeReload = site.url();
await overlay.reload();
await overlay.waitForFunction('typeof window.__artemis === "function"');
await overlay.waitForTimeout(800);
R.consoleReload = { siteUrlUnchanged: site.url() === beforeReload, siteUrl: site.url() };
log('console reload:', R.consoleReload);

R.pageErrors = errors;
const tracePath = join(out, 'trace.zip');
await ctx.tracing.stop({ path: tracePath });
const siteVideo = site.video();
await app.close();
R.trace = { bytes: (await stat(tracePath)).size };
const vids = await readdir(join(out, 'video'));
R.video = { files: vids.length, siteVideo: siteVideo ? (await stat(await siteVideo.path())).size : null };
log('trace/video:', R.trace, R.video);

// ---------------------------------------------------------------- B. Attach to a running shell on demand
const port = 9339;
const proc = Bun.spawn([electronPath as unknown as string, join(dir, 'main.cjs')], { cwd: dir, env: { ...process.env, APP_URL: appUrl, CDP_PORT: String(port) }, stdout: 'ignore', stderr: 'ignore' });
await until(() => fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.ok).catch(() => false), 20000);
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const bctx = browser.contexts()[0];
const ov2 = await until(() => bctx.pages().find((p) => p.url().includes('shell=electron')));
await engage(ov2!, `${fx}/plain`);
const site2 = await until(() => bctx.pages().find((p) => p.url().startsWith(fx)));
await site2!.locator('#f').fill('attached later');
let frames = 0;
let screencast = 'n/a';
const attachedVideo = join(out, 'attached-recording.webm');
try {
  await site2!.screencast.start({ path: attachedVideo, onFrame: () => { frames++; } });
  await site2!.locator('#f').fill('attached later, recording');
  await site2!.waitForTimeout(1500);
  await site2!.screencast.stop();
  await Bun.sleep(500);
  screencast = `frames ${frames}, video ${(await stat(attachedVideo).catch(() => ({ size: 0 }))).size} bytes`;
} catch (e) { screencast = 'error ' + String(e).slice(0, 160); }
await bctx.tracing.start({ screenshots: true, snapshots: true });
await site2!.reload();
await bctx.tracing.stop({ path: join(out, 'trace-attached.zip') });
R.attached = { sitePage: !!site2, fieldValue: await site2!.locator('#f').inputValue(), screencast, traceBytes: (await stat(join(out, 'trace-attached.zip'))).size };
log('attached:', R.attached);
await browser.close();
proc.kill();

await Bun.write(join(out, 'results.json'), JSON.stringify(R, null, 2));
console.log(JSON.stringify(R, null, 2));
fixture.stop(true);
process.exit(0);
