// Spike 005 probe: the owned browser on a Linux X11 desktop, with real input (xdotool through the
// X server, not Playwright's synthetic events, which never test whether the OS lets a click through
// the transparent console window).
//
// Inside the image:  docker run --rm -v "$PWD":/src:ro -v /tmp/a5:/out artemis-linux bun run docs/spikes/005-linux-desktop/probe.ts
// Prints one JSON report; screenshots of the whole X screen go to /out.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron } from 'playwright';
import { launchShell } from '../../../server/shell';
import { startVite } from '../../../tests/vite';

const OUT = process.env.OUT ?? '/out';
const sh = (cmd: string[]) => {
  const p = Bun.spawnSync(cmd, { stdout: 'pipe', stderr: 'pipe' });
  return p.stdout.toString().trim() || p.stderr.toString().trim();
};
// Under Wayland the X root holds only Xwayland's windows: ask Weston for the whole output.
const shot = (name: string) => {
  if (process.env.NOSHOT === "1") return "";
  if (!process.env.WAYLAND_DISPLAY) return sh(['import', '-window', 'root', join(OUT, `${name}.png`)]);
  const p = Bun.spawnSync(['weston-screenshooter'], { cwd: '/tmp' });
  const file = sh(['sh', '-c', 'ls -t /tmp/wayland-screenshot-*.png | head -1']);
  return p.exitCode === 0 && file ? sh(['mv', file, join(OUT, `${name}.png`)]) : `no screenshot: ${p.stderr}`;
};
// The spike's levers on Electron's command line (EXTRA_ARGS) and Playwright's sandbox switch
// (SANDBOX=1: chromiumSandbox, which Playwright turns off on Linux unless asked).
const launch = _electron.launch.bind(_electron);
_electron.launch = (o) =>
  launch({ ...o, args: [...(o?.args ?? []), ...(process.env.EXTRA_ARGS ?? '').split(' ').filter(Boolean)], ...(process.env.SANDBOX === '1' ? { chromiumSandbox: true } : {}) });
const report: Record<string, unknown> = {
  platform: process.platform,
  arch: process.arch,
  session: process.env.XDG_SESSION_TYPE ?? 'x11 (Xvfb)',
  compositor: process.env.DESKTOP_COMPOSITOR ?? '1',
  extraArgs: process.env.EXTRA_ARGS ?? '',
  sandbox: process.env.SANDBOX === '1'
};

let clicks = 0;
const site = Bun.serve({
  hostname: 'localhost',
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/click') return new Response(String(++clicks));
    return new Response(
      `<!doctype html><title>Linux fixture</title><body style="margin:0;height:100vh;background:linear-gradient(135deg,#ffd166,#ef476f 50%,#118ab2);font:24px sans-serif">
       <h1 style="margin:0;padding:40px">Linux fixture</h1>
       <button id="press" style="position:absolute;left:45%;top:45%;font-size:32px;padding:20px 40px" onclick="fetch('/click')">Press</button></body>`,
      { headers: { 'content-type': 'text/html' } }
    );
  }
});
const siteUrl = `http://localhost:${site.port}/`;

const geometry = (id: string) => {
  const t = sh(['xwininfo', '-id', id]);
  const n = (k: string) => Number(new RegExp(`${k}:\\s+(-?\\d+)`).exec(t)?.[1]);
  return { x: n('Absolute upper-left X'), y: n('Absolute upper-left Y'), w: n('Width'), h: n('Height'), depth: n('Depth'), mapped: /IsViewable/.test(t) };
};
// The console window's X input shape (what setIgnoreMouseEvents sets): the raw lines.
const inputShape = (id: string) =>
  sh(['xwininfo', '-shape', '-id', id])
    .split('\n')
    .filter((l) => /shape|extents|Width|Height|rectangles/i.test(l))
    .map((l) => l.trim());
const at = async (x: number, y: number) => {
  sh(['xdotool', 'mousemove', String(Math.round(x)), String(Math.round(y))]);
  await Bun.sleep(250);
};
const click = async (x: number, y: number) => {
  await at(x, y);
  sh(['xdotool', 'click', '1']);
  await Bun.sleep(400);
};

