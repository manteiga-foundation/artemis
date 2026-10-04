import { describe, expect, test } from 'bun:test';
import { applySiteEvents, emptySiteModel, toNetwork } from '../src/site-model';
import type { SiteEvent } from '../src/site-events';

// The live cosmos is built from the recorder's events: pages are nodes, navigation links them,
// first-party API endpoints and outside hosts are shared nodes, assets are a count per page.

const S = 'http://shop.example';
const session: SiteEvent = { type: 'session', target: `${S}/`, scopeHost: 'shop.example' };
const visit = (id: number, url: string, committed = true): SiteEvent => ({ type: 'visit', id, t: id * 1000, url, kind: 'document', committed });
let rid = 100;
const req = (visitId: number, url: string, resourceType: string, method = 'GET', mainDocument = false): SiteEvent => ({
  type: 'request',
  id: ++rid,
  visitId,
  method,
  url,
  resourceType,
  mainDocument
});

const build = (events: SiteEvent[]) => {
  const m = emptySiteModel();
  applySiteEvents(m, events);
  return m;
};
const labels = (m: ReturnType<typeof build>) => m.nodes.map((n) => `${n.kind}:${n.label}`);

describe('the site model', () => {
  test('pages are nodes keyed by address without the query; navigation links them in order; the last page is current', () => {
    const m = build([session, visit(1, `${S}/`), visit(2, `${S}/contact?ref=home`), visit(3, `${S}/contact?ref=footer`), visit(4, `${S}/`)]);
    expect(labels(m)).toEqual(['page:/', 'page:/contact']);
    expect(m.links).toEqual([
      { a: 0, b: 1, kind: 'nav' },
      { a: 1, b: 0, kind: 'nav' }
    ]);
    expect(m.current).toBe(0);
    expect(m.entry).toBe(0);
  });

  test('a page appears when its navigation commits, at its final address, with the requests made meanwhile', () => {
    const m = emptySiteModel();
    applySiteEvents(m, [session, visit(1, `${S}/go`, false), req(1, `${S}/go`, 'document', 'GET', true), req(1, `${S}/api/me`, 'fetch')]);
    expect(m.nodes).toEqual([]);
    applySiteEvents(m, [{ type: 'commit', id: 1, url: `${S}/final` }]);
    expect(labels(m)).toEqual(['page:/final', 'api:GET /api/me']);
  });

  test('first-party API calls become one shared endpoint node per method and path, linked to each page using it', () => {
    const m = build([
      session,
      visit(1, `${S}/`),
      req(1, `${S}/api/config?page=/`, 'fetch'),
      visit(2, `${S}/contact`),
      req(2, `${S}/api/config?page=/contact`, 'fetch'),
      req(2, `${S}/api/contact`, 'xhr', 'POST')
    ]);
    expect(labels(m)).toEqual(['page:/', 'api:GET /api/config', 'page:/contact', 'api:POST /api/contact']);
    expect(m.links.filter((l) => l.kind === 'api')).toEqual([
      { a: 0, b: 1, kind: 'api' },
      { a: 2, b: 1, kind: 'api' },
      { a: 2, b: 3, kind: 'api' }
    ]);
    expect(m.nodes[1].requests).toBe(2);
  });

  test('requests to hosts outside the scope become one shared service node per host, marked external', () => {
    const m = build([session, visit(1, `${S}/`), req(1, 'https://maps.googleapis.com/maps/api/js', 'script'), visit(2, `${S}/contact`), req(2, 'https://maps.googleapis.com/tiles', 'image')]);
    expect(labels(m)).toEqual(['page:/', 'service:maps.googleapis.com', 'page:/contact']);
    expect(m.nodes[1].external).toBe(true);
    expect(m.nodes[0].external).toBe(false);
    expect(m.links.filter((l) => l.kind === 'third')).toEqual([
      { a: 0, b: 1, kind: 'third' },
      { a: 2, b: 1, kind: 'third' }
    ]);
  });

  test('subdomains of the scope host are inside it; in-scope assets are counted on their page, not drawn', () => {
    const m = build([session, visit(1, `${S}/`), req(1, `${S}/app.js`, 'script'), req(1, `${S}/logo.png`, 'image'), req(1, 'http://cdn.shop.example/style.css', 'stylesheet')]);
    expect(labels(m)).toEqual(['page:/']);
    expect(m.nodes[0].assets).toBe(3);
  });

  test('error responses and failures mark the node that answered: endpoint, service or page', () => {
    const m = build([session, visit(1, `${S}/missing`), req(1, `${S}/missing`, 'document', 'GET', true)]);
    applySiteEvents(m, [{ type: 'response', id: rid, status: 404 }, req(1, `${S}/api/x`, 'fetch'), { type: 'response', id: rid, status: 500 }]);
    applySiteEvents(m, [req(1, 'https://ads.example.net/px', 'image'), { type: 'response', id: rid, status: null, failed: true }]);
    expect(m.nodes.map((n) => [n.label, n.errors])).toEqual([
      ['/missing', 1],
      ['GET /api/x', 1],
      ['ads.example.net', 1]
    ]);
  });

  test('replaying events already applied changes nothing (a snapshot after live events), and reset starts over', () => {
    const events = [session, visit(1, `${S}/`), req(1, `${S}/api/a`, 'fetch'), { type: 'response', id: rid, status: 500 } as SiteEvent];
    const m = build(events);
    applySiteEvents(m, events);
    expect(m.nodes.map((n) => [n.label, n.requests, n.errors])).toEqual([
      ['/', 0, 0],
      ['GET /api/a', 1, 1]
    ]);
    applySiteEvents(m, [{ type: 'reset' }]);
    expect(m.nodes).toEqual([]);
  });

  test('pages outside the scope (a sign-in provider) are pages too, marked external', () => {
    const m = build([session, visit(1, `${S}/`), visit(2, 'https://login.idp.example/authorize?x=1')]);
    expect(m.nodes.map((n) => [n.kind, n.label, n.external])).toEqual([
      ['page', '/', false],
      ['page', 'login.idp.example/authorize', true]
    ]);
  });
});

