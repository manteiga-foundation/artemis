import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { launchShell, type Shell } from '../server/shell';
import { inScope } from '../server/session-store';
import { startVite, type ViteServer } from './vite';

// The recorder: while the operator browses in the owned browser, every page view, action, request
// and response goes into the session's SQLite file. Nothing is added to the site's page; actions
// come from the isolated preload, traffic from Playwright.

const third = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch: () => new Response(new Uint8Array([71, 73, 70]), { headers: { 'content-type': 'image/gif' } })
});

const site = Bun.serve({
  hostname: 'localhost',
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const html = (body: string, headers: Record<string, string> = {}) =>
      new Response(`<!doctype html><title>Shop ${url.pathname}</title><link rel="stylesheet" href="/style.css">${body}<script src="/app.js"></script>`, {
        headers: { 'content-type': 'text/html', ...headers }
      });
    if (url.pathname === '/')
      return html(`<h1>Home</h1><a href="/contact">Contact</a><img src="/logo.png" alt="logo"><img src="http://127.0.0.1:${third.port}/pixel.gif" alt="pixel">`, {
        'set-cookie': 'sid=abc; Path=/'
      });
    if (url.pathname === '/contact' && req.method === 'POST') return html(`<h1>Thanks</h1><p>${(await req.text()).length} bytes</p>`);
    if (url.pathname === '/contact')
      return html(
        `<h1>Contact</h1><button onclick="fetch('/api/map').then((r) => r.json()).then((d) => (document.querySelector('#tiles').textContent = d.tiles + ' tiles'))">Load map</button><p id="tiles"></p>
         <form method="post" action="/contact"><label>Email <input name="email" type="email"></label>
         <label>Password <input name="pw" type="password"></label><button>Send</button></form>`
      );
    if (url.pathname === '/app.js') return new Response("fetch('/api/config?page=' + location.pathname)", { headers: { 'content-type': 'text/javascript' } });
    if (url.pathname === '/api/config') return Response.json({ page: url.searchParams.get('page') });
    if (url.pathname === '/api/map') return Response.json({ tiles: 12 });
    if (url.pathname === '/style.css') return new Response('h1{color:teal}', { headers: { 'content-type': 'text/css' } });
    if (url.pathname === '/logo.png') return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } });
    return new Response('not found', { status: 404 });
  }
});
const siteUrl = `http://localhost:${site.port}`;

let vite: ViteServer;
let profileDir: string;
let sessionsDir: string;

beforeAll(async () => {
  vite = await startVite();
  profileDir = await mkdtemp(join(tmpdir(), 'artemis-rec-profile-'));
  sessionsDir = await mkdtemp(join(tmpdir(), 'artemis-rec-sessions-'));
}, 30000);

afterAll(async () => {
  vite?.stop();
  site.stop(true);
  third.stop(true);
  await rm(profileDir, { recursive: true, force: true });
  await rm(sessionsDir, { recursive: true, force: true });
});

async function sitePage(shell: Shell, prefix: string): Promise<Page> {
  for (let i = 0; i < 100; i++) {
    const p = shell.site();
    if (p && p.url().startsWith(prefix)) return p;
    await Bun.sleep(100);
  }
  throw new Error(`site view never reached ${prefix}`);
}

interface Row {
  [k: string]: string | number | null;
}

