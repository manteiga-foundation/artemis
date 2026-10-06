import { afterAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSessionStore, type RequestInput, type SessionStore } from '../server/session-store';
import { exportHar, openLiveHar } from '../server/har';
import { harProblems } from './har-spec';

// The session's HAR, written live from the session database: a valid HAR 1.2 after every flush,
// holding the whole session (headers, cookies, typed posts, nothing masked) so a testing tool can
// replay requests already signed in; the bytes of pages and API calls, assets listed without.

const T0 = Date.UTC(2026, 9, 6, 17, 0, 0);
const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

async function session(): Promise<{ s: SessionStore; file: string; db: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'artemis-har-'));
  dirs.push(dir);
  const db = join(dir, 's.sqlite');
  return { s: openSessionStore(db, { target: 'https://shop.example/', startedAt: T0 }), file: join(dir, 's.har'), db };
}
const read = async (file: string) => (await Bun.file(file).json()) as { log: { pages: { id: string; title: string }[]; entries: Entry[] } };
interface Entry {
  pageref?: string;
  startedDateTime: string;
  time: number;
  request: { method: string; url: string; headers: { name: string; value: string }[]; cookies: { name: string; value: string }[]; queryString: { name: string; value: string }[]; postData?: { mimeType: string; text?: string; params?: { name: string; value?: string }[] }; headersSize: number; bodySize: number; httpVersion: string };
  response: { status: number; statusText: string; httpVersion: string; headers: { name: string; value: string }[]; cookies: Record<string, unknown>[]; content: { size: number; mimeType: string; text?: string; encoding?: string; comment?: string }; redirectURL: string; headersSize: number; bodySize: number };
  timings: Record<string, number>;
  _resourceType?: string;
  _error?: string;
  comment?: string;
}
const get = (t: number, url: string, visitId: number | null, resourceType = 'fetch'): RequestInput => ({ t, visitId, method: 'GET', url, resourceType, isNavigation: false, headers: [] });

