// The Interceptor's traffic: what went to the site and what came back, as the panel reads it.
//
// Two sources fill it. The emulated sample (seedTraffic) is a capture shaped like a real session so
// the panel can be designed and tested now: http and websocket, answered, failed, dropped and
// held. The recording (trafficFromSiteEvents) is the owned browser's own observation, fed by
// server/site-feed.ts: a request becomes an entry, its response completes it. Observations only,
// as everywhere in Artemis; nothing here decides what a request means.
//
// Pure data and helpers: no store, no sound, no DOM. The session over it (src/interceptor-session.ts)
// is what arms the proxy, edits, forwards, drops and says so on the console.
import type { SiteEvent } from './site-events';

export type Protocol = 'http' | 'ws';
/**
 * `held` is the proxy waiting for the operator's word; `inflight` is a request the site has open
 * and no answer for yet (observed traffic is not the operator's to hold).
 */
export type EntryState = 'held' | 'inflight' | 'complete' | 'failed' | 'dropped' | 'forwarded';

export interface Header {
  name: string;
  value: string;
}

export interface TrafficEntry {
  id: number;
  /** Epoch ms, as the browser saw it. */
  t: number;
  protocol: Protocol;
  method: string;
  url: string;
  state: EntryState;
  status: number | null;
  /** The page's resource type (document, fetch, xhr, script, websocket, ...). */
  resourceType: string;
  requestHeaders: Header[];
  requestBody: string | null;
  responseHeaders: Header[];
  responseBody: string | null;
  /** Bytes on the wire; null for a request still in flight or one that never answered. */
  requestBytes: number | null;
  responseBytes: number | null;
  durationMs: number | null;
  /** The operator changed this request before it went. */
  edited: boolean;
  /** Came from the recording rather than the sample: it really happened, and cannot be rewound. */
  observed: boolean;
}

export interface Traffic {
  entries: TrafficEntry[];
  /** The proxy is on: requests stop at the Interceptor instead of going straight to the site. */
  armed: boolean;
  /** Hold every request as it arrives, whatever its kind. */
  paused: boolean;
  /** The sample, the recording, or nothing yet. */
  source: 'sample' | 'recorded';
  /** The highest id seen, so a later request cannot take one already used. */
  seq: number;
}

export const emptyTraffic = (): Traffic => ({ entries: [], armed: false, paused: false, source: 'recorded', seq: 0 });

/** The operator can act on their own held request; observed traffic is history and cannot be rewound. */
export const isActionable = (e: TrafficEntry): boolean => e.state === 'held' && !e.observed;

// ---------------------------------------------------------------- reading it

const KB = 1024;

/** Wire sizes as a person reads them: `812 B`, `1.4 kB`, `2.3 MB`. */
export function formatBytes(n: number | null): string {
  if (n === null) return '--';
  if (n < KB) return `${n} B`;
  if (n < KB * KB) return `${(n / KB).toFixed(1)} kB`;
  return `${(n / (KB * KB)).toFixed(1)} MB`;
}

/** Times as a person reads them: `12 ms`, `840 ms`, `1.4 s`. */
export function formatMs(n: number | null): string {
  if (n === null) return '--';
  if (n < 1000) return `${Math.round(n)} ms`;
  return `${(n / 1000).toFixed(1)} s`;
}

/** The host of an entry, for the list's second column. */
export function hostOfEntry(e: TrafficEntry): string {
  try {
    return new URL(e.url).host;
  } catch {
    return e.url;
  }
}

/** The path and query, without the host: what tells two requests to one host apart. */
export function pathOfEntry(e: TrafficEntry): string {
  try {
    const u = new URL(e.url);
    return `${u.pathname}${u.search}`;
  } catch {
    return e.url;
  }
}

/**
 * Whether an entry answers a filter typed in the search field: its method, host, path, status or
 * resource type. Case folded, so `post` finds POST and `/API/` finds `/api/`.
 */