describe('the recorded network for the cosmos', () => {
  const model = () =>
    build([
      session,
      visit(1, `${S}/`),
      req(1, `${S}/api/config`, 'fetch'),
      req(1, 'https://maps.googleapis.com/js', 'script'),
      visit(2, `${S}/contact`),
      req(2, `${S}/api/map`, 'fetch'),
      req(2, 'https://maps.googleapis.com/tiles', 'image')
    ]);

  test('the entry page is the core, pages are hubs, endpoints and services are small nodes; navigation is the route', () => {
    const { data, keys } = toNetwork(model(), { external: true });
    expect(data.count).toBe(5);
    expect(keys).toHaveLength(5);
    expect(data.meta.map((n) => [n.id, n.tier, n.kind])).toEqual([
      ['/', 'core', 'page'],
      ['GET /api/config', 'node', 'api'],
      ['maps.googleapis.com', 'node', 'service'],
      ['/contact', 'relay', 'page'],
      ['GET /api/map', 'node', 'api']
    ]);
    expect(data.core).toBe(0);
    expect(data.relays).toEqual([3]);
    // api /->config, third /->maps, nav /->contact, api contact->map, third contact->maps
    expect(data.linkCount).toBe(5);
    expect(data.crossLinks.map((l) => data.linkKinds[l])).toEqual(['nav']);
    expect(data.meta[3].parent).toBe(0);
  });

  test('hiding what is outside the scope drops the external nodes and their links', () => {
    const { data } = toNetwork(model(), { external: false });
    expect(data.meta.map((n) => n.id)).toEqual(['/', 'GET /api/config', '/contact', 'GET /api/map']);
    expect(data.linkKinds.includes('third')).toBe(false);
  });

  test('nodes keep their positions across rebuilds; new nodes start next to the node that brought them in', () => {
    const first = toNetwork(model(), { external: true });
    const positions = new Map(first.keys.map((k, i) => [k, [1000 + i, 2000 + i] as [number, number]]));
    const m = model();
    applySiteEvents(m, [visit(3, `${S}/thanks`)]);
    const next = toNetwork(m, { external: true, positions });
    for (let i = 0; i < first.keys.length; i++) expect([next.data.positions[i * 2], next.data.positions[i * 2 + 1]]).toEqual([1000 + i, 2000 + i]);
    const added = next.data.count - 1;
    const parent = next.data.meta[added].parent;
    const dx = next.data.positions[added * 2] - next.data.positions[parent * 2];
    const dy = next.data.positions[added * 2 + 1] - next.data.positions[parent * 2 + 1];
    expect(Math.hypot(dx, dy)).toBeLessThan(120);
  });

  test('nodes that answered with errors are the anomalies', () => {
    const m = model();
    applySiteEvents(m, [{ type: 'response', id: rid, status: 503 }]);
    const { data } = toNetwork(m, { external: true });
    expect(data.anomalies.map((i) => data.meta[i].id)).toEqual(['maps.googleapis.com']);
  });

  test('an empty recording is an empty network', () => {
    const { data } = toNetwork(emptySiteModel(), { external: true });
    expect(data.count).toBe(0);
    expect(data.linkCount).toBe(0);
  });
});
