// One SQLite database per review session (bun:sqlite). It holds observations only: page views,
// the operator's actions, every request with its response, and the bodies worth keeping. Nothing
// here decides what a page *is*; categorisation comes later, from the data, and can be recomputed.
// The session file is the database: importing a session means opening the file.
import { Database } from 'bun:sqlite';
import { inScope, scopeHostOf } from '../src/scope';
import type { SiteEvent } from '../src/site-events';

export type Actor = 'user' | 'autopilot';
export type ActionKind = 'click' | 'submit' | 'input';
export type HeaderList = [string, string][];

export interface ActionTarget {
  tag: string;
  role?: string | null;
  name?: string | null;
  selector?: string | null;
  href?: string | null;
  fieldName?: string | null;
  fieldType?: string | null;
}

export interface ActionInput {
  /** Epoch ms, as the page saw it. */
  t: number;
  actor: Actor;
  kind: ActionKind;
  pageUrl: string;
  target: ActionTarget;
  value?: string | null;
  /** Password-like fields: kept while testing, masked by exports. */
  sensitive?: boolean;
}

export interface VisitInput {
  t: number;
  url: string;
  /** A new document, or a route change inside the same document (history API). */
  kind: 'document' | 'same-document';
  title?: string | null;
}

export interface RequestInput {
  t: number;
  visitId: number | null;
  method: string;
  url: string;
  resourceType: string;
  isNavigation: boolean;
  /** The page's own document (main frame), as opposed to frames inside it. */
  mainDocument?: boolean;
  frameUrl?: string | null;
  headers: HeaderList;
  postData?: Uint8Array | null;
  redirectedFrom?: number | null;
}

export interface ResponseInput {
  tEnd: number;
  status: number;
  mimeType?: string | null;
  headers: HeaderList;
  body?: Uint8Array | null;
  /** The body was wanted but the browser no longer held it (typically a response the page ignored). */
  bodyUnavailable?: boolean;
  timing?: unknown;
}

/** A page view is credited to an action that happened at most this long before it. */
export const ACTION_LEADS_TO_VISIT_MS = 5000;
/** Larger response bodies keep their size but not their bytes. */
export const MAX_BODY_BYTES = 5 * 1024 * 1024;

const BODY_TYPES = new Set(['document', 'fetch', 'xhr']);
/** Documents and API calls keep their bodies; images, scripts, styles, fonts and media do not. */
export const keepsBody = (resourceType: string): boolean => BODY_TYPES.has(resourceType);

const SENSITIVE_HEADERS = new Set([
  'cookie',
  'set-cookie',
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'x-auth-token',
  'x-access-token',
  'x-csrf-token',
  'x-xsrf-token'
]);
/** Credentials and anti-forgery tokens: stored, but marked so each export decides. */
export const isSensitiveHeader = (name: string): boolean => SENSITIVE_HEADERS.has(name.toLowerCase());

