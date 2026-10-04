// The recorder: while the operator browses in the owned browser, every page view, action, request
// and response of the website goes into the session's SQLite file (server/session-store.ts).
//
// Traffic comes from Playwright, which already owns the Electron shell: nothing is added to the
// site's page. Actions come from the site preload (an isolated world) through the shell's main
// process, which queues them; the recorder drains that queue. The page reports later than the
// network, so actions are matched to page views and requests by time, not by arrival order.
//
// A session starts with the website's first page (the address the console engaged) and is one
// file in `sessionsDir`. Popups are not recorded yet.
import { join } from 'node:path';
import type { ElectronApplication, Page, Request, Response } from 'playwright';
import { keepsBody, openSessionStore, type ActionInput, type SessionStore } from './session-store';
import type { SiteEvent } from '../src/site-events';

export interface Recorder {
  /** The current session's file, or null before the first page. */
  path(): string | null;
  /** Drains the last actions, marks the session ended and closes the file. */
  stop(): Promise<void>;
  /** Live events for the console's cosmos, emitted as they are written. Returns an unsubscribe. */
  onEvent(listener: (e: SiteEvent) => void): () => void;
  /** Everything recorded so far, as events (for a console that reloads). */
  snapshot(): SiteEvent[];
}

const isWeb = (url: string) => /^https?:\/\//i.test(url);

/** `20261004T194512-shop.example.sqlite`: sortable, and says which site it is. */
export const sessionFileName = (target: string, t: number): string =>
  `${new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '')}-${new URL(target).hostname.replace(/[^a-z0-9.-]/gi, '_')}.sqlite`;

type ReportedAction = Omit<ActionInput, 'actor'>;

