import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { crossSiteCookie, ownBrowser, stripFrameAncestors } from '../server/owned-browser';
import { startVite, type ViteServer } from './vite';

// A fixture "website" on localhost (cross-site to the app on 127.0.0.1).
//   /open/      frames freely
//   /locked/    refuses framing (X-Frame-Options + CSP frame-ancestors) and sets a SameSite=Lax
//               session cookie; /locked/second reports whether that cookie came back. Like a real
//               site that notices it is framed, it also carries links that target the top window
//               and a new tab, and /locked/go redirects to /locked/second?via=go.
const site = Bun.serve({
  hostname: 'localhost',
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    const html = (body: string) => `<!doctype html><title>Fixture</title><body style="font:20px sans-serif">${body}</body>`;
    if (url.pathname === '/open/') return new Response(html('<h1>Fixture site</h1><p>open</p>'), { headers: { 'content-type': 'text/html' } });
    if (url.pathname === '/locked/') {
      return new Response(html('<h1>Fixture site</h1><a href="/locked/second">second page</a> <a href="/locked/second" target="_top">top link</a>'), {
        headers: {
          'content-type': 'text/html',
          'x-frame-options': 'DENY',
          'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
          'set-cookie': 'session=abc; Path=/; SameSite=Lax'
        }
      });
    }
    if (url.pathname === '/locked/go') return Response.redirect(`${url.origin}/locked/second?via=go`, 302);
    if (url.pathname === '/locked/second') {
      const has = (req.headers.get('cookie') ?? '').includes('session=abc');
      const via = url.searchParams.get('via');
      return new Response(html(`<h1>Second</h1><p>cookie: ${has ? 'yes' : 'no'}</p>${via ? `<p>via: ${via}</p>` : ''}<a href="/locked/go" target="_blank">new tab link</a>`), {
        headers: { 'content-type': 'text/html', 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'" }
      });
    }
    return new Response('not found', { status: 404 });
  }
});
const siteUrl = `http://localhost:${site.port}`;

let vite: ViteServer;
let plain: Browser;
let profileDir: string;

beforeAll(async () => {
  vite = await startVite();
  plain = await chromium.launch({ headless: true });
  profileDir = await mkdtemp(join(tmpdir(), 'artemis-profile-'));
}, 30000);

afterAll(async () => {
  await plain?.close();
  vite?.stop();
  site.stop(true);
  await rm(profileDir, { recursive: true, force: true });
});

describe('response rewriting', () => {
  test('frame-ancestors is removed from a CSP while every other directive survives', () => {
    expect(stripFrameAncestors("default-src 'self'; frame-ancestors 'none'; img-src *")).toBe("default-src 'self'; img-src *");
    expect(stripFrameAncestors("frame-ancestors 'self'")).toBe('');
    expect(stripFrameAncestors("script-src 'self'")).toBe("script-src 'self'");
  });

  test('cookies become usable inside a cross-site frame', () => {
    expect(crossSiteCookie('session=abc; Path=/; SameSite=Lax')).toBe('session=abc; Path=/; SameSite=None; Secure');
    expect(crossSiteCookie('a=1; Secure; SameSite=Strict; HttpOnly')).toBe('a=1; Secure; HttpOnly; SameSite=None');
    expect(crossSiteCookie('b=2')).toBe('b=2; SameSite=None; Secure');
  });
});

async function engageWith(page: import('playwright').Page, target: string) {
  await page.waitForFunction('typeof window.__artemis === "function"');
  await page.getByRole('textbox', { name: 'Web App' }).fill(target);
  await page.getByRole('button', { name: 'Engage', exact: true }).click();
  await page.waitForFunction('window.__artemis().engaged === true');
}