const vite = await startVite();
const shell = await launchShell({ appUrl: vite.url, userDataDir: await mkdtemp(join(tmpdir(), 'artemis-linux-')) });
const errors: string[] = [];
shell.console.on('pageerror', (e) => errors.push(e.message));
try {
  const pid = shell.app.process().pid!;
  report.ozone = await shell.app.evaluate(({ app }) => app.commandLine.getSwitchValue('ozone-platform') || '(default)');
  await shell.console.waitForFunction('typeof window.__artemis === "function"', null, { timeout: 20000 });
  await shell.console.getByRole('textbox', { name: 'Web App' }).fill(siteUrl);
  await shell.console.getByRole('button', { name: 'Engage', exact: true }).click();
  await shell.console.waitForFunction('window.__artemis().engaged === true');
  let page = shell.site();
  for (let i = 0; i < 100 && !page?.url().startsWith(siteUrl); i++) page = (await Bun.sleep(100), shell.site());
  await page!.getByRole('button', { name: 'Press' }).waitFor({ timeout: 10000 });
  await shell.console.waitForFunction('!document.querySelector(".boot")', null, { timeout: 10000 });
  await Bun.sleep(1500);

  // The X windows of the shell: the base (the site view inside it) and the console over it.
  const ids = sh(['xdotool', 'search', '--onlyvisible', '--pid', String(pid)]).split('\n').filter(Boolean);
  const wins = ids.map((id) => ({ id, ...geometry(id), transient: sh(['xprop', '-id', id, 'WM_TRANSIENT_FOR']) }));
  report.windows = wins;
  report.electron = await shell.app.evaluate(({ BaseWindow, BrowserWindow }) => {
    const base = BaseWindow.getAllWindows().find((w) => !(w instanceof BrowserWindow))!;
    const con = BrowserWindow.getAllWindows()[0];
    return { baseBounds: base.getBounds(), baseContent: base.getContentBounds(), console: con.getBounds() };
  });
  const consoleWin = wins.find((w) => w.depth === 32) ?? wins.find((w) => /window id/.test(w.transient));
  const baseWin = wins.find((w) => w !== consoleWin && w.w > 400);
  if (!consoleWin || !baseWin) throw new Error(`X windows not found (a native Wayland client has none): ${JSON.stringify(wins)}`);
  report.overlayAligned = { dx: consoleWin.x - baseWin.x, dy: consoleWin.y - baseWin.y, dw: consoleWin.w - baseWin.w, dh: consoleWin.h - baseWin.h };
  shot('1-engaged');

  // Real pointer over the site: the console asks for pass-through; a real click reaches the site.
  const slot = (await shell.console.locator('.browser-slot').boundingBox())!;
  const press = (await page!.getByRole('button', { name: 'Press' }).boundingBox())!;
  const layout = (await shell.state()).layout!;
  const pressAt = { x: consoleWin.x + layout.x + press.x + press.width / 2, y: consoleWin.y + layout.y + press.y + press.height / 2 };
  await at(consoleWin.x + slot.x + slot.width / 2, consoleWin.y + slot.y + slot.height / 3);
  report.passThroughOverSite = (await shell.state()).passThrough;
  report.inputShapeWhilePassing = inputShape(consoleWin.id);
  await click(pressAt.x, pressAt.y);
  report.siteClicksAfterOne = clicks;
  shot('2-clicked-site');

  // Back over the console's header: the console must take clicks again (no macOS forwarding on
  // Linux: only the site's own pointer reports can tell it).
  const header = (await shell.console.locator('.hud-header').boundingBox())!;
  await at(consoleWin.x + header.x + 60, consoleWin.y + header.y + header.height / 2);
  await Bun.sleep(300);
  report.passThroughOverHeader = (await shell.state()).passThrough;
  report.inputShapeOverHeader = inputShape(consoleWin.id);
  const viewBtn = (await shell.console.getByRole('button', { name: 'View (V)' }).boundingBox())!;
  await click(consoleWin.x + viewBtn.x + viewBtn.width / 2, consoleWin.y + viewBtn.y + viewBtn.height / 2);
  await shell.console.waitForFunction('window.__artemis().viewTransition === null', null, { timeout: 5000 }).catch(() => {});
  report.viewAfterClickingV = await shell.console.evaluate('window.__artemis().view');
  shot('3-cosmos');
  await shell.console.keyboard.press('v');
  await shell.console.waitForFunction('window.__artemis().viewTransition === null && window.__artemis().view === "browser"', null, { timeout: 5000 }).catch(() => {});
  await Bun.sleep(800);

  // The window moved and resized by the window manager: does the console follow?
  sh(['xdotool', 'windowmove', baseWin.id, '120', '60']);
  await Bun.sleep(800);
  sh(['xdotool', 'windowsize', baseWin.id, '1280', '800']);
  await Bun.sleep(1200);
  const b2 = geometry(baseWin.id);
  const c2 = geometry(consoleWin.id);
  report.afterMoveResize = { base: b2, console: c2, dx: c2.x - b2.x, dy: c2.y - b2.y, dw: c2.w - b2.w, dh: c2.h - b2.h };
  // Pass-through after a resize (Electron 43 reset the input shape on every bounds change).
  const slot2 = (await shell.console.locator('.browser-slot').boundingBox())!;
  await at(c2.x + slot2.x + slot2.width / 2, c2.y + slot2.y + slot2.height / 3);
  report.passThroughAfterResize = (await shell.state()).passThrough;
  report.inputShapeAfterResize = inputShape(consoleWin.id);
  const press2 = (await page!.getByRole('button', { name: 'Press' }).boundingBox())!;
  const layout2 = (await shell.state()).layout!;
  const before = clicks;
  await click(c2.x + layout2.x + press2.x + press2.width / 2, c2.y + layout2.y + press2.y + press2.height / 2);
  report.siteClickAfterResize = clicks - before;
  shot('4-moved-resized');
  report.pageErrors = errors;
} catch (e) {
  report.error = String(e);
  shot('error');
} finally {
  await shell.close().catch(() => {});
  vite.stop();
  site.stop(true);
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}
