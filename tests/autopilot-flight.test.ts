import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { launchShell, type Shell } from '../server/shell';
import { applySiteEvents, emptySiteModel } from '../src/site-model';
import { startVite, type ViteServer } from './vite';

// The autopilot flying for real in the owned browser (the user's notes): D steps the speed; at max
// it covers the whole site branch by branch, each page once, two or three of each kind, never
// signing out; its clicks are recorded as the autopilot's; the cosmos comes out as a tree around
// the core. Touching the site while it flies disengages it, like a real autopilot.

const hits = new Map<string, number>();
const nav = '<nav><a href="/">Home</a> <a href="/docs">Docs</a> <a href="/pricing">Pricing</a> <a href="/blog">Blog</a></nav>';
const PAGES: Record<string, string> = {
  '/': `${nav}<h1>Home</h1><p><a href="/logout">Sign out</a> <a href="mailto:hi@example.com">Mail us</a></p><p>${[1, 2, 3, 4, 5].map((n) => `<a href="/product/${n}">Product ${n}</a>`).join(' ')}</p>`,
  '/docs': `${nav}<h1>Docs</h1><a href="/docs/intro">Intro</a> <a href="/docs/api">API</a>`,
  '/docs/intro': `${nav}<h1>Intro</h1>`,
  '/docs/api': `${nav}<h1>API</h1>`,
  '/pricing': `${nav}<h1>Pricing</h1>`,
  '/blog': `${nav}<h1>Blog</h1><a href="/blog/first">First post</a> <a href="/blog/second">Second post</a>`,
  '/blog/first': `${nav}<h1>First post</h1><div style="height:3000px">A long post.</div>`,
  '/blog/second': `${nav}<h1>Second post</h1>`,
  '/logout': '<h1>Signed out</h1>',
  // A tour with one long page, for the slow speed's scrolling.
  '/tour': '<h1>Tour</h1><a href="/tour/long">The long page</a>',
  '/tour/long': '<h1>The long page</h1><div style="height:4000px">Read me slowly.</div>'
};

const site = Bun.serve({
  hostname: 'localhost',
  port: 0,
  fetch(req) {
    const path = new URL(req.url).pathname;
    hits.set(path, (hits.get(path) ?? 0) + 1);
    const body = PAGES[path] ?? (/^\/product\/\d+$/.test(path) ? `${nav}<h1>Product ${path.split('/').pop()}</h1>` : null);
    if (body === null) return new Response('not found', { status: 404 });
    return new Response(`<!doctype html><title>Site ${path}</title><body style="font:16px sans-serif;margin:40px">${body}</body>`, { headers: { 'content-type': 'text/html' } });
  }
});
const siteUrl = `http://localhost:${site.port}`;

let vite: ViteServer;
let profileDir: string;
let sessionsDir: string;

beforeAll(async () => {
  vite = await startVite();
  profileDir = await mkdtemp(join(tmpdir(), 'artemis-ap-profile-'));
  sessionsDir = await mkdtemp(join(tmpdir(), 'artemis-ap-sessions-'));
}, 30000);

afterAll(async () => {
  vite?.stop();
  site.stop(true);
  await rm(profileDir, { recursive: true, force: true });
  await rm(sessionsDir, { recursive: true, force: true });
});

async function engage(c: Page, target: string) {
  await c.getByRole('textbox', { name: 'Web App' }).fill(target);
  await c.getByRole('button', { name: 'Engage', exact: true }).click();
}

async function sitePage(shell: Shell, prefix: string): Promise<Page> {
  for (let i = 0; i < 100; i++) {
    const p = shell.site();
    if (p && p.url().startsWith(prefix)) return p;
    await Bun.sleep(100);
  }
  throw new Error(`site view never reached ${prefix}`);
}

type ConsoleState = { autopilot: number; status: string };
const stateOf = async (c: Page) => (await c.evaluate('window.__artemis()')) as ConsoleState;
const statusIs = (c: Page, prefix: string, timeout: number) =>
  c.waitForFunction((p) => (window as unknown as { __artemis: () => ConsoleState }).__artemis().status.startsWith(p), prefix, { timeout });

