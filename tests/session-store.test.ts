import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { openSessionStore, keepsBody, isSensitiveHeader, inScope, MAX_BODY_BYTES, type SessionStore } from '../server/session-store';

// The session store: one SQLite database per session holding only observations (visits, actions,
// requests, responses, bodies). Nothing here guesses what a page is.

const T0 = 1_700_000_000_000;
const open = (): SessionStore => openSessionStore(':memory:', { target: 'https://www.shop.example/start', startedAt: T0 });
const one = <T>(s: SessionStore, sql: string, ...params: (string | number | null)[]) => s.db.query(sql).get(...params) as T;
const all = <T>(s: SessionStore, sql: string, ...params: (string | number | null)[]) => s.db.query(sql).all(...params) as T[];

const click = (t: number, name: string) => ({ t, actor: 'user' as const, kind: 'click' as const, pageUrl: 'https://www.shop.example/', target: { tag: 'a', role: 'link', name } });
const get = (t: number, url: string, resourceType = 'fetch') => ({ t, method: 'GET', url, resourceType, isNavigation: false, headers: [] as [string, string][] });

describe('the session store', () => {
  test('a session records its target, the host that defines the review scope, and when it started', () => {
    const s = open();
    expect(one<{ target: string; scope_host: string; started_at: number }>(s, 'SELECT target, scope_host, started_at FROM sessions')).toEqual({
      target: 'https://www.shop.example/start',
      scope_host: 'shop.example',
      started_at: T0
    });
  });

  test('an action belongs to the page view open when it happened; the next page view records the action that led to it', () => {
    const s = open();
    const home = s.startVisit({ t: T0 + 10, url: 'https://www.shop.example/', kind: 'document' });
    const a = s.recordAction(click(T0 + 500, 'Contact'));
    const contact = s.startVisit({ t: T0 + 520, url: 'https://www.shop.example/contact', kind: 'document' });
    expect(one<{ visit_id: number }>(s, 'SELECT visit_id FROM actions WHERE id = ?', a).visit_id).toBe(home);
    expect(one<{ via_action_id: number | null }>(s, 'SELECT via_action_id FROM visits WHERE id = ?', contact).via_action_id).toBe(a);
    expect(one<{ via_action_id: number | null }>(s, 'SELECT via_action_id FROM visits WHERE id = ?', home).via_action_id).toBeNull();
  });

  test('an action reported after the navigation it caused still links to it (the page reports later than the network)', () => {
    const s = open();
    s.startVisit({ t: T0 + 10, url: 'https://www.shop.example/', kind: 'document' });
    const contact = s.startVisit({ t: T0 + 520, url: 'https://www.shop.example/contact', kind: 'document' });
    const a = s.recordAction(click(T0 + 500, 'Contact'));
    expect(one<{ via_action_id: number | null }>(s, 'SELECT via_action_id FROM visits WHERE id = ?', contact).via_action_id).toBe(a);
  });

  test('a page view long after an action is not credited to it', () => {
    const s = open();
    s.startVisit({ t: T0, url: 'https://www.shop.example/', kind: 'document' });
    s.recordAction(click(T0 + 100, 'Somewhere'));
    const later = s.startVisit({ t: T0 + 100 + 10_000, url: 'https://www.shop.example/typed', kind: 'document' });
    expect(one<{ via_action_id: number | null }>(s, 'SELECT via_action_id FROM visits WHERE id = ?', later).via_action_id).toBeNull();
  });

  test('requests belong to the latest earlier action in their page view, even when the action is reported late', () => {
    const s = open();
    const v = s.startVisit({ t: T0, url: 'https://www.shop.example/contact', kind: 'document' });
    const load = s.recordRequest({ ...get(T0 + 50, 'https://www.shop.example/api/config'), visitId: v });
    const map = s.recordRequest({ ...get(T0 + 2_010, 'https://maps.example.net/tiles'), visitId: v });
    const loadMap = s.recordAction({ ...click(T0 + 2_000, 'Load map'), target: { tag: 'button', role: 'button', name: 'Load map' } });
    const after = s.recordRequest({ ...get(T0 + 2_050, 'https://www.shop.example/api/map'), visitId: v });
    const rows = all<{ id: number; action_id: number | null }>(s, 'SELECT id, action_id FROM requests ORDER BY id');
    expect(rows).toEqual([
      { id: load, action_id: null },
      { id: map, action_id: loadMap },
      { id: after, action_id: loadMap }
    ]);
  });

  test('every action carries who performed it: the user now, the autopilot later', () => {
    const s = open();
    s.startVisit({ t: T0, url: 'https://www.shop.example/', kind: 'document' });
    s.recordAction(click(T0 + 1, 'Contact'));
    s.recordAction({ ...click(T0 + 2, 'Pricing'), actor: 'autopilot' });
    expect(all<{ actor: string }>(s, 'SELECT actor FROM actions ORDER BY id').map((r) => r.actor)).toEqual(['user', 'autopilot']);
  });

  test('typed values are kept as typed while testing; password fields are marked sensitive for exports', () => {
    const s = open();
    s.startVisit({ t: T0, url: 'https://www.shop.example/login', kind: 'document' });
    s.recordAction({ t: T0 + 1, actor: 'user', kind: 'input', pageUrl: 'https://www.shop.example/login', target: { tag: 'input', role: 'textbox', name: 'Email', fieldName: 'email', fieldType: 'email' }, value: 'ana@example.com' });
    s.recordAction({ t: T0 + 2, actor: 'user', kind: 'input', pageUrl: 'https://www.shop.example/login', target: { tag: 'input', role: 'textbox', name: 'Password', fieldName: 'pw', fieldType: 'password' }, value: 'hunter2', sensitive: true });
    expect(all(s, 'SELECT field_name, value, sensitive FROM actions ORDER BY id')).toEqual([
      { field_name: 'email', value: 'ana@example.com', sensitive: 0 },
      { field_name: 'pw', value: 'hunter2', sensitive: 1 }
    ]);
  });

  test('a response completes its request: status, headers with credentials marked sensitive, body and timing', () => {
    const s = open();
    const v = s.startVisit({ t: T0, url: 'https://www.shop.example/', kind: 'document' });
    const r = s.recordRequest({ ...get(T0 + 5, 'https://www.shop.example/api/me'), visitId: v, headers: [['accept', 'application/json'], ['cookie', 'sid=1']] });
    const body = new TextEncoder().encode('{"name":"Ana"}');
    s.completeRequest(r, { tEnd: T0 + 40, status: 200, mimeType: 'application/json', headers: [['content-type', 'application/json'], ['set-cookie', 'sid=2']], body });
    const row = one<{ status: number; t_end: number; mime: string; req_headers: string; res_headers: string; res_body_hash: string; res_body_size: number }>(
      s,
      'SELECT status, t_end, mime, req_headers, res_headers, res_body_hash, res_body_size FROM requests WHERE id = ?',
      r
    );
    expect(row.status).toBe(200);
    expect(row.t_end).toBe(T0 + 40);
    expect(row.mime).toBe('application/json');
    expect(JSON.parse(row.req_headers)).toEqual([
      ['accept', 'application/json', false],
      ['cookie', 'sid=1', true]
    ]);
    expect(JSON.parse(row.res_headers)).toEqual([
      ['content-type', 'application/json', false],
      ['set-cookie', 'sid=2', true]
    ]);
    expect(row.res_body_size).toBe(body.length);
    const stored = one<{ data: Uint8Array }>(s, 'SELECT data FROM bodies WHERE hash = ?', row.res_body_hash);
    expect(new TextDecoder().decode(stored.data)).toBe('{"name":"Ana"}');
  });

  test('request bodies (form posts, API payloads) are stored too', () => {
    const s = open();
    const v = s.startVisit({ t: T0, url: 'https://www.shop.example/contact', kind: 'document' });
    const r = s.recordRequest({ ...get(T0 + 5, 'https://www.shop.example/contact', 'document'), method: 'POST', visitId: v, postData: new TextEncoder().encode('email=ana%40example.com') });
    const hash = one<{ req_body_hash: string }>(s, 'SELECT req_body_hash FROM requests WHERE id = ?', r).req_body_hash;
    expect(new TextDecoder().decode(one<{ data: Uint8Array }>(s, 'SELECT data FROM bodies WHERE hash = ?', hash).data)).toBe('email=ana%40example.com');
  });

  test('a missing body says why: too large to keep, or no longer held by the browser (a response the page ignored)', () => {
    const s = open();
    const v = s.startVisit({ t: T0, url: 'https://www.shop.example/', kind: 'document' });
    const big = s.recordRequest({ ...get(T0 + 1, 'https://www.shop.example/api/export'), visitId: v });
    s.completeRequest(big, { tEnd: T0 + 2, status: 200, headers: [], body: new Uint8Array(MAX_BODY_BYTES + 1) });
    const gone = s.recordRequest({ ...get(T0 + 3, 'https://www.shop.example/api/beacon'), visitId: v });
    s.completeRequest(gone, { tEnd: T0 + 4, status: 200, headers: [], body: null, bodyUnavailable: true });
    const kept = s.recordRequest({ ...get(T0 + 5, 'https://www.shop.example/api/me'), visitId: v });
    s.completeRequest(kept, { tEnd: T0 + 6, status: 200, headers: [], body: new TextEncoder().encode('{}') });
    expect(all(s, 'SELECT res_body_hash IS NOT NULL AS has_body, res_body_size, res_body_note FROM requests ORDER BY id')).toEqual([
      { has_body: 0, res_body_size: MAX_BODY_BYTES + 1, res_body_note: 'too large' },
      { has_body: 0, res_body_size: null, res_body_note: 'unavailable' },
      { has_body: 1, res_body_size: 2, res_body_note: null }
    ]);
  });

  test('identical bodies are stored once, by content hash', () => {
    const s = open();
    const v = s.startVisit({ t: T0, url: 'https://www.shop.example/', kind: 'document' });
    for (const t of [1, 2]) {
      const r = s.recordRequest({ ...get(T0 + t, 'https://www.shop.example/api/config'), visitId: v });
      s.completeRequest(r, { tEnd: T0 + t + 1, status: 200, mimeType: 'application/json', headers: [], body: new TextEncoder().encode('{"same":true}') });
    }
    expect(one<{ n: number }>(s, 'SELECT count(*) AS n FROM bodies').n).toBe(1);
    expect(one<{ n: number }>(s, 'SELECT count(DISTINCT res_body_hash) AS n FROM requests').n).toBe(1);
  });

  test('the session file is an ordinary SQLite database another process can open', () => {
    const path = `${process.env.TMPDIR ?? '/tmp'}/artemis-store-${Date.now()}.sqlite`;
    const s = openSessionStore(path, { target: 'https://shop.example/', startedAt: T0 });
    s.startVisit({ t: T0, url: 'https://shop.example/', kind: 'document' });
    s.close();
    const db = new Database(path, { readonly: true });
    expect((db.query('SELECT url FROM visits').get() as { url: string }).url).toBe('https://shop.example/');
    db.close();
  });

  test('a checkpoint puts everything written so far into the session file itself: a copy of the file alone holds it', async () => {
    // Writes land in the `-wal` side file first; a tool that copies or uploads only the
    // `.sqlite` would otherwise see an empty database until Artemis closes.
    const dir = `${process.env.TMPDIR ?? '/tmp'}/artemis-ckpt-${Date.now()}`;
    await mkdir(dir, { recursive: true });
    const s = openSessionStore(`${dir}/live.sqlite`, { target: 'https://shop.example/', startedAt: T0 });
    try {
      const v = s.startVisit({ t: T0, url: 'https://shop.example/', kind: 'document' });
      const r = s.recordRequest({ ...get(T0 + 5, 'https://shop.example/api/me'), visitId: v });
      s.completeRequest(r, { tEnd: T0 + 9, status: 200, headers: [], body: new TextEncoder().encode('{"name":"Ana"}') });
      s.checkpoint();
      await copyFile(`${dir}/live.sqlite`, `${dir}/copy.sqlite`);
      const copy = new Database(`${dir}/copy.sqlite`);
      try {
        expect(copy.query('SELECT url FROM visits').all()).toEqual([{ url: 'https://shop.example/' }]);
        expect(copy.query('SELECT r.url, r.status, b.size FROM requests r JOIN bodies b ON b.hash = r.res_body_hash').all()).toEqual([
          { url: 'https://shop.example/api/me', status: 200, size: 14 }
        ]);
      } finally {
        copy.close();
      }
    } finally {
      s.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('recording policy', () => {
  test('bodies are kept for documents and API calls, not for images, scripts, styles, fonts or media', () => {
    for (const t of ['document', 'fetch', 'xhr']) expect(keepsBody(t)).toBe(true);
    for (const t of ['image', 'script', 'stylesheet', 'font', 'media', 'manifest']) expect(keepsBody(t)).toBe(false);
  });

  test('cookies, credentials and anti-forgery tokens are sensitive headers', () => {
    for (const h of ['Cookie', 'set-cookie', 'Authorization', 'proxy-authorization', 'x-api-key', 'X-CSRF-Token', 'x-xsrf-token']) expect(isSensitiveHeader(h)).toBe(true);
    for (const h of ['accept', 'content-type', 'user-agent', 'referer']) expect(isSensitiveHeader(h)).toBe(false);
  });

  test('the review scope is the target host and its subdomains (www. aside); everything else is outside', () => {
    expect(inScope('shop.example', 'shop.example')).toBe(true);
    expect(inScope('www.shop.example', 'shop.example')).toBe(true);
    expect(inScope('api.shop.example', 'shop.example')).toBe(true);
    expect(inScope('maps.googleapis.com', 'shop.example')).toBe(false);
    expect(inScope('evilshop.example', 'shop.example')).toBe(false);
  });
});
