import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { launchShell, type Shell } from '../server/shell';
import { startVite, type ViteServer } from './vite';

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
    return new Response('not found', { status: 404 });
  }
});
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
  page.waitForFunction((t) => document.querySelector('.browser-url')?.textContent?.includes(t), text, { timeout: 8000 });

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