describe('the live HAR', () => {
  test('is a valid HAR 1.2 from the first page on, after every flush, growing as responses complete', async () => {
    const { s, file } = await session();
    const har = openLiveHar(file, s.db);
    har.flush();
    let doc = await read(file);
    expect(harProblems(doc)).toEqual([]);
    expect(doc.log.entries).toEqual([]);

    const home = s.startVisit({ t: T0, url: 'https://shop.example/', kind: 'document' });
    har.pages();
    const a = s.recordRequest(get(T0 + 5, 'https://shop.example/api/a', home));
    const b = s.recordRequest(get(T0 + 6, 'https://shop.example/api/b', home));
    s.completeRequest(b, { tEnd: T0 + 30, status: 200, headers: [['content-type', 'application/json']], mimeType: 'application/json', body: new TextEncoder().encode('{"b":1}') });
    har.add(b);
    har.flush();
    doc = await read(file);
    expect(harProblems(doc)).toEqual([]);
    expect(doc.log.entries.map((e) => e.request.url)).toEqual(['https://shop.example/api/b']);
    expect(doc.log.pages.map((p) => p.title)).toEqual(['https://shop.example/']);

    // The page's title arrives once it has loaded; the next response follows the first.
    s.updateVisit(home, { title: 'Shop' });
    har.pages();
    s.completeRequest(a, { tEnd: T0 + 40, status: 200, headers: [], mimeType: 'application/json', body: new TextEncoder().encode('{"a":1}') });
    har.add(a);
    har.flush();
    doc = await read(file);
    expect(harProblems(doc)).toEqual([]);
    expect(doc.log.entries.map((e) => e.request.url)).toEqual(['https://shop.example/api/b', 'https://shop.example/api/a']);
    expect(doc.log.entries.every((e) => e.pageref === doc.log.pages[0].id)).toBe(true);
    expect(doc.log.pages.map((p) => p.title)).toEqual(['Shop']);
    expect(doc.log.entries[1].response.content).toMatchObject({ mimeType: 'application/json', text: '{"a":1}' });
    har.close();
    s.close();
  });

  test('keeps the session whole, nothing masked: cookies and Authorization as sent, cookies set, the typed post, status line and sizes', async () => {
    const { s, file } = await session();
    const har = openLiveHar(file, s.db);
    const v = s.startVisit({ t: T0, url: 'https://shop.example/login', kind: 'document' });
    const post = new TextEncoder().encode('email=ana%40example.com&pw=hunter2');
    const r = s.recordRequest({
      t: T0 + 10,
      visitId: v,
      method: 'POST',
      url: 'https://shop.example/login?next=%2Fhome&x=1',
      resourceType: 'document',
      isNavigation: true,
      headers: [
        ['content-type', 'application/x-www-form-urlencoded'],
        ['cookie', 'sid=abc; theme=dark'],
        ['authorization', 'Bearer t0k3n']
      ],
      postData: post
    });
    const tEnd = T0 + 60;
    s.completeRequest(r, {
      tEnd,
      status: 302,
      statusText: 'Found',
      httpVersion: 'HTTP/2.0',
      sizes: { requestBodySize: post.length, requestHeadersSize: 210, responseBodySize: 0, responseHeadersSize: 180 },
      // As Playwright reports them: several Set-Cookie headers joined by newlines.
      headers: [
        ['location', '/home'],
        ['set-cookie', 'sid=new; Path=/; HttpOnly; Secure; Expires=Wed, 21 Oct 2026 07:28:00 GMT\ntheme=light; Domain=shop.example; Max-Age=3600']
      ]
    });
    har.add(r);
    har.close();
    const doc = await read(file);
    expect(harProblems(doc)).toEqual([]);
    const [e] = doc.log.entries;
    expect(e.request.method).toBe('POST');
    expect(e.request.httpVersion).toBe('HTTP/2.0');
    expect(e.request.headers).toEqual([
      { name: 'content-type', value: 'application/x-www-form-urlencoded' },
      { name: 'cookie', value: 'sid=abc; theme=dark' },
      { name: 'authorization', value: 'Bearer t0k3n' }
    ]);
    expect(e.request.cookies).toEqual([
      { name: 'sid', value: 'abc' },
      { name: 'theme', value: 'dark' }
    ]);
    expect(e.request.queryString).toEqual([
      { name: 'next', value: '/home' },
      { name: 'x', value: '1' }
    ]);
    expect(e.request.postData).toEqual({
      mimeType: 'application/x-www-form-urlencoded',
      text: 'email=ana%40example.com&pw=hunter2',
      params: [
        { name: 'email', value: 'ana@example.com' },
        { name: 'pw', value: 'hunter2' }
      ]
    });
    expect([e.request.headersSize, e.request.bodySize]).toEqual([210, post.length]);
    expect([e.response.status, e.response.statusText, e.response.httpVersion, e.response.redirectURL]).toEqual([302, 'Found', 'HTTP/2.0', '/home']);
    expect(e.response.headers.filter((h) => h.name === 'set-cookie').map((h) => h.value)).toEqual([
      'sid=new; Path=/; HttpOnly; Secure; Expires=Wed, 21 Oct 2026 07:28:00 GMT',
      'theme=light; Domain=shop.example; Max-Age=3600'
    ]);
    expect(e.response.cookies).toEqual([
      { name: 'sid', value: 'new', path: '/', expires: '2026-10-21T07:28:00.000Z', httpOnly: true, secure: true },
      { name: 'theme', value: 'light', domain: 'shop.example', expires: new Date(tEnd + 3600_000).toISOString(), httpOnly: false, secure: false }
    ]);
    expect([e.response.headersSize, e.response.bodySize]).toEqual([180, 0]);
    s.close();
  });

  test('bodies: text as text, binary as base64; assets listed with size and type and no bytes; a missing body says why', async () => {
    const { s, file } = await session();
    const har = openLiveHar(file, s.db);
    const v = s.startVisit({ t: T0, url: 'https://shop.example/', kind: 'document' });
    const sizes = (responseBodySize: number) => ({ requestBodySize: 0, requestHeadersSize: 100, responseBodySize, responseHeadersSize: 90 });
    const done = (id: number, o: Partial<Parameters<SessionStore['completeRequest']>[1]>) => {
      s.completeRequest(id, { tEnd: T0 + 50, status: 200, headers: [], ...o });
      har.add(id);
    };
    const binary = s.recordRequest(get(T0 + 1, 'https://shop.example/api/export.bin', v));
    done(binary, { mimeType: 'application/octet-stream', body: new Uint8Array([0xff, 0x00, 0xfe, 0x01]) });
    const logo = s.recordRequest(get(T0 + 2, 'https://shop.example/logo.png', v, 'image'));
    done(logo, { mimeType: 'image/png', sizes: sizes(5120) });
    const beacon = s.recordRequest(get(T0 + 3, 'https://shop.example/api/beacon', v));
    done(beacon, { mimeType: 'application/json', bodyUnavailable: true, sizes: sizes(12) });
    har.close();
    const doc = await read(file);
    expect(harProblems(doc)).toEqual([]);
    const content = (url: string) => doc.log.entries.find((e) => e.request.url.endsWith(url))!.response.content;
    expect(content('/export.bin')).toEqual({ size: 4, mimeType: 'application/octet-stream', text: '/wD+AQ==', encoding: 'base64' });
    expect(content('/logo.png')).toEqual({ size: 5120, mimeType: 'image/png', comment: 'Bytes not kept: Artemis keeps the bodies of pages and API calls; images, scripts, styles and fonts are listed without them.' });
    expect(content('/api/beacon')).toEqual({ size: 12, mimeType: 'application/json', comment: 'Body unavailable: the browser no longer held it when asked (a response the page did not read).' });
    expect(doc.log.entries.find((e) => e.request.url.endsWith('/logo.png'))!._resourceType).toBe('image');
    s.close();
  });

  test("timing: started when the browser began the request, with its phases (blocked, DNS, connect, TLS, wait, receive)", async () => {
    const { s, file } = await session();
    const har = openLiveHar(file, s.db);
    const v = s.startVisit({ t: T0, url: 'https://shop.example/', kind: 'document' });
    const r = s.recordRequest(get(T0 + 3, 'https://shop.example/api/me', v));
    const startTime = T0 + 2.5;
    s.completeRequest(r, {
      tEnd: T0 + 200,
      status: 200,
      headers: [],
      timing: { startTime, domainLookupStart: 1, domainLookupEnd: 11, connectStart: 11, secureConnectionStart: 20, connectEnd: 41, requestStart: 41.5, responseStart: 141.5, responseEnd: 151.5 }
    });
    har.add(r);
    har.close();
    const doc = await read(file);
    expect(harProblems(doc)).toEqual([]);
    const [e] = doc.log.entries;
    expect(e.startedDateTime).toBe(new Date(startTime).toISOString());
    expect(e.timings).toEqual({ blocked: 1, dns: 10, connect: 30, send: 0, wait: 100, receive: 10, ssl: 21 });
    expect(e.time).toBe(151);
    s.close();
  });

  test('a failed request, and one never answered, are entries that say so', async () => {
    const { s, file } = await session();
    const har = openLiveHar(file, s.db);
    const v = s.startVisit({ t: T0, url: 'https://shop.example/', kind: 'document' });
    const failed = s.recordRequest(get(T0 + 1, 'https://down.example/api', v));
    s.failRequest(failed, T0 + 9, 'net::ERR_CONNECTION_REFUSED');
    const open = s.recordRequest(get(T0 + 2, 'https://shop.example/api/slow', v));
    har.add(failed);
    har.add(open);
    har.close();
    const doc = await read(file);
    expect(harProblems(doc)).toEqual([]);
    const [f, o] = doc.log.entries;
    expect([f.response.status, f._error, f.response.content]).toEqual([0, 'net::ERR_CONNECTION_REFUSED', { size: 0, mimeType: 'x-unknown' }]);
    expect([o.response.status, o._error, o.comment]).toEqual([0, undefined, 'No response recorded: the page moved on or the session ended before it answered.']);
    s.close();
  });
});

