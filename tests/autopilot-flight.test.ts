import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { launchShell, type Shell } from '../server/shell';
import { applySiteEvents, emptySiteModel } from '../src/site-model';
import { startVite, type ViteServer } from './vite';
import { nativeDialogBoxes } from './native-dialogs';

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
  '/tour/long': '<h1>The long page</h1><div style="height:4000px">Read me slowly.</div>',
  // A site that talks back: an alert, a confirm (its answer reported to the server) and a popup,
  // each as soon as its page loads.
  '/d/': '<h1>Talking site</h1><a href="/d/alert">Alert</a> <a href="/d/confirm">Confirm</a> <a href="/d/popup">Popup</a> <a href="/d/plain">Plain</a>',
  '/d/alert': '<h1>Alert page</h1><script>alert("Welcome to the alert page")</script>',
  '/d/confirm': '<h1>Confirm page</h1><script>fetch("/d/answer?confirm=" + confirm("Delete this record?"))</script>',
  '/d/popup': '<h1>Popup page</h1><script>window.open("/d/promo", "promo", "width=320,height=240")</script>',
  '/d/promo': '<h1>Promo</h1>',
  '/d/plain': '<h1>Plain page</h1>',
  '/d/answer': 'ok',
  // Counts its showings in the tab (a Back may restore it from a cache without asking the server)
  // and alerts on the second: the autopilot's return from its one link.
  '/again/':
    '<h1>Again</h1><a href="/again/leaf">Leaf</a><script>function shown() { const n = Number(sessionStorage.n || 0) + 1; sessionStorage.n = n; if (n === 2) alert("Back again"); } addEventListener("pageshow", (e) => e.persisted && shown()); shown();</script>',
  '/again/leaf': '<h1>Leaf</h1>'
};
const answers: string[] = [];

const site = Bun.serve({
  hostname: 'localhost',
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    hits.set(path, (hits.get(path) ?? 0) + 1);
    if (path === '/d/answer') answers.push(url.searchParams.get('confirm') ?? '');
    const body = PAGES[path] ?? (/^\/product\/\d+$/.test(path) ? `${nav}<h1>Product ${path.split('/').pop()}</h1>` : null);
    if (body === null) return new Response('not found', { status: 404 });
    return new Response(`<!doctype html><title>Site ${path}</title><body style="font:16px sans-serif;margin:40px">${body}</body>`, { headers: { 'content-type': 'text/html' } });
  }
});
const siteUrl = `http://localhost:${site.port}`;