describe('the recorder', () => {
  test('a browsing session lands in its SQLite file: page views, actions, requests, responses and bodies', async () => {
    const shell = await launchShell({ appUrl: vite.url, userDataDir: profileDir, hidden: true, sessionsDir });
    let path: string | null = null;
    try {
      const c = shell.console;
      await c.waitForFunction('typeof window.__artemis === "function"', null, { timeout: 20000 });
      await c.getByRole('textbox', { name: 'Web App' }).fill(`${siteUrl}/`);
      await c.getByRole('button', { name: 'Engage', exact: true }).click();
      const page = await sitePage(shell, siteUrl);
      await page.getByRole('heading', { name: 'Home' }).waitFor({ timeout: 10000 });
      await page.getByRole('link', { name: 'Contact' }).click();
      await page.getByRole('heading', { name: 'Contact' }).waitFor();
      const map = page.waitForResponse((r) => r.url().endsWith('/api/map'));
      await page.getByRole('button', { name: 'Load map' }).click();
      await map;
      await page.getByText('12 tiles').waitFor();
      await page.getByLabel('Email').fill('ana@example.com');
      await page.getByLabel('Password').fill('hunter2');
      await page.getByRole('button', { name: 'Send' }).click();
      await page.getByRole('heading', { name: 'Thanks' }).waitFor();
      await Bun.sleep(400);
      path = shell.recorder!.path();
    } finally {
      await shell.close();
    }

    expect(path).not.toBeNull();
    expect((await readdir(sessionsDir)).some((f) => join(sessionsDir, f) === path)).toBe(true);
    const db = new Database(path!, { readonly: true });
    try {
      const q = (sql: string) => db.query(sql).all() as Row[];
      const rel = (u: string | number | null) => String(u).replace(siteUrl, '');

      expect(q('SELECT target, scope_host FROM sessions')).toEqual([{ target: `${siteUrl}/`, scope_host: 'localhost' }]);

      // Page views, in order, each with the action that led to it.
      const visits = q(`SELECT v.url, v.kind, v.status, v.title, a.kind AS via_kind, a.name AS via_name
                        FROM visits v LEFT JOIN actions a ON a.id = v.via_action_id ORDER BY v.id`);
      expect(visits.map((v) => [rel(v.url), v.kind, v.status, v.via_kind, v.via_name])).toEqual([
        ['/', 'document', 200, null, null],
        ['/contact', 'document', 200, 'click', 'Contact'],
        ['/contact', 'document', 200, 'submit', null]
      ]);
      expect(visits[1].title).toBe('Shop /contact');

      // The operator's actions, described the way a person (and Playwright) would find them.
      const actions = q('SELECT actor, kind, tag, role, name, field_name, value, sensitive FROM actions ORDER BY t, id');
      expect(actions.map((a) => [a.actor, a.kind, a.role, a.name, a.value, a.sensitive])).toEqual([
        ['user', 'click', 'link', 'Contact', null, 0],
        ['user', 'click', 'button', 'Load map', null, 0],
        ['user', 'input', 'textbox', 'Email', 'ana@example.com', 0],
        ['user', 'input', 'textbox', 'Password', 'hunter2', 1],
        ['user', 'click', 'button', 'Send', null, 0],
        ['user', 'submit', 'form', null, null, 0]
      ]);

      const reqs = q(`SELECT r.*, a.name AS action_name, v.url AS visit_url FROM requests r
                      LEFT JOIN actions a ON a.id = r.action_id LEFT JOIN visits v ON v.id = r.visit_id ORDER BY r.id`);
      const find = (pred: (r: Row) => boolean) => {
        const r = reqs.find(pred);
        if (!r) throw new Error(`no such request among:\n${reqs.map((x) => `${x.method} ${x.url}`).join('\n')}`);
        return r;
      };
      const body = (hash: string | number | null) => new TextDecoder().decode((db.query('SELECT data FROM bodies WHERE hash = ?').get(hash as string) as { data: Uint8Array }).data);

      // Nothing of the console's own traffic.
      expect(reqs.some((r) => String(r.url).startsWith(vite.url))).toBe(false);

      // The page load's API call, with its JSON body; the button's API call, credited to the button.
      const config = find((r) => rel(r.url) === '/api/config?page=/');
      expect([config.resource_type, config.status, config.action_name, rel(config.visit_url)]).toEqual(['fetch', 200, null, '/']);
      expect(JSON.parse(body(config.res_body_hash))).toEqual({ page: '/' });
      const mapReq = find((r) => rel(r.url) === '/api/map');
      expect([mapReq.action_name, rel(mapReq.visit_url)]).toEqual(['Load map', '/contact']);
      expect(JSON.parse(body(mapReq.res_body_hash))).toEqual({ tiles: 12 });

      // Documents keep their bodies; styles and images keep metadata only.
      expect(body(find((r) => rel(r.url) === '/' && r.resource_type === 'document').res_body_hash)).toContain('<h1>Home</h1>');
      const css = find((r) => rel(r.url) === '/style.css');
      expect([css.resource_type, css.status, css.res_body_hash]).toEqual(['stylesheet', 200, null]);
      expect(find((r) => rel(r.url) === '/logo.png').res_body_hash).toBeNull();

      // The third-party pixel is recorded, and it is outside the review scope.
      const pixel = find((r) => String(r.url).includes('/pixel.gif'));
      expect(pixel.host).toBe('127.0.0.1');
      expect(inScope(String(pixel.host), 'localhost')).toBe(false);

      // The form post: a navigation carrying everything typed (kept while testing).
      const post = find((r) => r.method === 'POST');
      expect(post.is_navigation).toBe(1);
      expect(body(post.req_body_hash)).toBe('email=ana%40example.com&pw=hunter2');

      // Credentials travel in headers: kept, marked sensitive.
      const setCookie = (JSON.parse(String(find((r) => rel(r.url) === '/' && r.resource_type === 'document').res_headers)) as [string, string, boolean][]).find(([n]) => n === 'set-cookie');
      expect(setCookie?.[2]).toBe(true);
      const cookie = (JSON.parse(String(mapReq.req_headers)) as [string, string, boolean][]).find(([n]) => n === 'cookie');
      expect(cookie).toEqual(['cookie', 'sid=abc', true]);
    } finally {
      db.close();
    }
  }, 60000);
});