describe('exportHar', () => {
  test('writes the whole HAR from a session file, in start order, also for sessions recorded before the HAR fields existed', async () => {
    const { s, db } = await session();
    const v = s.startVisit({ t: T0, url: 'https://shop.example/', kind: 'document' });
    s.updateVisit(v, { title: 'Shop' });
    const late = s.recordRequest(get(T0 + 1, 'https://shop.example/api/late', v));
    const early = s.recordRequest(get(T0 + 2, 'https://shop.example/api/early', v));
    s.completeRequest(early, { tEnd: T0 + 5, status: 200, statusText: 'OK', headers: [['set-cookie', 'sid=1; Path=/']], mimeType: 'application/json', body: new TextEncoder().encode('{}') });
    s.completeRequest(late, { tEnd: T0 + 90, status: 200, headers: [], mimeType: 'application/json', body: new TextEncoder().encode('[]') });
    s.recordRequest(get(T0 + 3, 'https://shop.example/api/never', v));
    s.end(T0 + 100);
    s.close();

    const out = db.replace(/\.sqlite$/, '.export.har');
    expect(exportHar(db, out)).toBe(3);
    let doc = await read(out);
    expect(harProblems(doc)).toEqual([]);
    expect(doc.log.entries.map((e) => e.request.url.replace('https://shop.example', ''))).toEqual(['/api/late', '/api/early', '/api/never']);
    expect(doc.log.entries[1].response.cookies).toEqual([{ name: 'sid', value: '1', path: '/', httpOnly: false, secure: false }]);
    expect(doc.log.pages.map((p) => p.title)).toEqual(['Shop']);

    // A session from before schema 2: no status text, HTTP version or sizes columns.
    const old = new Database(db);
    for (const c of ['status_text', 'http_version', 'sizes']) old.exec(`ALTER TABLE requests DROP COLUMN ${c}`);
    old.close();
    expect(exportHar(db, out)).toBe(3);
    doc = await read(out);
    expect(harProblems(doc)).toEqual([]);
    expect(doc.log.entries[1].response).toMatchObject({ status: 200, statusText: '', httpVersion: 'HTTP/1.1', headersSize: -1, bodySize: 2 });
  });

  test('`bun run scripts/har.ts <session.sqlite>` writes `<session>.export.har` beside it and says where', async () => {
    const { s, db } = await session();
    const v = s.startVisit({ t: T0, url: 'https://shop.example/', kind: 'document' });
    const r = s.recordRequest(get(T0 + 1, 'https://shop.example/api/me', v));
    s.completeRequest(r, { tEnd: T0 + 5, status: 200, headers: [], mimeType: 'application/json', body: new TextEncoder().encode('{}') });
    s.close();
    const run = Bun.spawnSync(['bun', 'run', 'scripts/har.ts', db], { cwd: new URL('..', import.meta.url).pathname });
    const out = db.replace(/\.sqlite$/, '.export.har');
    expect(run.exitCode).toBe(0);
    expect(run.stdout.toString()).toContain(`1 entries -> ${out}`);
    const doc = await read(out);
    expect(harProblems(doc)).toEqual([]);
    expect(doc.log.entries.map((e) => e.request.url)).toEqual(['https://shop.example/api/me']);
  });
});
