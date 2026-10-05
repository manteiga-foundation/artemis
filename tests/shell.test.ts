import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { launchShell, type Shell } from '../server/shell';
import { startVite, type ViteServer } from './vite';
import { nativeDialogBoxes } from './native-dialogs';

// The owned browser is an Electron shell: the website runs as a genuine, unmodified top-level
// Chromium page (a native view), and the unchanged console sits over it in a transparent window.
// Windows stay hidden during tests (ARTEMIS_SHELL_HIDDEN) so nothing appears on screen.
//
// Fixture site on localhost. /guarded/ defends itself the way Microsoft sign-in does: it refuses
// framing and keeps its body hidden unless it is the top window (in a frame it tries to break
// out). Its link goes through a redirect to /guarded/final.
const site = Bun.serve({
  hostname: 'localhost',
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    const page = (body: string) =>
      new Response(
        `<!doctype html><title>Guarded</title><body style="display:none;font:20px sans-serif;margin:40px"><script>if (self === top) document.body.style.display = 'block'; else { try { top.location = self.location.href; } catch (e) {} }</script>${body}</body>`,
        { headers: { 'content-type': 'text/html', 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'" } }
      );
    if (url.pathname === '/guarded/') return page('<h1>Guarded site</h1><a href="/guarded/go">next page</a><p><input id="field" aria-label="Field"></p>');
    if (url.pathname === '/guarded/go') return Response.redirect(`${url.origin}/guarded/final`, 302);
    if (url.pathname === '/guarded/final') return page('<h1>Final page</h1>');
    const plain = (body: string) => new Response(`<!doctype html><title>Tabs</title><body>${body}</body>`, { headers: { 'content-type': 'text/html' } });
    if (url.pathname === '/tabs/')
      return plain(`<h1>Tabs</h1><a href="/tabs/next" target="_blank">open in a new tab</a> <button onclick="window.open('/tabs/popup', 'signin', 'width=480,height=600')">Sign in</button>`);
    if (url.pathname === '/tabs/next') return plain('<h1>Next</h1>');
    if (url.pathname === '/tabs/popup') return plain('<h1>Popup</h1>');
    // A page that tries to close itself (a link handler: it opens the app elsewhere, then closes),
    // and a popup that closes itself once it is done (a sign-in window).
    if (url.pathname === '/closer/')
      return plain(`<h1>Closer</h1><button onclick="window.close()">Close this page</button> <button onclick="window.open('/closer/popup', 'signin', 'width=420,height=320')">Open a popup that closes itself</button>`);
    if (url.pathname === '/closer/popup') return plain('<h1>Signed in</h1><script>setTimeout(() => window.close(), 400)</script>');
    // Echoes its query and counts its loads (Reload must really reload).
    if (url.pathname === '/q/') return plain(`<h1>Query a=${url.searchParams.get('a')}</h1><p id="hits">${++queryHits}</p>`);
    // A slow page that walks through every loading phase: the answer waits 1.2 s (started), the
    // document arrives in two parts 0.6 s apart (committed, then DOM ready), an image takes another
    // 0.6 s (then loading stops).
    if (url.pathname === '/slow/' || url.pathname === '/slow/next') return slowPage(url.pathname === '/slow/' ? 'Slow page' : 'Slow next');
    if (url.pathname === '/slow/img') return Bun.sleep(600).then(() => new Response(PIXEL, { headers: { 'content-type': 'image/gif' } }));
    return new Response('not found', { status: 404 });
  }
});
const PIXEL = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), (c) => c.charCodeAt(0));
async function slowPage(title: string) {
  await Bun.sleep(1200);
  const text = new TextEncoder();
  const body = new ReadableStream({
    async start(c) {
      c.enqueue(text.encode(`<!doctype html><title>${title}</title><body><h1>${title}</h1>`));
      await Bun.sleep(600);
      c.enqueue(text.encode(`<a href="/slow/next">next slow page</a><img src="/slow/img?${Math.random()}" alt=""></body>`));
      c.close();
    }
  });
  return new Response(body, { headers: { 'content-type': 'text/html' } });
}
let queryHits = 0;
const siteUrl = `http://localhost:${site.port}`;

let vite: ViteServer;
let profileDir: string;

