// Screenshots of the owned browser (Electron shell): the Browser view as the reviewer sees it.
// The shell's windows stay hidden; the frame is composed from the shell's own captures of the
// site view and the console window (an OS screen capture would need Screen Recording permission).
// bun run scripts/screenshots-shell.ts <port> [outDir] [site]
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { launchShell } from '../server/shell';

const port = Number(process.argv[2] ?? 5173);
const outDir = process.argv[3] ?? new URL('../docs/screenshots', import.meta.url).pathname;
const target = process.argv[4] ?? 'https://example.com/';
await mkdir(outDir, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'artemis-shots-'));
const shell = await launchShell({ appUrl: `http://127.0.0.1:${port}`, userDataDir: profile, hidden: true });
const composer = await chromium.launch({ headless: true });

try {
  await shell.console.waitForFunction('typeof window.__artemis === "function"', null, { timeout: 20000 });
  await shell.console.getByRole('textbox', { name: 'Web App' }).fill(target);
  await shell.console.getByRole('button', { name: 'Engage', exact: true }).click();
  await shell.console.waitForFunction('window.__artemis().engaged === true && window.__artemis().pageUrl !== null', null, { timeout: 20000 });

  // The console keeps its size: the window is its top band (traffic lights, no title bar) taller.
  const band = (await shell.state()).band;
  const resize = (w: number, h: number) =>
    shell.app.evaluate(({ BaseWindow }, size) => {
      const win = BaseWindow.getAllWindows().find((x) => x.contentView.children.length > 0)!;
      win.setContentSize(size.w, size.h);
    }, { w, h: h + band });

  /** The frame as the reviewer sees it: the band, then the site view under the console window. */
  const capture = async (name: string) => {
    const caps = await shell.app.evaluate(async ({ BaseWindow, BrowserWindow }) => {
      const win = BaseWindow.getAllWindows().find((x) => !(x instanceof BrowserWindow))!;
      const view = win.contentView.children[0] as unknown as { webContents: Electron.WebContents };
      const consoleWin = BrowserWindow.getAllWindows()[0];
      const [site, ui] = await Promise.all([view.webContents.capturePage(), consoleWin.webContents.capturePage()]);
      const g = globalThis as unknown as { __artemisShell: { layout: { x: number; y: number; w: number; h: number } } };
      return { site: site.toPNG().toString('base64'), ui: ui.toPNG().toString('base64'), layout: g.__artemisShell.layout, size: consoleWin.getContentBounds() };
    });
    const page = await composer.newPage({ viewport: { width: caps.size.width, height: caps.size.height + band }, deviceScaleFactor: 1 });
    const l = caps.layout;
    const light = (x: number, c: string) => `<i style="position:absolute;left:${x}px;top:${(band - 12) / 2}px;width:12px;height:12px;border-radius:50%;background:${c}"></i>`;
    await page.setContent(
      `<body style="margin:0;background:#02061a">${light(14, '#ff5f57')}${light(34, '#febc2e')}${light(54, '#28c840')}<img src="data:image/png;base64,${caps.site}" style="position:absolute;left:${l.x}px;top:${l.y + band}px;width:${l.w}px;height:${l.h}px"><img src="data:image/png;base64,${caps.ui}" style="position:absolute;left:0;top:${band}px;width:${caps.size.width}px;height:${caps.size.height}px"></body>`
    );
    await page.waitForTimeout(200);
    const file = join(outDir, `${name}.png`);
    await page.screenshot({ path: file });
    await page.close();
    console.log(file);
  };

  for (const [w, h] of [[1440, 900], [1280, 800]] as const) {
    await resize(w, h);
    await Bun.sleep(2500); // layout, HUD animation, site repaint
    await capture(`shell-browser-${w}`);
  }

  // The autopilot in flight at the slow speed (D once), a few seconds into a page's scroll.
  await resize(1440, 900);
  await Bun.sleep(1500);
  await shell.console.keyboard.press('d');
  const flying = await shell.console
    .waitForFunction("window.__artemis().status.startsWith('Autopilot: slow ·')", null, { timeout: 40000 })
    .then(() => true)
    .catch(() => false);
  if (flying) {
    await Bun.sleep(3500);
    await capture('shell-autopilot-1440');
  } else console.log('autopilot frame skipped: no page in scope to fly to on this site');
} finally {
  await composer.close();
  await shell.close();
  await rm(profile, { recursive: true, force: true });
}