// A one-address application with its menu built on demand, the way such back offices do: the menu
// arrives from an API after the page has loaded; only the sections exist at first (in-page links);
// a section builds its categories, a category builds its links to App?comp=... screens. Beside it,
// a dropdown button whose links sit hidden in the page, and a user menu holding Sign out.
const menuHits = new Map<string, number>();
const MENU = {
  'General Ledger': { journal: [['JournalEntries', 18], ['ConversionMode', 93]], 'gl-inquiry': [['BalanceInquiry', 349]] },
  Payables: { invoices: [['Invoices', 50]] }
};
const MENU_SCRIPT = `<nav id="sections"></nav><nav id="categories"></nav><nav id="links"></nav>
<button id="more" aria-expanded="false">More</button><div id="more-menu" hidden><a href="/reports">Reports</a></div>
<button id="user" aria-haspopup="true" aria-expanded="false">Jaime</button><div id="user-menu" hidden><a href="/logout">Sign out</a></div>
<script>
for (const [b, m] of [['more', 'more-menu'], ['user', 'user-menu']]) document.getElementById(b).onclick = (e) => {
  const open = e.currentTarget.getAttribute('aria-expanded') === 'true';
  e.currentTarget.setAttribute('aria-expanded', String(!open));
  document.getElementById(m).hidden = open;
};
setTimeout(async () => {
  const menu = await (await fetch('/api/menu')).json();
  const sections = document.getElementById('sections');
  for (const name of Object.keys(menu)) {
    const a = document.createElement('a');
    a.href = '#' + name.replace(' ', '-');
    a.textContent = name;
    a.onclick = () => {
      const cats = document.getElementById('categories');
      cats.innerHTML = '';
      document.getElementById('links').innerHTML = '';
      for (const cat of Object.keys(menu[name])) {
        const c = document.createElement('a');
        c.href = '#' + cat;
        c.textContent = cat;
        c.onclick = () => {
          document.getElementById('links').innerHTML = menu[name][cat].map(([comp, id]) => '<a href="/App?comp=' + comp + '&NavLinkID=' + id + '">' + comp + '</a>').join(' ');
        };
        cats.append(c, ' ');
      }
    };
    sections.append(a, ' ');
  }
}, 400);
</script>`;
const menuSite = Bun.serve({
  hostname: 'localhost',
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    const key = url.pathname + url.search;
    menuHits.set(key, (menuHits.get(key) ?? 0) + 1);
    if (url.pathname === '/api/menu') return Response.json(MENU);
    const heading = url.pathname === '/Welcome' ? 'Welcome' : url.pathname === '/App' ? url.searchParams.get('comp') : url.pathname === '/reports' ? 'Reports' : url.pathname === '/logout' ? 'Signed out' : null;
    if (!heading) return new Response('not found', { status: 404 });
    return new Response(`<!doctype html><title>${heading}</title><body style="font:16px sans-serif;margin:40px"><h1>${heading}</h1>${MENU_SCRIPT}</body>`, { headers: { 'content-type': 'text/html' } });
  }
});
const menuUrl = `http://localhost:${menuSite.port}`;

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
  menuSite.stop(true);
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
      // The top bar's flight bar, read through the flight.
      await c.evaluate(`window.__bars = []; setInterval(() => {
        const b = document.querySelector('.hud-header [role="progressbar"][aria-label="Autopilot progress"]');
        const r = b ? b.innerText + ' @' + b.getAttribute('aria-valuenow') : 'none';
        if (window.__bars[window.__bars.length - 1] !== r) window.__bars.push(r);
      }, 20)`);
      for (let i = 0; i < 3; i++) await c.keyboard.press('d');
      expect((await stateOf(c)).autopilot).toBe(3);
      await statusIs(c, 'Autopilot: the site is covered', 60000);
      expect(await stateOf(c)).toMatchObject({ autopilot: 0, status: 'Autopilot: the site is covered. 10 pages visited, nothing left to open.' });
      // It showed the real figures (pages visited of pages known, a value), and went with the flight.
      await c.waitForFunction('window.__bars[window.__bars.length - 1] === "none"', null, { timeout: 2000 });
      const bars = (await c.evaluate('window.__bars')) as string[];
      expect(bars.some((r) => /^AP [1-9]\d*\/\d+( · .+)? @\d+$/.test(r))).toBe(true);
      expect(bars.at(-1)).toBe('none');
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

  test('a one-address application whose menu is built on demand: it unfolds the menu (sections, categories, a dropdown), opens every screen behind it by clicking the path, never signs out; every screen is its own page in the cosmos', async () => {
    menuHits.clear();
    const shell = await launchShell({ appUrl: vite.url, userDataDir: profileDir, hidden: true, sessionsDir, record: { video: false, har: false } });
    const errors: string[] = [];
    shell.console.on('pageerror', (e) => errors.push(e.message));
    try {
      const c = shell.console;
      await engage(c, `${menuUrl}/Welcome`);
      const page = await sitePage(shell, menuUrl);
      await page.getByRole('heading', { name: 'Welcome' }).waitFor({ timeout: 10000 });
      for (let i = 0; i < 3; i++) await c.keyboard.press('d');
      await statusIs(c, 'Autopilot: the site is covered', 60000);
      expect((await stateOf(c)).status).toBe('Autopilot: the site is covered. 5 pages visited, nothing left to open.');
      for (const screen of ['/App?comp=JournalEntries&NavLinkID=18', '/App?comp=ConversionMode&NavLinkID=93', '/App?comp=BalanceInquiry&NavLinkID=349', '/App?comp=Invoices&NavLinkID=50', '/reports']) {
        expect(menuHits.get(screen) ?? 0, screen).toBeGreaterThan(0);
      }
      expect(menuHits.get('/logout') ?? 0).toBe(0);

      // Every screen is a page of its own, reached from the Welcome page.
      const m = emptySiteModel();
      applySiteEvents(m, shell.recorder!.snapshot());
      const pages = m.nodes.filter((n) => n.kind === 'page');
      expect(pages.map((n) => n.label).sort()).toEqual(['/App?comp=BalanceInquiry&…', '/App?comp=ConversionMode&…', '/App?comp=Invoices&…', '/App?comp=JournalEntries&…', '/Welcome', '/reports'].sort());
      expect(pages.filter((n) => n.label !== '/Welcome').every((n) => n.parent === pages.findIndex((p) => p.label === '/Welcome'))).toBe(true);

      // Its clicks on the menu and the links are its own, and the screens were opened by clicks.
      const database = shell.recorder!.path()!;
      await shell.close();
      const db = new Database(database, { readonly: true });
      const actions = db.query('SELECT actor, kind, name, href FROM actions').all() as { actor: string; kind: string; name: string | null; href: string | null }[];
      db.close();
      expect(new Set(actions.map((a) => `${a.actor} ${a.kind}`))).toEqual(new Set(['autopilot click']));
      expect(actions.some((a) => a.name === 'General Ledger')).toBe(true);
      expect(actions.some((a) => a.name === 'More')).toBe(true);
      expect(actions.filter((a) => a.href?.includes('/App?comp=')).length).toBe(4);
      expect(errors).toEqual([]);
    } finally {
      await shell.close();
    }
  }, 120000);

  test('a site that opens an alert, a confirm and a popup: it answers them (OK, Cancel), closes the popup, says so, and flies on; nothing is left on screen', async () => {
    const shell = await launchShell({ appUrl: vite.url, userDataDir: profileDir, hidden: true });
    const pid = shell.app.process().pid!;
    try {
      const c = shell.console;
      await engage(c, `${siteUrl}/d/`);
      const page = await sitePage(shell, `${siteUrl}/d/`);
      await page.getByRole('heading', { name: 'Talking site' }).waitFor({ timeout: 10000 });
      await c.evaluate(`window.__said = []; setInterval(() => { const s = window.__artemis().status; if (window.__said[window.__said.length - 1] !== s) window.__said.push(s); }, 20)`);
      for (let i = 0; i < 3; i++) await c.keyboard.press('d');
      await c.waitForFunction('window.__artemis().status.includes("the site is covered")', null, { timeout: 45000 });
      for (const p of ['/d/alert', '/d/confirm', '/d/popup', '/d/plain']) expect(hits.get(p) ?? 0).toBeGreaterThan(0);
      expect(answers).toEqual(['false']);
      // The popup is closed, Electron's native boxes are gone: Artemis takes clicks and keys.
      for (let i = 0; i < 20 && shell.app.windows().length > 2; i++) await Bun.sleep(100);
      expect(shell.app.windows().map((w) => new URL(w.url()).pathname)).not.toContain('/d/promo');
      expect(nativeDialogBoxes(pid)).toBe(0);
      const said = (await c.evaluate('window.__said')) as string[];
      expect(said.some((s) => s.includes('alert "Welcome to the alert page" answered OK'))).toBe(true);
      expect(said.some((s) => s.includes('confirm "Delete this record?" answered Cancel'))).toBe(true);
      expect(said.some((s) => s.includes('closed a popup the site opened'))).toBe(true);
    } finally {
      await shell.close();
    }
  }, 90000);

  test('a page that talks back is not lingered on: right after it answers, it moves on, and no native box is left to block the operator', async () => {
    const shell = await launchShell({ appUrl: vite.url, userDataDir: profileDir, hidden: true });
    const pid = shell.app.process().pid!;
    try {
      const c = shell.console;
      await engage(c, `${siteUrl}/d/`);
      const page = await sitePage(shell, `${siteUrl}/d/`);
      await page.getByRole('heading', { name: 'Talking site' }).waitFor({ timeout: 10000 });
      // Regular: about 3 s on each page; the first link is the alert page.
      for (let i = 0; i < 2; i++) await c.keyboard.press('d');
      await c.waitForFunction('window.__artemis().status.includes("answered OK")', null, { timeout: 15000 });
      await page.waitForURL((u) => u.pathname !== '/d/alert', { timeout: 1500 });
      expect(nativeDialogBoxes(pid)).toBe(0);
    } finally {
      await shell.close();
    }
  }, 60000);

  test('landing right after a page talked back: that page is loaded again, which closes the box it left', async () => {
    const shell = await launchShell({ appUrl: vite.url, userDataDir: profileDir, hidden: true });
    const pid = shell.app.process().pid!;
    try {
      const c = shell.console;
      await engage(c, `${siteUrl}/again/`);
      const page = await sitePage(shell, `${siteUrl}/again/`);
      await page.getByRole('heading', { name: 'Again' }).waitFor({ timeout: 10000 });
      for (let i = 0; i < 3; i++) await c.keyboard.press('d');
      await c.waitForFunction('window.__artemis().status.includes("the site is covered")', null, { timeout: 30000 });
      expect((await c.evaluate('window.__artemis().status')) as string).toContain('1 page visited');
      // Shown at Engage, on the return from its one link (the alert it answered), then loaded again.
      await page.waitForFunction('sessionStorage.n === "3"', null, { timeout: 5000 });
      expect(nativeDialogBoxes(pid)).toBe(0);
    } finally {
      await shell.close();
    }
  }, 60000);

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
