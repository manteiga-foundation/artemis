// The session's HAR, written live from the session database (server/session-store.ts).
//
// HAR 1.2 is one JSON document, so it cannot simply be appended to. The file is kept as
//   {"log":{...,"entries":[ e1, e2, ... ],"pages":[ ... ]}}
// and each flush writes the new entries where the entries end, followed by a fresh tail (the
// pages, whose titles arrive late), so the file is a whole, valid HAR after every flush.
// Entries follow the order their responses completed (the specification prefers start order but
// requires readers to sort for themselves).
//
// Everything comes from the database, so the HAR is a view of the recording: it can be written
// again at any time from the session file (exportHar), and it holds the session whole (headers,
// cookies, typed posts, nothing masked). Bodies are what the database keeps: pages and API calls;
// images, scripts, styles and fonts are listed with their size and type, without their bytes.
import { Database } from 'bun:sqlite';
import { closeSync, ftruncateSync, openSync, readFileSync, writeSync } from 'node:fs';
import { keepsBody, MAX_BODY_BYTES, type WireSizes } from './session-store';

const CREATOR = { name: 'Artemis', version: (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version };
const ASSET_NOTE = 'Bytes not kept: Artemis keeps the bodies of pages and API calls; images, scripts, styles and fonts are listed without them.';

interface RequestRow {
  id: number;
  visit_id: number | null;
  t_start: number;
  t_end: number | null;
  method: string;
  url: string;
  resource_type: string;
  req_headers: string | null;
  req_body_hash: string | null;
  status: number | null;
  mime: string | null;
  res_headers: string | null;
  res_body_hash: string | null;
  res_body_size: number | null;
  res_body_note: string | null;
  timing: string | null;
  failure: string | null;
  status_text?: string | null;
  http_version?: string | null;
  sizes?: string | null;
}

interface Pair {
  name: string;
  value: string;
}

/** Playwright's request timing: epoch start, then milliseconds after it (-1: did not happen). */
interface Timing {
  startTime: number;
  domainLookupStart: number;
  domainLookupEnd: number;
  connectStart: number;
  secureConnectionStart: number;
  connectEnd: number;
  requestStart: number;
  responseStart: number;
  responseEnd: number;
}

const iso = (t: number) => new Date(t).toISOString();
const ms = (n: number) => Math.round(n * 1000) / 1000;

/** Stored as [name, value, sensitive]; one header per line (Set-Cookie arrives joined by newlines). */
const headersOf = (json: string | null): Pair[] =>
  ((json ? JSON.parse(json) : []) as [string, string][]).flatMap(([name, value]) => String(value).split('\n').map((v) => ({ name, value: v })));

const header = (headers: Pair[], name: string) => headers.find((h) => h.name.toLowerCase() === name)?.value;

const utf8 = new TextDecoder('utf-8', { fatal: true });
/** Text when the bytes are UTF-8; otherwise base64, said so. */
const asText = (bytes: Uint8Array): { text: string; base64: boolean } => {
  try {
    return { text: utf8.decode(bytes), base64: false };
  } catch {
    return { text: Buffer.from(bytes).toString('base64'), base64: true };
  }
};

/** `Cookie: a=1; b=2` as the browser sent it. */
const requestCookies = (headers: Pair[]): Pair[] =>
  headers
    .filter((h) => h.name.toLowerCase() === 'cookie')
    .flatMap((h) => h.value.split(';'))
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.indexOf('=');
      return i < 0 ? { name: s, value: '' } : { name: s.slice(0, i), value: s.slice(i + 1) };
    });

/** One `Set-Cookie` line; Max-Age counts from the response and wins over Expires (RFC 6265). */
function responseCookie(line: string, at: number): Record<string, unknown> {
  const [pair, ...attributes] = line.split(';');
  const i = pair.indexOf('=');
  const cookie: Record<string, unknown> = { name: (i < 0 ? pair : pair.slice(0, i)).trim(), value: i < 0 ? '' : pair.slice(i + 1).trim() };
  let expires: string | undefined;
  let maxAge: number | undefined;
  let httpOnly = false;
  let secure = false;
  for (const a of attributes) {
    const eq = a.indexOf('=');
    const key = (eq < 0 ? a : a.slice(0, eq)).trim().toLowerCase();
    const value = eq < 0 ? '' : a.slice(eq + 1).trim();
    if (key === 'path') cookie.path = value;
    else if (key === 'domain') cookie.domain = value;
    else if (key === 'expires' && !Number.isNaN(Date.parse(value))) expires = iso(Date.parse(value));
    else if (key === 'max-age' && value !== '' && Number.isFinite(Number(value))) maxAge = Number(value);
    else if (key === 'httponly') httpOnly = true;
    else if (key === 'secure') secure = true;
  }
  if (maxAge !== undefined) expires = iso(at + maxAge * 1000);
  if (expires) cookie.expires = expires;
  return { ...cookie, httpOnly, secure };
}