export function matches(e: TrafficEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [e.method, hostOfEntry(e), pathOfEntry(e), e.status === null ? '' : String(e.status), e.resourceType, e.protocol].some((v) =>
    v.toLowerCase().includes(q)
  );
}

export interface TrafficSummary {
  total: number;
  held: number;
  errors: number;
  sockets: number;
  requestBytes: number;
  responseBytes: number;
}

export function summary(entries: TrafficEntry[]): TrafficSummary {
  let held = 0;
  let errors = 0;
  let sockets = 0;
  let requestBytes = 0;
  let responseBytes = 0;
  for (const e of entries) {
    if (e.state === 'held') held++;
    // An error is an error status or a request that never answered. A 101 is a socket switching
    // protocols, not a failure.
    if ((e.status !== null && e.status >= 400) || e.state === 'failed') errors++;
    if (e.protocol === 'ws') sockets++;
    requestBytes += e.requestBytes ?? 0;
    responseBytes += e.responseBytes ?? 0;
  }
  return { total: entries.length, held, errors, sockets, requestBytes, responseBytes };
}

// ---------------------------------------------------------------- the emulated sample
// A capture in the shape of a real review session on an intranet: a document and its assets, an
// API the page polls, a websocket for live updates, one client error, one server error, a request
// the proxy is holding, and one the operator dropped. Fixture words only (no client names).

const H = (name: string, value: string): Header => ({ name, value });

const PAGE_HEADERS = (host: string): Header[] => [
  H(':method', 'GET'),
  H('host', host),
  H('user-agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'),
  H('accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'),
  H('accept-encoding', 'gzip, deflate, br'),
  H('cookie', 'session=fixture-session; locale=en')
];

const DOC_HEADERS: Header[] = [
  H('content-type', 'text/html; charset=utf-8'),
  H('cache-control', 'no-store'),
  H('content-encoding', 'gzip'),
  H('strict-transport-security', 'max-age=31536000; includeSubDomains'),
  H('x-frame-options', 'SAMEORIGIN')
];

const JSON_HEADERS: Header[] = [
  H('content-type', 'application/json; charset=utf-8'),
  H('cache-control', 'no-store'),
  H('content-encoding', 'gzip')
];