describe('the browser view shows the real website', () => {
  test('in an ordinary browser a site that allows framing appears live in the slot', async () => {
    const page = await plain.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(vite.url, { waitUntil: 'networkidle' });
      await engageWith(page, `${siteUrl}/open/`);
      const frame = page.frameLocator('.browser-surface iframe');
      await frame.getByText('Fixture site').waitFor({ timeout: 10000 });
      expect(await page.getAttribute('.browser-surface iframe', 'sandbox')).not.toContain('allow-top-navigation');
      // The frame fills the stage: full width, from under the header down behind the bottom panels.
      const box = (await page.locator('.browser-surface iframe').boundingBox())!;
      const card = (await page.locator('.command-card').boundingBox())!;
      const header = (await page.locator('.hud-header').boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(1440);
      expect(box.y).toBeLessThanOrEqual(header.y + header.height + 40);
      expect(box.y + box.height).toBeGreaterThan(card.y + 100);
      expect(box.y + box.height).toBeGreaterThanOrEqual(900 - 2);
      await page.waitForFunction(() => document.querySelector('.browser-state')?.textContent?.includes('LIVE'), null, { timeout: 5000 });
      expect(await page.locator('.browser-state').textContent()).toContain('EXTERNAL');

      // Clicking into the page moves the keyboard into a cross-origin frame the console cannot
      // reach from an external browser: say so, and recover when the console is clicked.
      await frame.locator('body').click();
      await page.waitForFunction(() => document.querySelector('.cmd-hint')?.textContent?.includes('Keyboard is in the page'), null, { timeout: 3000 });
      await page.locator('.hud-header').click();
      await page.waitForFunction(() => !document.querySelector('.cmd-hint')?.textContent?.includes('Keyboard is in the page'), null, { timeout: 3000 });
    } finally {
      await page.close();
    }
  }, 30000);

  test('in an ordinary browser a site that refuses framing stays blank', async () => {
    const page = await plain.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(vite.url, { waitUntil: 'networkidle' });
      await engageWith(page, `${siteUrl}/locked/`);
      await page.waitForSelector('.browser-surface iframe');
      await page.waitForTimeout(1500);
      const text = await page.frameLocator('.browser-surface iframe').locator('body').textContent().catch(() => '');
      expect(text ?? '').not.toContain('Fixture site');
    } finally {
      await page.close();
    }
  }, 30000);

  test('in the browser Artemis owns the same site is framed, navigates, and keeps its session', async () => {
    const owned = await ownBrowser({ appUrl: vite.url, userDataDir: profileDir, headless: true, width: 1440, height: 900 });
    try {
      const { page } = owned;
      await page.waitForLoadState('networkidle');
      await engageWith(page, `${siteUrl}/locked/`);
      expect(await page.locator('.browser-state').textContent()).toContain('OWNED');
      const frame = page.frameLocator('.browser-surface iframe');
      await frame.getByText('Fixture site').waitFor({ timeout: 10000 });
      await frame.getByRole('link', { name: 'second page' }).click();
      await frame.getByText('cookie: yes').waitFor({ timeout: 10000 });

      // The keyboard is now inside the page; V must still switch views in the owned browser.
      await frame.locator('body').click();
      await page.keyboard.press('v');
      await page.waitForFunction('window.__artemis().view === "page"', null, { timeout: 4000 });
      expect(await page.locator('.cmd-hint').textContent()).not.toContain('Keyboard is in the page');
      await page.keyboard.press('c');
      await page.waitForFunction('window.__artemis().panelsHidden === true', null, { timeout: 4000 });

      // Machine readouts arrive from the Bun side: CPU of the machine and of Artemis' own processes.
      await page.waitForFunction('typeof window.__artemis().machine?.cpuPct === "number"', null, { timeout: 8000 });
      const m = (await page.evaluate('window.__artemis().machine')) as { cpuPct: number; memUsedPct: number; artemisCpuPct: number; artemisProcesses: number };
      expect(m.cpuPct).toBeGreaterThanOrEqual(0);
      expect(m.memUsedPct).toBeGreaterThan(0);
      expect(m.artemisProcesses).toBeGreaterThan(0);
      expect(await page.locator('.stat-cpu .stat-value').textContent()).toMatch(/^\d+%$/);
    } finally {
      await owned.close();
    }
  }, 45000);

  test('in the owned browser, links aimed at the top window or a new tab, and redirects, stay inside the frame', async () => {
    const owned = await ownBrowser({ appUrl: vite.url, userDataDir: profileDir, headless: true, width: 1440, height: 900 });
    try {
      const { page, context } = owned;
      await page.waitForLoadState('networkidle');
      await engageWith(page, `${siteUrl}/locked/`);
      const frame = page.frameLocator('.browser-surface iframe');
      await frame.getByText('Fixture site').waitFor({ timeout: 10000 });

      // target="_top" would replace the console (the sandbox blocks it); it must navigate the frame.
      await frame.getByRole('link', { name: 'top link' }).click();
      await frame.getByText('cookie: yes').waitFor({ timeout: 10000 });
      expect(page.url()).toContain(vite.url);
      expect(await page.locator('.app').count()).toBe(1);

      // target="_blank" would open a window outside the console; a redirect must land on the final
      // address, not show the final page under the redirecting URL.
      await frame.getByRole('link', { name: 'new tab link' }).click();
      await frame.getByText('via: go').waitFor({ timeout: 10000 });
      const siteFrame = page.frames().find((f) => f.url().startsWith(siteUrl));
      expect(siteFrame?.url()).toBe(`${siteUrl}/locked/second?via=go`);
      expect(context.pages().length).toBe(1);
    } finally {
      await owned.close();
    }
  }, 45000);
});