describe('the autopilot in the owned browser', () => {
  test('at max speed it flies the whole site branch by branch: each page once, products sampled, never signed out; its clicks are its own; the cosmos is a tree around the core', async () => {
    hits.clear();
    const shell = await launchShell({ appUrl: vite.url, userDataDir: profileDir, hidden: true, sessionsDir, record: { video: false, har: false } });
    const errors: string[] = [];
    shell.console.on('pageerror', (e) => errors.push(e.message));
    try {
      const c = shell.console;
      await engage(c, `${siteUrl}/`);
      const page = await sitePage(shell, siteUrl);
      await page.getByRole('heading', { name: 'Home' }).waitFor({ timeout: 10000 });
      for (let i = 0; i < 3; i++) await c.keyboard.press('d');
      expect((await stateOf(c)).autopilot).toBe(3);
      await statusIs(c, 'Autopilot: the site is covered', 60000);
      expect(await stateOf(c)).toMatchObject({ autopilot: 0, status: 'Autopilot: the site is covered. 10 pages visited, nothing left to open.' });
      expect((await shell.state()).autopilot.speed).toBe(0);

      // Never signed out, never more than three products, never a page twice by following a link.
      expect([hits.get('/logout') ?? 0, hits.get('/product/4') ?? 0, hits.get('/product/5') ?? 0]).toEqual([0, 0, 0]);

      // The cosmos: the core holds the sections, each section its pages.
      const m = emptySiteModel();
      applySiteEvents(m, shell.recorder!.snapshot());
      const path = (i: number | null) => (i === null ? null : new URL(m.nodes[i].key).pathname);
      const parents = Object.fromEntries(m.nodes.filter((n) => n.kind === 'page').map((n) => [new URL(n.key).pathname, path(n.parent)]));
      expect(parents).toEqual({
        '/': null,
        '/docs': '/',
        '/pricing': '/',
        '/blog': '/',
        '/product/1': '/',
        '/product/2': '/',
        '/product/3': '/',
        '/docs/intro': '/docs',
        '/docs/api': '/docs',
        '/blog/first': '/blog',
        '/blog/second': '/blog'
      });

      // Its clicks are recorded as the autopilot's.
      const database = shell.recorder!.path()!;
      await shell.close();
      const db = new Database(database, { readonly: true });
      const actions = db.query('SELECT actor, kind, href FROM actions').all() as { actor: string; kind: string; href: string | null }[];
      db.close();
      expect(actions.length).toBeGreaterThanOrEqual(10);
      expect(new Set(actions.map((a) => `${a.actor} ${a.kind}`))).toEqual(new Set(['autopilot click']));
      expect(errors).toEqual([]);
    } finally {
      await shell.close();
    }
  }, 90000);

  test('the slow speed scrolls down the page for a person to glance at', async () => {
    const shell = await launchShell({ appUrl: vite.url, userDataDir: profileDir, hidden: true });
    try {
      const c = shell.console;
      await engage(c, `${siteUrl}/tour`);
      const page = await sitePage(shell, `${siteUrl}/tour`);
      await page.getByRole('heading', { name: 'Tour' }).waitFor({ timeout: 10000 });
      await c.keyboard.press('d');
      await page.waitForURL((u) => u.pathname === '/tour/long', { timeout: 15000 });
      const scrolled = async () => (await page.evaluate('scrollY')) as number;
      const first = await scrolled();
      await Bun.sleep(3000);
      const later = await scrolled();
      expect(later).toBeGreaterThan(first + 200);
      // Still on the page: slow stays about ten seconds.
      expect(new URL(page.url()).pathname).toBe('/tour/long');
    } finally {
      await shell.close();
    }
  }, 60000);

  test('touching the site while it flies disengages it, and it stays where it was', async () => {
    const shell = await launchShell({ appUrl: vite.url, userDataDir: profileDir, hidden: true });
    try {
      const c = shell.console;
      await engage(c, `${siteUrl}/`);
      const page = await sitePage(shell, siteUrl);
      await page.getByRole('heading', { name: 'Home' }).waitFor({ timeout: 10000 });
      await c.keyboard.press('d'); // slow: about 10 s a page
      await page.waitForURL((u) => u.pathname === '/docs', { timeout: 15000 });
      await Bun.sleep(1200);
      await page.mouse.click(700, 420);
      await statusIs(c, 'Autopilot disengaged', 5000);
      expect(await stateOf(c)).toMatchObject({ autopilot: 0, status: 'Autopilot disengaged: you took the controls.' });
      const where = page.url();
      await Bun.sleep(1500);
      expect(page.url()).toBe(where);
      expect((await shell.state()).autopilot.speed).toBe(0);
    } finally {
      await shell.close();
    }
  }, 60000);
});