const SAMPLE: Omit<TrafficEntry, 'id'>[] = [
  {
    t: 0,
    protocol: 'http',
    method: 'GET',
    url: 'https://intranet.example/home',
    state: 'complete',
    status: 200,
    resourceType: 'document',
    requestHeaders: PAGE_HEADERS('intranet.example'),
    requestBody: null,
    responseHeaders: DOC_HEADERS,
    responseBody: '<!doctype html>\n<html lang="en">\n<head><title>Home</title></head>\n<body><main id="app"></main></body>\n</html>',
    requestBytes: 612,
    responseBytes: 1180,
    durationMs: 186,
    edited: false,
    observed: false
  },
  {
    t: 190,
    protocol: 'http',
    method: 'GET',
    url: 'https://intranet.example/assets/app.css',
    state: 'complete',
    status: 200,
    resourceType: 'stylesheet',
    requestHeaders: [H('host', 'intranet.example'), H('accept', 'text/css,*/*;q=0.1'), H('referer', 'https://intranet.example/home')],
    requestBody: null,
    responseHeaders: [H('content-type', 'text/css; charset=utf-8'), H('cache-control', 'max-age=3600')],
    responseBody: 'html,body{margin:0;font:14px/1.5 system-ui}.app{display:grid;gap:12px}',
    requestBytes: 402,
    responseBytes: 84,
    durationMs: 24,
    edited: false,
    observed: false
  },
  {
    t: 192,
    protocol: 'http',
    method: 'GET',
    url: 'https://intranet.example/assets/app.js',
    state: 'complete',
    status: 200,
    resourceType: 'script',
    requestHeaders: [H('host', 'intranet.example'), H('accept', '*/*'), H('sec-fetch-dest', 'script')],
    requestBody: null,
    responseHeaders: [H('content-type', 'text/javascript; charset=utf-8'), H('cache-control', 'max-age=3600')],
    responseBody: 'const app=document.getElementById("app");fetch("/api/session").then(r=>r.json()).then(s=>{app.textContent=s.user});',
    requestBytes: 418,
    responseBytes: 132,
    durationMs: 31,
    edited: false,
    observed: false
  },
  {
    t: 340,
    protocol: 'http',
    method: 'GET',
    url: 'https://intranet.example/api/session',
    state: 'complete',
    status: 200,
    resourceType: 'fetch',
    requestHeaders: [H('host', 'intranet.example'), H('accept', 'application/json'), H('cookie', 'session=fixture-session'), H('referer', 'https://intranet.example/home')],
    requestBody: null,
    responseHeaders: JSON_HEADERS,
    responseBody: '{"user":"operator","roles":["reviewer"],"expiresIn":840}',
    requestBytes: 388,
    responseBytes: 64,
    durationMs: 72,
    edited: false,
    observed: false
  },
  {
    t: 520,
    protocol: 'http',
    method: 'GET',
    url: 'https://intranet.example/api/orders?page=1&size=25',
    state: 'complete',
    status: 200,
    resourceType: 'fetch',
    requestHeaders: [H('host', 'intranet.example'), H('accept', 'application/json'), H('authorization', 'Bearer fixture-token'), H('referer', 'https://intranet.example/home')],
    requestBody: null,
    responseHeaders: JSON_HEADERS,
    responseBody: '{"items":[{"id":"ORD-1001","total":249.5},{"id":"ORD-1002","total":89.0}],"page":1,"pages":4}',
    requestBytes: 402,
    responseBytes: 148,
    durationMs: 118,
    edited: false,
    observed: false
  },
  {
    t: 700,
    protocol: 'http',
    method: 'POST',
    url: 'https://intranet.example/api/orders/filter',
    state: 'complete',
    status: 200,
    resourceType: 'xhr',
    requestHeaders: [H('host', 'intranet.example'), H('content-type', 'application/json'), H('authorization', 'Bearer fixture-token')],
    requestBody: '{"status":"open","sort":"created"}',
    responseHeaders: JSON_HEADERS,
    responseBody: '{"items":[{"id":"ORD-1001"}],"total":1}',
    requestBytes: 448,
    responseBytes: 52,
    durationMs: 94,
    edited: false,
    observed: false
  },
  {
    t: 940,
    protocol: 'ws',
    method: 'GET',
    url: 'wss://intranet.example/live',
    state: 'complete',
    status: 101,
    resourceType: 'websocket',
    requestHeaders: [H('host', 'intranet.example'), H('connection', 'Upgrade'), H('upgrade', 'websocket'), H('sec-websocket-version', '13')],
    requestBody: null,
    responseHeaders: [H('status', '101 Switching Protocols'), H('upgrade', 'websocket'), H('connection', 'Upgrade')],
    responseBody: '{"channel":"orders","event":"orders.changed"}',
    requestBytes: 402,
    responseBytes: 62,
    durationMs: 41,
    edited: false,
    observed: false
  },
  {
    t: 1120,
    protocol: 'http',
    method: 'GET',
    url: 'https://intranet.example/api/customers/4471/avatar',
    state: 'complete',
    status: 200,
    resourceType: 'image',
    requestHeaders: [H('host', 'intranet.example'), H('accept', 'image/avif,image/webp,*/*')],
    requestBody: null,
    responseHeaders: [H('content-type', 'image/webp'), H('cache-control', 'max-age=86400')],
    responseBody: null,
    requestBytes: 396,
    responseBytes: 8421,
    durationMs: 66,
    edited: false,
    observed: false
  },
  {
    t: 1340,
    protocol: 'http',
    method: 'GET',
    url: 'https://intranet.example/api/reports/quarter',
    state: 'complete',
    status: 404,
    resourceType: 'fetch',
    requestHeaders: [H('host', 'intranet.example'), H('accept', 'application/json'), H('authorization', 'Bearer fixture-token')],
    requestBody: null,
    responseHeaders: [H('content-type', 'application/problem+json')],
    responseBody: '{"type":"about:blank","title":"Not Found","status":404,"detail":"No report for this quarter"}',
    requestBytes: 410,
    responseBytes: 96,
    durationMs: 58,
    edited: false,
    observed: false
  },
  {
    t: 1560,
    protocol: 'http',
    method: 'PUT',
    url: 'https://intranet.example/api/orders/ORD-1001',
    state: 'failed',
    status: null,
    resourceType: 'fetch',
    requestHeaders: [H('host', 'intranet.example'), H('content-type', 'application/json'), H('authorization', 'Bearer fixture-token')],
    requestBody: '{"status":"shipped"}',
    responseHeaders: [],
    responseBody: null,
    requestBytes: 462,
    responseBytes: null,
    durationMs: null,
    edited: false,
    observed: false
  },
  {
    t: 1810,
    protocol: 'http',
    method: 'GET',
    url: 'https://intranet.example/api/exports/stock',
    state: 'complete',
    status: 503,
    resourceType: 'fetch',
    requestHeaders: [H('host', 'intranet.example'), H('accept', 'text/csv')],
    requestBody: null,
    responseHeaders: [H('content-type', 'text/plain'), H('retry-after', '30')],
    responseBody: 'Service Unavailable',
    requestBytes: 384,
    responseBytes: 19,
    durationMs: 2104,
    edited: false,
    observed: false
  },
  {
    t: 2040,
    protocol: 'http',
    method: 'POST',
    url: 'https://intranet.example/api/orders/bulk',
    state: 'held',
    status: null,
    resourceType: 'fetch',
    requestHeaders: [H('host', 'intranet.example'), H('content-type', 'application/json'), H('authorization', 'Bearer fixture-token')],
    requestBody: '{"ids":["ORD-1001","ORD-1002"],"action":"archive"}',
    responseHeaders: [],
    responseBody: null,
    requestBytes: 492,
    responseBytes: null,
    durationMs: null,
    edited: false,
    observed: false
  },
  {
    t: 2210,
    protocol: 'http',
    method: 'GET',
    url: 'https://intranet.example/api/orders/ORD-1002',
    state: 'held',
    status: null,
    resourceType: 'fetch',
    requestHeaders: [H('host', 'intranet.example'), H('accept', 'application/json'), H('authorization', 'Bearer fixture-token')],
    requestBody: null,
    responseHeaders: [],
    responseBody: null,
    requestBytes: 428,
    responseBytes: null,
    durationMs: null,
    edited: false,
    observed: false
  },
  {
    t: 2380,
    protocol: 'http',
    method: 'POST',
    url: 'https://intranet.example/api/analytics/collect',
    state: 'dropped',
    status: null,
    resourceType: 'fetch',
    requestHeaders: [H('host', 'intranet.example'), H('content-type', 'application/json')],
    requestBody: '{"event":"page.view","path":"/home"}',
    responseHeaders: [],
    responseBody: null,
    requestBytes: 431,
    responseBytes: null,
    durationMs: null,
    edited: false,
    observed: false
  },
  {
    t: 2600,
    protocol: 'http',
    method: 'GET',
    url: 'https://cdn.example.net/assets/icons/orders.svg',
    state: 'complete',
    status: 200,
    resourceType: 'image',
    requestHeaders: [H('host', 'cdn.example.net'), H('accept', 'image/svg+xml'), H('referer', 'https://intranet.example/home')],
    requestBody: null,
    responseHeaders: [H('content-type', 'image/svg+xml'), H('access-control-allow-origin', '*'), H('cache-control', 'max-age=31536000')],
    responseBody: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 3h18v18H3z"/></svg>',
    requestBytes: 372,
    responseBytes: 121,
    durationMs: 88,
    edited: false,
    observed: false
  },
  {
    t: 2810,
    protocol: 'http',
    method: 'GET',
    url: 'https://intranet.example/api/notifications?since=0',
    state: 'complete',
    status: 200,
    resourceType: 'fetch',
    requestHeaders: [H('host', 'intranet.example'), H('accept', 'application/json'), H('authorization', 'Bearer fixture-token')],
    requestBody: null,
    responseHeaders: JSON_HEADERS,
    responseBody: '{"items":[{"id":"N-9","text":"Order ORD-1002 archived"}],"unread":1}',
    requestBytes: 438,
    responseBytes: 78,
    durationMs: 63,
    edited: false,
    observed: false
  }
];

