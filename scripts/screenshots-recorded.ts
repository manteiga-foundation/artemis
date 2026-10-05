// Screenshots of the recorded cosmos in the owned browser: browse a real site in the shell, pull
// back with V, and capture the console window (the site is hidden in the Cosmos view): the landing
// on the current page, the whole recorded site, and Scope on (outside hosts hidden).
// bun run scripts/screenshots-recorded.ts <port> [outDir] [site] [pages]
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { launchShell } from '../server/shell';

const port = Number(process.argv[2] ?? 5173);
const outDir = process.argv[3] ?? new URL('../docs/screenshots', import.meta.url).pathname;
const target = process.argv[4] ?? 'https://en.wikipedia.org/wiki/Main_Page';
const pages = Number(process.argv[5] ?? 10);
await mkdir(outDir, { recursive: true });
const scratch = await mkdtemp(join(tmpdir(), 'artemis-recorded-'));
const shell = await launchShell({
  appUrl: `http://127.0.0.1:${port}`,
  userDataDir: join(scratch, 'profile'),
  sessionsDir: join(scratch, 'sessions'),
  hidden: true,
  record: { video: false, har: false }
});
const composer = await chromium.launch({ headless: true });
const c = shell.console;

const capture = async (name: string) => {
  const ui = await shell.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  const page = await composer.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:0;background:#02061a"><img src="data:image/png;base64,${ui}" style="position:absolute;inset:0;width:100%;height:100%"></body>`);
  await page.waitForTimeout(200);
  const file = join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  await page.close();
  console.log(file, JSON.stringify(await c.evaluate('({ nodes: window.__artemis().nodeCount, links: window.__artemis().linkCount, status: window.__artemis().status })')));
};

try {
  // The console at 1440x900: the window is its top band taller.
  const band = (await shell.state()).band;
  await shell.app.evaluate(({ BaseWindow }, h) => BaseWindow.getAllWindows().find((x) => x.contentView.children.length > 0)!.setContentSize(1440, h), 900 + band);
  await c.waitForFunction('typeof window.__artemis === "function"', null, { timeout: 20000 });
  await c.getByRole('textbox', { name: 'Web App' }).fill(target);
  await c.getByRole('button', { name: 'Engage', exact: true }).click();
  let site = shell.site()!;
  for (let i = 0; i < 100 && !site.url().startsWith('http'); i++) (await Bun.sleep(100), (site = shell.site()!));
  await site.waitForLoadState('load', { timeout: 20000 });

  // Browse the way a reviewer would: a few branches from the home page, each two pages deep,
  // never the same page twice, staying on the target's host.
  const host = new URL(target).host;
  const seen = new Set<string>([new URL(site.url()).pathname]);
  const next = async (k: number) => {
    const hrefs = (await site.evaluate(`(() => {
      const scope = document.querySelector('main, #content, [role="main"]') || document.body;
      return [...scope.querySelectorAll('a[href]')]
        .filter((a) => a.host === ${JSON.stringify(host)} && !/:|index\\.php/.test(a.pathname) && a.offsetParent !== null)
        .map((a) => a.origin + a.pathname);
    })()`)) as string[];
    const fresh = [...new Set(hrefs)].filter((h) => !seen.has(new URL(h).pathname));
    return fresh.length ? fresh[(k * 7 + 3) % fresh.length] : null;
  };
  const go = async (href: string) => {
    seen.add(new URL(href).pathname);
    await site.goto(href).catch(() => {});
    await site.waitForLoadState('load', { timeout: 20000 }).catch(() => {});
    await Bun.sleep(1200);
  };
  for (let b = 0; seen.size <= pages && b < pages; b++) {
    if (b > 0) await go(target);
    for (let depth = 0; depth < 2; depth++) {
      const href = await next(b * 2 + depth);
      if (!href) break;
      await go(href);
    }
  }
  await Bun.sleep(1000);

  await c.getByRole('button', { name: 'View (V)' }).click();
  await c.waitForFunction('window.__artemis().view === "cosmos" && window.__artemis().viewTransition === null', null, { timeout: 5000 });
  await Bun.sleep(2500);
  await capture('cosmos-recorded-landing');
  // The whole recorded site: drop the selection (Esc); Focus then tours the sections and, the
  // press after the last one, fits the whole network.
  await c.keyboard.press('Escape');
  for (let i = 0; i < 60; i++) {
    await c.getByRole('button', { name: 'Focus (F)' }).click();
    if ((await c.evaluate('window.__artemis().status')) === 'Full network in view.') break;
  }
  await Bun.sleep(2000);
  await capture('cosmos-recorded');
  await c.getByRole('button', { name: 'Scope (E)' }).click();
  await Bun.sleep(2500);
  await capture('cosmos-recorded-scope');
} finally {
  await composer.close();
  await shell.close();
  await rm(scratch, { recursive: true, force: true });
}