export function startRecorder(o: { app: ElectronApplication; site: Page; sessionsDir: string; pollMs?: number }): Recorder {
  const { app, site } = o;
  let store: SessionStore | null = null;
  let closed = false;
  let visitId: number | null = null;
  /** A document navigation is in flight: the next main-frame commit belongs to it. */
  let documentPending = false;
  const requestIds = new WeakMap<Request, number>();
  const requestVisit = new WeakMap<Request, number | null>();
  /** Bodies are asked for as soon as the response arrives: a navigation discards them. */
  const responseBodies = new WeakMap<Request, Promise<Buffer | null>>();
  const listeners = new Set<(e: SiteEvent) => void>();
  const emit = (e: SiteEvent) => {
    for (const l of listeners) l(e);
  };

  /** Writes stop once the file is closed; late Playwright events are dropped. */
  const write = (fn: (s: SessionStore) => void) => {
    if (!store || closed) return;
    try {
      fn(store);
    } catch {
      // A malformed event must never take the browser down; the next one is recorded.
    }
  };
  const ofSite = (req: Request): boolean => {
    try {
      return req.frame().page() === site;
    } catch {
      return false; // service workers have no frame
    }
  };
  const isMainDocument = (req: Request) => req.isNavigationRequest() && req.frame() === site.mainFrame();

  const ctx = app.context();
  const onRequest = (req: Request) => {
    const url = req.url();
    if (closed || !isWeb(url) || !ofSite(req)) return;
    const t = Date.now();
    const redirectedFrom = req.redirectedFrom();
    if (isMainDocument(req)) {
      if (!store) {
        store = openSessionStore(join(o.sessionsDir, sessionFileName(url, t)), { target: url, startedAt: t });
        emit({ type: 'session', target: url, scopeHost: store.scopeHost });
      }
      // A redirect hop is the same page view arriving somewhere else.
      if (redirectedFrom && requestIds.has(redirectedFrom) && visitId !== null) write((s) => s.updateVisit(visitId!, { url }));
      else
        write((s) => {
          visitId = s.startVisit({ t, url, kind: 'document' });
          emit({ type: 'visit', id: visitId, t, url, kind: 'document', committed: false });
        });
      documentPending = true;
    }
    write((s) => {
      const mainDocument = isMainDocument(req);
      const id = s.recordRequest({
        t,
        visitId,
        method: req.method(),
        url,
        resourceType: req.resourceType(),
        isNavigation: req.isNavigationRequest(),
        mainDocument,
        frameUrl: req.frame().url() || null,
        headers: Object.entries(req.headers()),
        postData: req.postDataBuffer() ?? null,
        redirectedFrom: redirectedFrom ? (requestIds.get(redirectedFrom) ?? null) : null
      });
      requestIds.set(req, id);
      requestVisit.set(req, visitId);
      emit({ type: 'request', id, visitId, method: req.method(), url, resourceType: req.resourceType(), mainDocument });
      // The full set (cookies included) is only known once the network stack has sent it.
      req
        .allHeaders()
        .then((h) => write((s2) => s2.updateRequest(id, { headers: Object.entries(h) })))
        .catch(() => {});
    });
  };

  const onResponse = (res: Response) => {
    const req = res.request();
    if (requestIds.has(req) && keepsBody(req.resourceType())) responseBodies.set(req, res.body().catch(() => null));
  };

  const onFinished = async (req: Request) => {
    const id = requestIds.get(req);
    if (id === undefined) return;
    const res = await req.response().catch(() => null);
    if (!res) return;
    const [headers, body] = await Promise.all([res.allHeaders().catch(() => res.headers()), responseBodies.get(req) ?? Promise.resolve(null)]);
    const timing = req.timing();
    const tEnd = timing.responseEnd >= 0 ? Math.round(timing.startTime + timing.responseEnd) : Date.now();
    write((s) => {
      const wanted = keepsBody(req.resourceType()) && res.status() >= 200 && res.status() < 300 && res.status() !== 204;
      s.completeRequest(id, {
        tEnd,
        status: res.status(),
        mimeType: headers['content-type'] ?? null,
        headers: Object.entries(headers),
        body: body ? new Uint8Array(body) : null,
        bodyUnavailable: wanted && !body,
        timing
      });
      const visit = requestVisit.get(req);
      if (isMainDocument(req) && visit != null) s.updateVisit(visit, { status: res.status() });
      emit({ type: 'response', id, status: res.status() });
    });
  };

  const onFailed = (req: Request) => {
    const id = requestIds.get(req);
    if (id === undefined) return;
    if (isMainDocument(req)) documentPending = false;
    write((s) => {
      s.failRequest(id, Date.now(), req.failure()?.errorText ?? 'failed');
      emit({ type: 'response', id, status: null, failed: true });
    });
  };

  const onNavigated = (frame: ReturnType<Page['mainFrame']>) => {
    if (frame !== site.mainFrame() || !isWeb(frame.url())) return;
    const url = frame.url();
    if (documentPending) {
      documentPending = false;
      if (visitId !== null)
        write((s) => {
          s.updateVisit(visitId!, { url });
          emit({ type: 'commit', id: visitId!, url });
        });
    } else {
      // No document request: a route change inside the page (history API).
      const t = Date.now();
      write((s) => {
        visitId = s.startVisit({ t, url, kind: 'same-document' });
        emit({ type: 'visit', id: visitId, t, url, kind: 'same-document', committed: true });
      });
    }
  };

  const onLoad = async () => {
    const visit = visitId;
    const title = await site.title().catch(() => null);
    if (visit !== null) write((s) => s.updateVisit(visit, { title }));
  };

  let draining: Promise<void> | null = null;
  const drain = () =>
    (draining ??= app
      .evaluate(() => (globalThis as unknown as { __artemisActions?: unknown[] }).__artemisActions?.splice(0) ?? [])
      .then((reported) => {
        for (const a of reported as ReportedAction[]) write((s) => s.recordAction({ ...a, actor: 'user' }));
      })
      .catch(() => {})
      .finally(() => (draining = null)));

  ctx.on('request', onRequest);
  ctx.on('response', onResponse);
  ctx.on('requestfinished', onFinished);
  ctx.on('requestfailed', onFailed);
  site.on('framenavigated', onNavigated);
  site.on('load', onLoad);
  const timer = setInterval(drain, o.pollMs ?? 100);

  let stopping: Promise<void> | null = null;
  return {
    path: () => store?.path ?? null,
    onEvent: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => (store && !closed ? store.siteEvents(documentPending ? visitId : null) : []),
    stop: () =>
      (stopping ??= (async () => {
        clearInterval(timer);
        await drain();
        ctx.off('request', onRequest);
        ctx.off('response', onResponse);
        ctx.off('requestfinished', onFinished);
        ctx.off('requestfailed', onFailed);
        site.off('framenavigated', onNavigated);
        site.off('load', onLoad);
        write((s) => s.end(Date.now()));
        closed = true;
        store?.close();
      })())
  };
}