/**
 * The sample the panel opens on before anything has been browsed: a small capture in the shape of
 * a real session. Deterministic (fixed ids, fixed times) so screenshots and tests hold still.
 */
export function seedTraffic(): Traffic {
  const t = emptyTraffic();
  t.source = 'sample';
  t.entries = SAMPLE.map((e, i) => ({ ...e, id: i + 1, requestHeaders: [...e.requestHeaders], responseHeaders: [...e.responseHeaders] }));
  t.seq = SAMPLE.length;
  return t;
}

// ---------------------------------------------------------------- the recording

/** `wss:` and `ws:` are sockets; everything else goes over http. */
const protocolOf = (url: string): Protocol => (/^wss?:/i.test(url) ? 'ws' : 'http');

const STATUS_LINE = (status: number): string => (status === 101 ? '101 Switching Protocols' : String(status));

/**
 * Fold the recorder's events into the traffic. The first recording event replaces the sample (the
 * panel then shows what really happened, not an illustration); later ones append. Applying an
 * event twice changes nothing, so a snapshot replayed after live events is harmless, as in
 * src/site-model.ts.
 */
export function trafficFromSiteEvents(traffic: Traffic, events: SiteEvent[]): Traffic {
  const requests = events.filter((e): e is Extract<SiteEvent, { type: 'request' }> => e.type === 'request');
  if (!requests.length && traffic.source === 'sample') return traffic;
  // Observed traffic is history: the sample gives way to it once, at the first request.
  const first = traffic.source === 'sample';
  const entries = first ? [] : [...traffic.entries];
  let seq = first ? 0 : traffic.seq;
  const at = new Map(entries.map((e) => [e.id, e]));

  for (const e of events) {
    if (e.type === 'request') {
      if (at.has(e.id)) continue;
      const entry: TrafficEntry = {
        id: e.id,
        t: Date.now(),
        protocol: protocolOf(e.url),
        method: e.method,
        url: e.url,
        // Open until its response arrives. Observed traffic is the site's business, not the
        // proxy's: an open observed request is in flight, never the operator's to forward or drop.
        state: 'inflight',
        status: null,
        resourceType: e.resourceType,
        requestHeaders: [],
        requestBody: null,
        responseHeaders: [],
        responseBody: null,
        requestBytes: null,
        responseBytes: null,
        durationMs: null,
        edited: false,
        observed: true
      };
      entries.push(entry);
      at.set(e.id, entry);
      seq = Math.max(seq, e.id);
    } else if (e.type === 'response') {
      const entry = at.get(e.id);
      if (!entry) continue;
      const done: TrafficEntry = e.failed || e.status === null
        ? { ...entry, state: 'failed', status: null, responseHeaders: [H('status', 'failed')] }
        : {
            ...entry,
            state: 'complete',
            status: e.status,
            responseHeaders: [H('status', STATUS_LINE(e.status))]
          };
      const i = entries.indexOf(entry);
      entries[i] = done;
      at.set(e.id, done);
    }
  }
  return { entries, armed: traffic.armed, paused: traffic.paused, source: first ? 'recorded' : traffic.source, seq: Math.max(seq, traffic.seq) };
}