// The review scope is shared with the console (src/scope.ts), so both draw the same line.
export { inScope, scopeHostOf };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  target TEXT NOT NULL,
  scope_host TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  schema_version INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY,
  t_start INTEGER NOT NULL,
  url TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT,
  status INTEGER,
  via_action_id INTEGER
);
CREATE TABLE IF NOT EXISTS actions (
  id INTEGER PRIMARY KEY,
  visit_id INTEGER,
  t INTEGER NOT NULL,
  actor TEXT NOT NULL,
  kind TEXT NOT NULL,
  page_url TEXT,
  tag TEXT,
  role TEXT,
  name TEXT,
  selector TEXT,
  href TEXT,
  field_name TEXT,
  field_type TEXT,
  value TEXT,
  sensitive INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY,
  visit_id INTEGER,
  action_id INTEGER,
  t_start INTEGER NOT NULL,
  t_end INTEGER,
  method TEXT NOT NULL,
  url TEXT NOT NULL,
  host TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  is_navigation INTEGER NOT NULL,
  main_document INTEGER NOT NULL DEFAULT 0,
  frame_url TEXT,
  redirected_from INTEGER,
  req_headers TEXT,
  req_body_hash TEXT,
  status INTEGER,
  mime TEXT,
  res_headers TEXT,
  res_body_hash TEXT,
  res_body_size INTEGER,
  res_body_note TEXT,
  timing TEXT,
  failure TEXT
);
CREATE TABLE IF NOT EXISTS bodies (
  hash TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  data BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS artifacts (
  kind TEXT NOT NULL,
  file TEXT NOT NULL,
  started_at INTEGER
);
CREATE INDEX IF NOT EXISTS visits_t ON visits (t_start);
CREATE INDEX IF NOT EXISTS actions_visit_t ON actions (visit_id, t);
CREATE INDEX IF NOT EXISTS requests_visit_t ON requests (visit_id, t_start);
`;

const SCHEMA_VERSION = 1;

const marked = (headers: HeaderList): string => JSON.stringify(headers.map(([n, v]) => [n, v, isSensitiveHeader(n)]));

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
};

export interface Artifact {
  /** `video-site`, `video-console`, `har`. */
  kind: string;
  /** File name next to the database, so a session folder can move as a whole. */
  file: string;
  /** Epoch ms the recording started (videos start with the window, before the session). */
  startedAt: number | null;
}

/** Lists files written alongside a session once they are complete (videos, HAR are finished at close). */
export function addArtifacts(path: string, artifacts: Artifact[]): void {
  const db = new Database(path);
  try {
    db.exec(SCHEMA);
    const insert = db.query('INSERT INTO artifacts (kind, file, started_at) VALUES (?, ?, ?)');
    for (const a of artifacts) insert.run(a.kind, a.file, a.startedAt);
  } finally {
    db.close();
  }
}

export interface SessionStore {
  db: Database;
  path: string;
  scopeHost: string;
  startVisit(v: VisitInput): number;
  updateVisit(id: number, patch: { url?: string; title?: string | null; status?: number }): void;
  recordAction(a: ActionInput): number;
  recordRequest(r: RequestInput): number;
  /** Headers and body that arrive after the request was first seen (cookies, post data). */
  updateRequest(id: number, patch: { headers?: HeaderList; postData?: Uint8Array | null }): void;
  completeRequest(id: number, r: ResponseInput): void;
  failRequest(id: number, tEnd: number, failure: string): void;
  end(t: number): void;
  /**
   * Copies what the `-wal` side file holds into the session file itself, without waiting for
   * readers or blocking them (a passive checkpoint), so the `.sqlite` alone is current.
   */
  checkpoint(): void;
  /**
   * The session as the console's live events (src/site-events.ts), for a console that (re)loads.
   * `uncommittedVisit`: a navigation still in flight, sent as not yet committed.
   */
  siteEvents(uncommittedVisit: number | null): SiteEvent[];
  close(): void;
}

export function openSessionStore(path: string, o: { target: string; startedAt: number }): SessionStore {
  const db = new Database(path, { create: true });
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  const scopeHost = scopeHostOf(o.target);
  if (!db.query('SELECT 1 FROM sessions').get()) {
    db.query('INSERT INTO sessions (target, scope_host, started_at, schema_version) VALUES (?, ?, ?, ?)').run(o.target, scopeHost, o.startedAt, SCHEMA_VERSION);
  }

  const id = (r: { lastInsertRowid: number | bigint }) => Number(r.lastInsertRowid);
  const putBody = (bytes: Uint8Array): string => {
    const hash = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
    db.query('INSERT OR IGNORE INTO bodies (hash, size, data) VALUES (?, ?, ?)').run(hash, bytes.length, bytes);
    return hash;
  };

  const visitAt = db.query('SELECT id FROM visits WHERE t_start <= ? ORDER BY t_start DESC, id DESC LIMIT 1');
  const visitBefore = db.query('SELECT t_start FROM visits WHERE t_start <= ? ORDER BY t_start DESC, id DESC LIMIT 1');
  const actionIn = db.query('SELECT id FROM actions WHERE visit_id = ? AND t <= ? ORDER BY t DESC, id DESC LIMIT 1');

  return {
    db,
    path,
    scopeHost,

    startVisit(v) {
      // The action that led here happened while the previous page view was open, shortly before.
      const prev = visitBefore.get(v.t) as { t_start: number } | null;
      const via = db
        .query('SELECT id FROM actions WHERE t <= ? AND t >= ? ORDER BY t DESC, id DESC LIMIT 1')
        .get(v.t, Math.max(prev?.t_start ?? -Infinity, v.t - ACTION_LEADS_TO_VISIT_MS)) as { id: number } | null;
      return id(db.query('INSERT INTO visits (t_start, url, kind, title, via_action_id) VALUES (?, ?, ?, ?, ?)').run(v.t, v.url, v.kind, v.title ?? null, via?.id ?? null));
    },

    updateVisit(visit, patch) {
      if (patch.url !== undefined) db.query('UPDATE visits SET url = ? WHERE id = ?').run(patch.url, visit);
      if (patch.title !== undefined) db.query('UPDATE visits SET title = ? WHERE id = ?').run(patch.title, visit);
      if (patch.status !== undefined) db.query('UPDATE visits SET status = ? WHERE id = ?').run(patch.status, visit);
    },

    recordAction(a) {
      const visit = (visitAt.get(a.t) as { id: number } | null)?.id ?? null;
      const t = a.target;
      const action = id(
        db
          .query(
            `INSERT INTO actions (visit_id, t, actor, kind, page_url, tag, role, name, selector, href, field_name, field_type, value, sensitive)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(visit, a.t, a.actor, a.kind, a.pageUrl, t.tag, t.role ?? null, t.name ?? null, t.selector ?? null, t.href ?? null, t.fieldName ?? null, t.fieldType ?? null, a.value ?? null, a.sensitive ? 1 : 0)
      );
      // The page reports later than the network: credit work already recorded after this moment.
      db.query(
        `UPDATE visits SET via_action_id = ?
         WHERE id = (SELECT id FROM visits WHERE t_start > ? ORDER BY t_start, id LIMIT 1)
           AND t_start - ? <= ?
           AND (via_action_id IS NULL OR (SELECT t FROM actions WHERE actions.id = visits.via_action_id) <= ?)`
      ).run(action, a.t, a.t, ACTION_LEADS_TO_VISIT_MS, a.t);
      if (visit !== null) {
        db.query(
          `UPDATE requests SET action_id = ?
           WHERE visit_id = ? AND t_start >= ?
             AND (action_id IS NULL OR (SELECT t FROM actions WHERE actions.id = requests.action_id) <= ?)`
        ).run(action, visit, a.t, a.t);
      }
      return action;
    },

    recordRequest(r) {
      const action = r.visitId === null ? null : ((actionIn.get(r.visitId, r.t) as { id: number } | null)?.id ?? null);
      return id(
        db
          .query(
            `INSERT INTO requests (visit_id, action_id, t_start, method, url, host, resource_type, is_navigation, main_document, frame_url, redirected_from, req_headers, req_body_hash)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(r.visitId, action, r.t, r.method, r.url, hostOf(r.url), r.resourceType, r.isNavigation ? 1 : 0, r.mainDocument ? 1 : 0, r.frameUrl ?? null, r.redirectedFrom ?? null, marked(r.headers), r.postData?.length ? putBody(r.postData) : null)
      );
    },

    updateRequest(request, patch) {
      if (patch.headers) db.query('UPDATE requests SET req_headers = ? WHERE id = ?').run(marked(patch.headers), request);
      if (patch.postData?.length) db.query('UPDATE requests SET req_body_hash = ? WHERE id = ?').run(putBody(patch.postData), request);
    },

    completeRequest(request, r) {
      const tooLarge = !!r.body && r.body.length > MAX_BODY_BYTES;
      const body = r.body && !tooLarge ? r.body : null;
      const note = tooLarge ? 'too large' : r.bodyUnavailable ? 'unavailable' : null;
      db.query('UPDATE requests SET t_end = ?, status = ?, mime = ?, res_headers = ?, res_body_hash = ?, res_body_size = ?, res_body_note = ?, timing = ? WHERE id = ?').run(
        r.tEnd,
        r.status,
        r.mimeType ?? null,
        marked(r.headers),
        body?.length ? putBody(body) : null,
        r.body ? r.body.length : null,
        note,
        r.timing === undefined ? null : JSON.stringify(r.timing),
        request
      );
    },

    failRequest(request, tEnd, failure) {
      db.query('UPDATE requests SET t_end = ?, failure = ? WHERE id = ?').run(tEnd, failure, request);
    },

    end(t) {
      db.query('UPDATE sessions SET ended_at = ?').run(t);
    },

    checkpoint() {
      if (path !== ':memory:') db.exec('PRAGMA wal_checkpoint(PASSIVE);');
    },

    siteEvents(uncommittedVisit) {
      const s = db.query('SELECT target, scope_host FROM sessions').get() as { target: string; scope_host: string } | null;
      if (!s) return [];
      const events: SiteEvent[] = [{ type: 'session', target: s.target, scopeHost: s.scope_host }];
      type V = { id: number; t_start: number; url: string; kind: 'document' | 'same-document' };
      for (const v of db.query('SELECT id, t_start, url, kind FROM visits ORDER BY id').all() as V[])
        events.push({ type: 'visit', id: v.id, t: v.t_start, url: v.url, kind: v.kind, committed: v.id !== uncommittedVisit });
      type R = { id: number; visit_id: number | null; method: string; url: string; resource_type: string; main_document: number; status: number | null; failure: string | null };
      const answered: SiteEvent[] = [];
      for (const r of db.query('SELECT id, visit_id, method, url, resource_type, main_document, status, failure FROM requests ORDER BY id').all() as R[]) {
        events.push({ type: 'request', id: r.id, visitId: r.visit_id, method: r.method, url: r.url, resourceType: r.resource_type, mainDocument: r.main_document === 1 });
        if (r.status !== null || r.failure !== null) answered.push({ type: 'response', id: r.id, status: r.status, ...(r.failure !== null ? { failed: true } : {}) });
      }
      return [...events, ...answered];
    },

    close() {
      db.close();
    }
  };
}