beforeAll(async () => {
  vite = await startVite();
  profileDir = await mkdtemp(join(tmpdir(), 'artemis-shell-'));
}, 30000);

afterAll(async () => {
  vite?.stop();
  site.stop(true);
  await rm(profileDir, { recursive: true, force: true });
});

async function engage(page: Page, target: string) {
  await page.waitForFunction('typeof window.__artemis === "function"', null, { timeout: 20000 });
  await page.getByRole('textbox', { name: 'Web App' }).fill(target);
  await page.getByRole('button', { name: 'Engage', exact: true }).click();
  await page.waitForFunction('window.__artemis().engaged === true');
}

async function sitePage(shell: Shell, prefix: string): Promise<Page> {
  for (let i = 0; i < 100; i++) {
    const p = shell.site();
    if (p && p.url().startsWith(prefix)) return p;
    await Bun.sleep(100);
  }
  throw new Error(`site view never reached ${prefix}`);
}

const stripShows = (page: Page, text: string) =>
  page.waitForFunction((t) => (document.querySelector('.browser-url') as HTMLInputElement | null)?.value?.includes(t), text, { timeout: 8000 });

describe('the owned browser is an Electron shell', () => {
  test('launching with nothing answering on the console address fails fast and says so', async () => {
    const started = Date.now();
    await expect(launchShell({ appUrl: 'http://127.0.0.1:9', userDataDir: profileDir, hidden: true })).rejects.toThrow(/nothing answers on http:\/\/127\.0\.0\.1:9/);
    expect(Date.now() - started).toBeLessThan(5000);
  }, 15000);

  test('the website runs as a genuine top-level page under the console and is followed through redirects', async () => {
    const shell = await launchShell({ appUrl: vite.url, userDataDir: profileDir, hidden: true });
    const errors: string[] = [];
    shell.console.on('pageerror', (e) => errors.push(e.message));
    try {
      await engage(shell.console, `${siteUrl}/guarded/`);
      const page = await sitePage(shell, `${siteUrl}/guarded/`);
      await page.getByRole('heading', { name: 'Guarded site' }).waitFor({ timeout: 10000 });
      // Top-level, so its own defense lets it show; nothing rewrote it and no frame holds it.
      expect(await page.evaluate(() => ({ top: window.top === window.self, display: getComputedStyle(document.body).display }))).toEqual({ top: true, display: 'block' });
      expect(await shell.console.locator('.browser-slot iframe').count()).toBe(0);
      expect(await shell.console.locator('.browser-state').textContent()).toContain('OWNED');
      await stripShows(shell.console, '/guarded/');

      // The native view sits exactly in the console's slot.
      await shell.console.waitForFunction(() => document.querySelector('.browser-slot')!.getBoundingClientRect().height > 0);
      const slot = (await shell.console.locator('.browser-slot').boundingBox())!;
      let state = await shell.state();
      for (let i = 0; i < 30 && !state.siteVisible; i++) state = (await Bun.sleep(100), await shell.state());
      expect(state.siteVisible).toBe(true);
      expect(Math.abs(state.layout!.y - slot.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(state.layout!.h - slot.height)).toBeLessThanOrEqual(1);

      // A link through a redirect: the address strip follows the site to the final address.
      await page.getByRole('link', { name: 'next page' }).click();
      await page.waitForURL(`${siteUrl}/guarded/final`);
      await stripShows(shell.console, '/guarded/final');
      expect(errors).toEqual([]);
    } finally {
      await shell.close();
    }
  }, 60000);

  test('the address strip drives the site like a browser: an edited address (new GET parameters), Back, Forward, Reload', async () => {
    const shell = await launchShell({ appUrl: vite.url, userDataDir: profileDir, hidden: true });
    const errors: string[] = [];
    shell.console.on('pageerror', (e) => errors.push(e.message));
    try {
      const c = shell.console;
      await engage(c, `${siteUrl}/q/?a=1`);
      const page = await sitePage(shell, `${siteUrl}/q/`);
      await page.getByRole('heading', { name: 'Query a=1' }).waitFor({ timeout: 10000 });
      const button = (name: string) => c.locator('.browser-bar').getByRole('button', { name, exact: true });
      await stripShows(c, '/q/?a=1');
      expect([await button('Back').isDisabled(), await button('Forward').isDisabled()]).toEqual([true, true]);

      // Rewrite the query in the address and press Enter: the site goes there.
      const address = c.getByRole('textbox', { name: 'Address' });
      await address.fill(`${siteUrl}/q/?a=2&b=x`);
      await address.press('Enter');
      await page.getByRole('heading', { name: 'Query a=2' }).waitFor({ timeout: 10000 });
      expect(page.url()).toBe(`${siteUrl}/q/?a=2&b=x`);
      await stripShows(c, '/q/?a=2&b=x');

      // Back and Forward walk the site's own history.
      await c.waitForFunction(() => !(document.querySelector('.browser-bar [aria-label="Back"]') as HTMLButtonElement).disabled);
      await button('Back').click();
      await page.getByRole('heading', { name: 'Query a=1' }).waitFor({ timeout: 10000 });
      await stripShows(c, '/q/?a=1');
      await c.waitForFunction(() => !(document.querySelector('.browser-bar [aria-label="Forward"]') as HTMLButtonElement).disabled);
      await button('Forward').click();
      await page.getByRole('heading', { name: 'Query a=2' }).waitFor({ timeout: 10000 });

      // Reload loads the page again from the site.
      const hits = Number(await page.locator('#hits').textContent());
      await button('Reload').click();
      await page.waitForFunction((n) => Number(document.querySelector('#hits')?.textContent) > n, hits, { timeout: 10000 });

      // Keys typed in the address are text, not console hotkeys.
      await address.click();
      await address.press('v');
      expect(((await c.evaluate('window.__artemis()')) as { view: string }).view).toBe('browser');

      // The configuration view covers the stage: the site steps aside and comes back on close.
      await address.press('Escape');
      for (let i = 0; i < 30 && !(await shell.state()).siteVisible; i++) await Bun.sleep(100);
      expect((await shell.state()).siteVisible).toBe(true);
      await c.getByRole('button', { name: 'Settings (,)' }).click();
      await c.getByRole('dialog', { name: 'Settings' }).waitFor({ state: 'visible' });
      for (let i = 0; i < 30 && (await shell.state()).siteVisible; i++) await Bun.sleep(100);
      expect((await shell.state()).siteVisible).toBe(false);
      await c.keyboard.press('Escape');
      for (let i = 0; i < 30 && !(await shell.state()).siteVisible; i++) await Bun.sleep(100);
      expect((await shell.state()).siteVisible).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await shell.close();
    }
  }, 60000);

  test('hotkeys typed in the site reach the console, a field keeps its keys, and clicks pass through only over the site', async () => {
    const shell = await launchShell({ appUrl: vite.url, userDataDir: profileDir, hidden: true });
    try {
      await engage(shell.console, `${siteUrl}/guarded/`);
      const page = await sitePage(shell, `${siteUrl}/guarded/`);
      await page.getByRole('heading', { name: 'Guarded site' }).waitFor({ timeout: 10000 });

      // V pressed in the page (focus not in a field) pulls back to the cosmos; the site view
      // steps aside and comes back, on the same page, when the console returns to the Browser view.
      await page.getByRole('heading', { name: 'Guarded site' }).click();
      await page.keyboard.press('v');
      await shell.console.waitForFunction('window.__artemis().view === "cosmos"', null, { timeout: 4000 });
      await shell.console.waitForFunction('window.__artemis().viewTransition === null', null, { timeout: 4000 });
      expect((await shell.state()).siteVisible).toBe(false);
      await shell.console.keyboard.press('v');
      await shell.console.waitForFunction('window.__artemis().viewTransition === null && window.__artemis().view === "browser"', null, { timeout: 4000 });
      for (let i = 0; i < 30 && !(await shell.state()).siteVisible; i++) await Bun.sleep(100);
      expect((await shell.state()).siteVisible).toBe(true);
      expect(page.url()).toBe(`${siteUrl}/guarded/`);

      // Typing in one of the site's fields is typing, not a command.
      await page.getByRole('textbox', { name: 'Field' }).click();
      await page.keyboard.type('v');
      await Bun.sleep(300);
      expect(await page.getByRole('textbox', { name: 'Field' }).inputValue()).toBe('v');
      expect(await shell.console.evaluate('window.__artemis().view')).toBe('browser');

      // Over the site the console lets clicks through; over its header it keeps them.
      const slot = (await shell.console.locator('.browser-slot').boundingBox())!;
      await shell.console.mouse.move(slot.x + slot.width / 2, slot.y + slot.height / 3);
      await Bun.sleep(150);
      expect((await shell.state()).passThrough).toBe(true);
      const header = (await shell.console.locator('.hud-header').boundingBox())!;
      await shell.console.mouse.move(header.x + 40, header.y + header.height / 2);
      await Bun.sleep(150);
      expect((await shell.state()).passThrough).toBe(false);
    } finally {
      await shell.close();
    }
  }, 60000);

  test('the address field shows the page loading from the site\'s own signals: started, committed, ready, stopped', async () => {
    const shell = await launchShell({ appUrl: vite.url, userDataDir: profileDir, hidden: true });
    try {
      const c = shell.console;
      // Watch the console's load phases (and whether the bar shows) from before Engage.
      await c.evaluate(`window.__phases = []; window.__sawBar = false; setInterval(() => {
        const l = window.__artemis().pageLoad; const ph = l ? l.phase : null;
        if (ph && window.__phases[window.__phases.length - 1] !== ph) window.__phases.push(ph);
        if (document.querySelector('.browser-bar [role="progressbar"][aria-label="Page loading"]')) window.__sawBar = true;
      }, 15)`);
      const phases = () => c.evaluate('window.__phases.slice()') as Promise<string[]>;
      await engage(c, `${siteUrl}/slow/`);
      const page = await sitePage(shell, `${siteUrl}/slow/`);
      await page.getByRole('heading', { name: 'Slow page' }).waitFor({ timeout: 15000 });
      await c.waitForFunction('window.__phases[window.__phases.length - 1] === "done"', null, { timeout: 10000 });
      expect(await phases()).toEqual(['start', 'commit', 'dom', 'done']);
      expect(await c.evaluate('window.__sawBar')).toBe(true);
      await c.waitForFunction(() => !document.querySelector('.browser-bar [role="progressbar"]'), null, { timeout: 3000 });

      // A link followed in the site: the bar again, from the start. (The list restarts from the
      // phase last seen, the first load's done, so the watcher does not record it again.)
      await c.evaluate("window.__phases = ['done']; window.__sawBar = false");
      await page.getByRole('link', { name: 'next slow page' }).click();
      await page.getByRole('heading', { name: 'Slow next' }).waitFor({ timeout: 15000 });
      await c.waitForFunction('window.__phases.length > 1 && window.__phases[window.__phases.length - 1] === "done"', null, { timeout: 10000 });
      expect((await phases()).slice(1)).toEqual(['start', 'commit', 'dom', 'done']);
      expect(await c.evaluate('window.__sawBar')).toBe(true);
    } finally {
      await shell.close();
    }
  }, 60000);

  test('a page that tries to close itself stays, as in Chrome (scripts close only the windows they opened); a popup the site opened still closes itself', async () => {
    const shell = await launchShell({ appUrl: vite.url, userDataDir: profileDir, hidden: true });
    try {
      const c = shell.console;
      await engage(c, `${siteUrl}/closer/`);
      const page = await sitePage(shell, `${siteUrl}/closer/`);
      await page.getByRole('heading', { name: 'Closer' }).waitFor({ timeout: 10000 });
      // Electron let any page close itself: the site view was destroyed, the autopilot lost its
      // page and the next navigation threw in the shell.
      await page.getByRole('button', { name: 'Close this page' }).click();
      await Bun.sleep(800);
      expect(page.isClosed()).toBe(false);
      const address = c.getByRole('textbox', { name: 'Address' });
      await address.fill(`${siteUrl}/tabs/next`);
      await address.press('Enter');
      await page.getByRole('heading', { name: 'Next' }).waitFor({ timeout: 10000 });

      // A popup it opened closes itself when done, as sign-in windows do.
      await address.fill(`${siteUrl}/closer/`);
      await address.press('Enter');
      await page.getByRole('heading', { name: 'Closer' }).waitFor({ timeout: 10000 });
      const before = shell.app.windows().length;
      await page.getByRole('button', { name: 'Open a popup that closes itself' }).click();
      for (let i = 0; i < 30 && shell.app.windows().length === before; i++) await Bun.sleep(100);
      expect(shell.app.windows().length).toBe(before + 1);
      for (let i = 0; i < 40 && shell.app.windows().length > before; i++) await Bun.sleep(100);
      expect(shell.app.windows().length).toBe(before);
    } finally {
      await shell.close();
    }
  }, 60000);

  test('if the site\'s page is ever gone, the shell does not crash: navigating, Back, Forward and Reload do nothing instead of throwing', async () => {
    const shell = await launchShell({ appUrl: vite.url, userDataDir: profileDir, hidden: true });
    try {
      const c = shell.console;
      await engage(c, `${siteUrl}/tabs/next`);
      const page = await sitePage(shell, `${siteUrl}/tabs/next`);
      await page.getByRole('heading', { name: 'Next' }).waitFor({ timeout: 10000 });
      // Lose the site's web contents from the shell's side (what a self-closing page used to do).
      await shell.app.evaluate(({ webContents }, origin) => {
        webContents.getAllWebContents().find((w) => w.getURL().startsWith(origin))?.close();
      }, siteUrl);
      for (let i = 0; i < 30 && !page.isClosed(); i++) await Bun.sleep(100);
      expect(page.isClosed()).toBe(true);
      await Promise.race([c.evaluate(`(() => { const s = window.artemisShell; s.navigate('${siteUrl}/tabs/'); s.back(); s.forward(); s.reload(); })()`), Bun.sleep(3000)]);
      // An uncaught exception would put up Electron's modal error box and stall the main process.
      const answer = await Promise.race([shell.app.evaluate(() => 'answering'), Bun.sleep(3000).then(() => 'stalled')]);
      expect(answer).toBe('answering');
    } finally {
      await Promise.race([shell.close(), Bun.sleep(10000)]);
    }
  }, 60000);

  test('the site\'s dialogs are the operator\'s: Artemis never answers them, a confirm waits for a person in the native box', async () => {
    const shell = await launchShell({ appUrl: vite.url, userDataDir: profileDir, hidden: true });
    const pid = shell.app.process().pid!;
    try {
      await engage(shell.console, `${siteUrl}/tabs/next`);
      const page = await sitePage(shell, `${siteUrl}/tabs/next`);
      await page.getByRole('heading', { name: 'Next' }).waitFor({ timeout: 10000 });
      expect(nativeDialogBoxes(pid)).toBe(0);
      await page.evaluate(`setTimeout(() => { window.__answer = String(confirm('Delete this record?')); }, 50)`);
      await Bun.sleep(1000);
      // Still waiting for a person: Playwright used to answer it at once (Cancel), invisibly, and
      // leave Electron's native box on screen blocking every click and key.
      const answer = await Promise.race([page.evaluate('window.__answer'), Bun.sleep(1500).then(() => 'still waiting')]);
      expect(answer).toBe('still waiting');
      expect(nativeDialogBoxes(pid)).toBe(1);
      // The console is still Artemis's (the main process and the console answer).
      expect(await shell.console.evaluate('window.__artemis().view')).toBe('browser');
    } finally {
      await shell.close();
    }
  }, 60000);

  test('when the console stops hearing the pointer (macOS stops forwarding after a click in the site), the site hands it back: under a panel or out of the site view, clicks return to the console', async () => {
    const shell = await launchShell({ appUrl: vite.url, userDataDir: profileDir, hidden: true });
    try {
      const c = shell.console;
      await engage(c, `${siteUrl}/tabs/next`);
      const page = await sitePage(shell, `${siteUrl}/tabs/next`);
      await page.getByRole('heading', { name: 'Next' }).waitFor({ timeout: 10000 });
      // The entry screen fades out over the site first, and keeps the clicks while it does.
      await c.waitForFunction(() => !document.querySelector('.boot'), null, { timeout: 5000 });
      const slot = (await c.locator('.browser-slot').boundingBox())!;
      const passThrough = async () => (await shell.state()).passThrough;
      const settle = async (want: boolean) => {
        for (let i = 0; i < 20 && (await passThrough()) !== want; i++) await Bun.sleep(50);
        return passThrough();
      };
      const throughOverSite = async () => {
        // A move to where the pointer already is fires nothing (Engage leaves it at the slot's centre).
        await c.mouse.move(slot.x + slot.width / 2 - 60, slot.y + slot.height / 3 - 40);
        await c.mouse.move(slot.x + slot.width / 2, slot.y + slot.height / 3);
        expect(await settle(true)).toBe(true);
      };
      const { x: ox, y: oy } = (await shell.state()).layout!;

      // Under the command card, which floats over the site: only the site sees the pointer now.
      await throughOverSite();
      const card = (await c.locator('.command-card').boundingBox())!;
      await page.mouse.move(card.x + card.width / 2 - ox, card.y + card.height / 2 - oy);
      expect(await settle(false)).toBe(false);

      // Over the open page the site's own reports keep the clicks with the site.
      await throughOverSite();
      await page.mouse.move(slot.width / 2, slot.height / 3 + 20);
      await Bun.sleep(300);
      expect(await passThrough()).toBe(true);

      // Out of the site view, up toward the address strip and the header.
      await page.mouse.move(slot.width / 2, 4);
      await page.mouse.move(slot.width / 2, -30);
      expect(await settle(false)).toBe(false);
    } finally {
      await shell.close();
    }
  }, 60000);

  test('a link aimed at a new tab stays in the site view; a sign-in popup still opens as a popup', async () => {
    const shell = await launchShell({ appUrl: vite.url, userDataDir: profileDir, hidden: true });
    try {
      await engage(shell.console, `${siteUrl}/tabs/`);
      const page = await sitePage(shell, `${siteUrl}/tabs/`);
      await page.getByRole('heading', { name: 'Tabs' }).waitFor({ timeout: 10000 });
      expect(shell.app.windows()).toHaveLength(2);

      // window.open with window features is how sign-in popups work (Microsoft, Google): keep it.
      const popupOpened = shell.app.waitForEvent('window', { timeout: 5000 });
      await page.getByRole('button', { name: 'Sign in' }).click();
      const popup = await popupOpened;
      await popup.waitForURL(`${siteUrl}/tabs/popup`);
      await popup.close();

      // target="_blank" would leave the console behind in a bare window: it loads in the site view.
      await page.getByRole('link', { name: 'open in a new tab' }).click();
      await page.waitForURL(`${siteUrl}/tabs/next`, { timeout: 5000 });
      await stripShows(shell.console, '/tabs/next');
      await Bun.sleep(300);
      expect(shell.app.windows()).toHaveLength(2);
    } finally {
      await shell.close();
    }
  }, 60000);

  test('reloading the console keeps it engaged on the same site page, and machine readouts arrive', async () => {
    const shell = await launchShell({ appUrl: vite.url, userDataDir: profileDir, hidden: true });
    try {
      await engage(shell.console, `${siteUrl}/guarded/`);
      const page = await sitePage(shell, `${siteUrl}/guarded/`);
      await page.getByRole('link', { name: 'next page' }).click();
      await page.waitForURL(`${siteUrl}/guarded/final`);

      await shell.console.reload();
      await shell.console.waitForFunction('typeof window.__artemis === "function" && window.__artemis().engaged === true', null, { timeout: 15000 });
      expect(await shell.console.evaluate('window.__artemis().view')).toBe('browser');
      expect(await shell.console.getByRole('textbox', { name: 'Web App', includeHidden: true }).count()).toBe(0);
      await stripShows(shell.console, '/guarded/final');
      // The site was not sent back to where the review started.
      expect(page.url()).toBe(`${siteUrl}/guarded/final`);

      await shell.console.waitForFunction('typeof window.__artemis().machine?.cpuPct === "number"', null, { timeout: 8000 });
      const m = (await shell.console.evaluate('window.__artemis().machine')) as { memUsedPct: number; artemisProcesses: number };
      expect(m.memUsedPct).toBeGreaterThan(0);
      expect(m.artemisProcesses).toBeGreaterThan(0);
    } finally {
      await shell.close();
    }
  }, 60000);
});