function timingsOf(r: RequestRow) {
  const t = r.timing ? (JSON.parse(r.timing) as Timing) : null;
  if (!t || !(t.startTime > 0)) {
    const wait = r.t_end !== null ? Math.max(0, r.t_end - r.t_start) : 0;
    return { started: r.t_start, time: wait, timings: { blocked: -1, dns: -1, connect: -1, send: 0, wait, receive: 0, ssl: -1 } };
  }
  const span = (a: number, b: number) => (a >= 0 && b >= a ? ms(b - a) : -1);
  const firstStep = [t.domainLookupStart, t.connectStart, t.requestStart].find((x) => x >= 0);
  const timings = {
    blocked: firstStep === undefined ? -1 : ms(firstStep),
    dns: span(t.domainLookupStart, t.domainLookupEnd),
    connect: span(t.connectStart, t.connectEnd),
    send: 0,
    wait: Math.max(0, span(t.requestStart, t.responseStart)),
    receive: Math.max(0, span(t.responseStart, t.responseEnd)),
    ssl: t.secureConnectionStart >= 0 ? span(t.secureConnectionStart, t.connectEnd) : -1
  };
  const time = ms([timings.blocked, timings.dns, timings.connect, timings.send, timings.wait, timings.receive].reduce((s, x) => s + (x > 0 ? x : 0), 0));
  return { started: t.startTime, time, timings };
}

/** One HAR entry for a recorded request, from its row in the session database. */
export function harEntry(db: Database, id: number): Record<string, unknown> | null {
  const r = db.query('SELECT * FROM requests WHERE id = ?').get(id) as RequestRow | null;
  if (!r) return null;
  const body = (hash: string | null) => (hash ? ((db.query('SELECT data FROM bodies WHERE hash = ?').get(hash) as { data: Uint8Array } | null)?.data ?? null) : null);
  const reqHeaders = headersOf(r.req_headers);
  const resHeaders = headersOf(r.res_headers);
  const httpVersion = r.http_version || 'HTTP/1.1';
  const sizes = r.sizes ? (JSON.parse(r.sizes) as WireSizes) : null;
  const { started, time, timings } = timingsOf(r);
  const resBody = body(r.res_body_hash);
  const content: Record<string, unknown> = { size: resBody?.length ?? r.res_body_size ?? sizes?.responseBodySize ?? 0, mimeType: r.mime ?? 'x-unknown' };
  if (resBody) {
    const { text, base64 } = asText(resBody);
    content.text = text;
    if (base64) content.encoding = 'base64';
  } else if (r.res_body_note === 'too large') content.comment = `Body not kept: larger than ${MAX_BODY_BYTES} bytes.`;
  else if (r.res_body_note === 'unavailable') content.comment = 'Body unavailable: the browser no longer held it when asked (a response the page did not read).';
  else if (!keepsBody(r.resource_type) && r.status !== null) content.comment = ASSET_NOTE;
  let query: Pair[] = [];
  try {
    query = [...new URL(r.url).searchParams].map(([name, value]) => ({ name, value }));
  } catch {
    // not a URL with a query
  }
  const post = body(r.req_body_hash);
  let postData: Record<string, unknown> | undefined;
  if (post) {
    const mimeType = header(reqHeaders, 'content-type') ?? '';
    const { text, base64 } = asText(post);
    postData = { mimeType, text };
    if (base64) Object.assign(postData, { _encoding: 'base64', comment: 'Binary body: text holds it in base64.' });
    // Like browsers' own HARs: the raw text for an exact replay, and the fields for reading.
    else if (mimeType.toLowerCase().startsWith('application/x-www-form-urlencoded')) postData.params = [...new URLSearchParams(text)].map(([name, value]) => ({ name, value }));
  }
  const answeredAt = r.t_end ?? r.t_start;
  return {
    ...(r.visit_id !== null ? { pageref: `page_${r.visit_id}` } : {}),
    startedDateTime: iso(started),
    time,
    request: {
      method: r.method,
      url: r.url,
      httpVersion,
      cookies: requestCookies(reqHeaders),
      headers: reqHeaders,
      queryString: query,
      ...(postData ? { postData } : {}),
      headersSize: sizes?.requestHeadersSize ?? -1,
      bodySize: sizes?.requestBodySize ?? post?.length ?? 0
    },
    response: {
      status: r.status ?? 0,
      statusText: r.status_text ?? '',
      httpVersion,
      cookies: resHeaders.filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => responseCookie(h.value, answeredAt)),
      headers: resHeaders,
      content,
      redirectURL: (r.status ?? 0) >= 300 && (r.status ?? 0) < 400 ? (header(resHeaders, 'location') ?? '') : '',
      headersSize: sizes?.responseHeadersSize ?? -1,
      bodySize: sizes?.responseBodySize ?? resBody?.length ?? -1
    },
    cache: {},
    timings,
    _resourceType: r.resource_type,
    ...(r.failure !== null ? { _error: r.failure } : r.status === null ? { comment: 'No response recorded: the page moved on or the session ended before it answered.' } : {})
  };
}

const pagesOf = (db: Database) =>
  (db.query('SELECT id, t_start, url, title FROM visits ORDER BY id').all() as { id: number; t_start: number; url: string; title: string | null }[]).map((v) => ({
    startedDateTime: iso(v.t_start),
    id: `page_${v.id}`,
    title: v.title || v.url,
    pageTimings: { onContentLoad: -1, onLoad: -1 }
  }));

export interface LiveHar {
  path: string;
  /** A request whose response completed (or failed): written at the next flush. */
  add(requestId: number): void;
  /** Page views changed (a new one, a title): the pages are written at the next flush. */
  pages(): void;
  /** Writes what was added since the last flush; the file is a valid HAR afterwards. */
  flush(): void;
  close(): void;
}

export function openLiveHar(path: string, db: Database): LiveHar {
  const fd = openSync(path, 'w');
  const head = Buffer.from(`{"log":{"version":"1.2","creator":${JSON.stringify(CREATOR)},"entries":[`);
  writeSync(fd, head, 0, head.length, 0);
  let end = head.length;
  let count = 0;
  let queue: number[] = [];
  const written = new Set<number>();
  let pagesChanged = true;
  let closed = false;

  const write = () => {
    const ids = queue.filter((id) => !written.has(id) && (written.add(id), true));
    queue = [];
    const parts = ids.map((id) => harEntry(db, id)).filter((e) => e !== null).map((e) => JSON.stringify(e));
    const entries = parts.length ? (count ? ',' : '') + parts.join(',') : '';
    const tail = `],"pages":${JSON.stringify(pagesOf(db))}}}`;
    const buf = Buffer.from(entries + tail);
    writeSync(fd, buf, 0, buf.length, end);
    end += Buffer.byteLength(entries);
    count += parts.length;
    ftruncateSync(fd, end + Buffer.byteLength(tail));
    pagesChanged = false;
  };
  write();

  return {
    path,
    add: (id) => void queue.push(id),
    pages: () => void (pagesChanged = true),
    flush() {
      if (closed || (!queue.length && !pagesChanged)) return;
      write();
    },
    close() {
      if (closed) return;
      this.flush();
      closed = true;
      closeSync(fd);
    }
  };
}

/**
 * Writes the whole HAR of a session file, entries in start order (and the requests never
 * answered). Works on sessions recorded before the HAR fields existed, and on a session still
 * being recorded. Returns the number of entries.
 */
export function exportHar(sessionFile: string, out: string): number {
  // Read-write without creating: a read-only open of a WAL database fails when its -shm is gone.
  const db = new Database(sessionFile, { readwrite: true, create: false });
  try {
    const ids = (db.query('SELECT id FROM requests ORDER BY t_start, id').all() as { id: number }[]).map((r) => r.id);
    const har = openLiveHar(out, db);
    for (const id of ids) har.add(id);
    har.close();
    return ids.length;
  } finally {
    db.close();
  }
}
