import { describe, expect, test } from 'bun:test';
import { applySiteEvents, emptySiteModel, toNetwork } from '../src/site-model';
import { SPACE_SIZE } from '../src/graph/data';
import type { SiteEvent } from '../src/site-events';

// The live cosmos is built from the recorder's events: pages are nodes, each hanging under the
// page it was first reached from; every request a page makes is a small dot in that page's cloud.

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
  test('pages are nodes keyed by address with the query, tracking parameters aside; navigation links them in order; the last page is current', () => {
    const m = build([session, visit(1, `${S}/`), visit(2, `${S}/contact?utm_source=home`), visit(3, `${S}/contact?utm_source=footer&fbclid=x1`), visit(4, `${S}/`)]);
    expect(labels(m)).toEqual(['page:/', 'page:/contact']);
    expect(m.links).toEqual([
      { a: 0, b: 1, kind: 'nav' },
      { a: 1, b: 0, kind: 'nav' }
    ]);
    expect(m.current).toBe(0);
    expect(m.entry).toBe(0);
    expect(m.nodes[1].parent).toBe(0);
  });

  test('one address with a different query is a different page (an app whose screens are App.aspx?comp=...): the order of the parameters does not matter, the fragment never counts', () => {
    const m = build([
      session,
      visit(1, `${S}/Welcome.aspx`),
      visit(2, `${S}/App.aspx?comp=BalanceInquiry&NavLinkID=349`),
      visit(3, `${S}/Welcome.aspx#journal`),
      visit(4, `${S}/App.aspx?comp=JournalEntries&NavLinkID=18`),
      visit(5, `${S}/App.aspx?NavLinkID=349&comp=BalanceInquiry#top`)
    ]);
    expect(labels(m)).toEqual(['page:/Welcome.aspx', 'page:/App.aspx?comp=BalanceInquiry&…', 'page:/App.aspx?comp=JournalEntries&…']);
    expect(m.nodes[1].key).toBe(`${S}/App.aspx?NavLinkID=349&comp=BalanceInquiry`);
    expect(m.nodes.map((n) => n.parent)).toEqual([null, 0, 0]);
    expect(m.current).toBe(1);
  });

  test('outside the scope a page is its path only: a sign-in provider\'s handshakes (state, nonce) are one page, not one per sign-in', () => {
    const m = build([session, visit(1, `${S}/`), visit(2, 'https://login.idp.example/authorize?state=a1&nonce=n1'), visit(3, `${S}/`), visit(4, 'https://login.idp.example/authorize?state=b2&nonce=n2')]);
    expect(labels(m)).toEqual(['page:/', 'page:login.idp.example/authorize']);
  });

  test('a page appears when its navigation commits, at its final address, with the requests made meanwhile', () => {
    const m = emptySiteModel();
    applySiteEvents(m, [session, visit(1, `${S}/go`, false), req(1, `${S}/go`, 'document', 'GET', true), req(1, `${S}/api/me`, 'fetch')]);
    expect(m.nodes).toEqual([]);
    applySiteEvents(m, [{ type: 'commit', id: 1, url: `${S}/final` }]);
    expect(labels(m)).toEqual(['page:/final', 'api:GET /api/me']);
  });

  test("every request a page makes is a dot of that page, one per method and address: two pages calling the same endpoint get a dot each", () => {
    const m = build([
      session,
      visit(1, `${S}/`),
      req(1, `${S}/api/config?page=/`, 'fetch'),
      req(1, `${S}/api/config?page=/again`, 'fetch'),
      visit(2, `${S}/contact`),
      req(2, `${S}/api/config?page=/contact`, 'fetch'),
      req(2, `${S}/api/contact`, 'xhr', 'POST')
    ]);
    expect(labels(m)).toEqual(['page:/', 'api:GET /api/config', 'page:/contact', 'api:GET /api/config', 'api:POST /api/contact']);
    expect(m.nodes.map((n) => n.parent)).toEqual([null, 0, 0, 2, 2]);
    expect(m.links.filter((l) => l.kind === 'api')).toEqual([
      { a: 0, b: 1, kind: 'api' },
      { a: 2, b: 3, kind: 'api' },
      { a: 2, b: 4, kind: 'api' }
    ]);
    expect(m.nodes[1].requests).toBe(2);
  });

  test('requests to hosts outside the scope are dots of their page too, marked external, named by host and path', () => {
    const m = build([session, visit(1, `${S}/`), req(1, 'https://maps.googleapis.com/maps/api/js', 'script'), visit(2, `${S}/contact`), req(2, 'https://maps.googleapis.com/tiles', 'image')]);
    expect(labels(m)).toEqual(['page:/', 'service:maps.googleapis.com/maps/api/js', 'page:/contact', 'service:maps.googleapis.com/tiles']);
    expect(m.nodes.map((n) => n.external)).toEqual([false, true, false, true]);
    expect(m.links.filter((l) => l.kind === 'third')).toEqual([
      { a: 0, b: 1, kind: 'third' },
      { a: 2, b: 3, kind: 'third' }
    ]);
  });

  test("a page's own files (scripts, styles, images, fonts) are dots of the page; subdomains of the scope host are inside it", () => {
    const m = build([session, visit(1, `${S}/`), req(1, `${S}/app.js`, 'script'), req(1, `${S}/logo.png`, 'image'), req(1, 'http://cdn.shop.example/style.css', 'stylesheet')]);
    expect(labels(m)).toEqual(['page:/', 'asset:GET /app.js', 'asset:GET /logo.png', 'asset:GET cdn.shop.example/style.css']);
    expect(m.nodes.some((n) => n.external)).toBe(false);
    expect(m.links.map((l) => l.kind)).toEqual(['asset', 'asset', 'asset']);
  });

  test('error responses and failures mark the node that answered: the page or the dot', () => {
    const m = build([session, visit(1, `${S}/missing`), req(1, `${S}/missing`, 'document', 'GET', true)]);
    applySiteEvents(m, [{ type: 'response', id: rid, status: 404 }, req(1, `${S}/api/x`, 'fetch'), { type: 'response', id: rid, status: 500 }]);
    applySiteEvents(m, [req(1, 'https://ads.example.net/px', 'image'), { type: 'response', id: rid, status: null, failed: true }]);
    expect(m.nodes.map((n) => [n.label, n.errors])).toEqual([
      ['/missing', 1],
      ['GET /api/x', 1],
      ['ads.example.net/px', 1]
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

  test('the entry page is the core; pages reached from it are sections, deeper pages relays, requests small dots: one line each', () => {
    const { data, keys } = toNetwork(model(), { external: true });
    expect(keys).toHaveLength(6);
    expect(data.meta.map((n) => [n.id, n.tier, n.kind])).toEqual([
      ['/', 'core', 'page'],
      ['GET /api/config', 'node', 'api'],
      ['maps.googleapis.com/js', 'node', 'service'],
      ['/contact', 'sector', 'page'],
      ['GET /api/map', 'node', 'api'],
      ['maps.googleapis.com/tiles', 'node', 'service']
    ]);
    expect(data.core).toBe(0);
    expect(data.sectors).toEqual([3]);
    expect(data.relays).toEqual([]);
    expect(data.hubs).toEqual([0, 3]);
    // A tree: every node but the core hangs on exactly one line, to its parent.
    expect(data.linkCount).toBe(5);
    expect(data.meta.map((n) => n.parent)).toEqual([-1, 0, 0, 0, 3, 3]);
    expect(data.linkKinds).toEqual(['api', 'third', 'trunk', 'api', 'third']);
    expect(data.crossLinks).toEqual([]);
  });

  test('navigation outside the tree (back to an earlier page, across sections) is a route: a cross link for the Routes lens', () => {
    // / -> /a -> /b (tree), /b -> / (back: not a tree line), / -> /a again (known), /a -> / (the tree line, reversed).
    const m = build([session, visit(1, `${S}/`), visit(2, `${S}/a`), visit(3, `${S}/b`), visit(4, `${S}/`), visit(5, `${S}/a`), visit(6, `${S}/`)]);
    const { data } = toNetwork(m, { external: true });
    const pair = (l: number) => [data.meta[data.links[l * 2]].id, data.meta[data.links[l * 2 + 1]].id];
    expect(data.crossLinks.map(pair)).toEqual([['/b', '/']]);
    expect(data.crossLinks.map((l) => data.linkKinds[l])).toEqual(['cross']);
    expect(data.linkKinds.filter((k) => k !== 'cross')).toEqual(['trunk', 'branch']);
  });

  test('hiding what is outside the scope drops the external nodes and their lines', () => {
    const { data } = toNetwork(model(), { external: false });
    expect(data.meta.map((n) => n.id)).toEqual(['/', 'GET /api/config', '/contact', 'GET /api/map']);
    expect(data.linkKinds.includes('third')).toBe(false);
  });

  test('nodes that answered with errors are the anomalies', () => {
    const m = model();
    applySiteEvents(m, [{ type: 'response', id: rid, status: 503 }]);
    const { data } = toNetwork(m, { external: true });
    expect(data.anomalies.map((i) => data.meta[i].id)).toEqual(['maps.googleapis.com/tiles']);
  });

  test('an empty recording is an empty network', () => {
    const { data } = toNetwork(emptySiteModel(), { external: true });
    expect(data.count).toBe(0);
    expect(data.linkCount).toBe(0);
  });
});

describe('the geometry: a core, sections evenly around it, a cloud around every page, no line crossing another', () => {
  const C = SPACE_SIZE / 2;
  type P = [number, number];
  const at = (d: { positions: Float32Array }, i: number): P => [d.positions[i * 2], d.positions[i * 2 + 1]];
  const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  /** Screen bearing in degrees: 270 is straight up, increasing clockwise (cosmos.gl's space has y up). */
  const bearing = (from: P, to: P) => Math.round(((Math.atan2(from[1] - to[1], to[0] - from[0]) * 180) / Math.PI + 360) % 360);
  const index = (d: { meta: { id: string }[] }, id: string) => d.meta.findIndex((n) => n.id === id);

  /** Pages reached in order (each from the one before), with `n` requests on each new page. */
  const walk = (paths: string[], requestsPerPage = 0) => {
    const events: SiteEvent[] = [session];
    paths.forEach((p, i) => {
      events.push(visit(i + 1, `${S}${p}`));
      for (let k = 0; k < requestsPerPage; k++) events.push(req(i + 1, `${S}${p === '/' ? '' : p}/r${k}.js`, 'script'));
    });
    return build(events);
  };

  /** A site with sections, sub-pages, a long chain, outside hosts, back-and-forth navigation. */
  const site = () => {
    const events: SiteEvent[] = [session];
    let v = 0;
    const go = (path: string, requests: string[] = []) => {
      events.push(visit(++v, path.startsWith('http') ? path : `${S}${path}`));
      for (const r of requests) events.push(req(v, r.startsWith('http') ? r : `${S}${r}`, r.includes('/api/') ? 'fetch' : r.startsWith('http') ? 'image' : 'script'));
    };
    const files = (prefix: string, n: number) => Array.from({ length: n }, (_, k) => `${prefix}/f${k}.js`);
    go('/', [...files('', 30), '/api/config', 'https://cdn.example.net/lib.js', 'https://fonts.example.org/a.woff']);
    for (const section of ['/blog', '/shop', '/docs', '/about', '/careers']) {
      go('/');
      go(section, [...files(section, 12), `${section === '/shop' ? '/api/cart' : '/api/feed'}`, 'https://cdn.example.net/lib.js']);
      for (let k = 1; k <= (section === '/blog' ? 6 : 3); k++) {
        go(section);
        go(`${section}/item-${k}`, files(`${section}/item-${k}`, 5 + k * 3));
      }
    }
    // A flow: a chain of steps, each from the one before, out through a sign-in provider and back.
    go('/shop');
    for (const step of ['/shop/cart', '/shop/checkout', 'https://login.idp.example/authorize', '/shop/pay', '/shop/done']) go(step, files(step.replace(/^https?:\/\/[^/]+/, '/idp'), 6));
    // Back and forth across sections: routes, not tree lines.
    go('/docs/item-2');
    go('/blog/item-4');
    go('/');
    return build(events);
  };

  /** Do segments ab and cd cross (properly: touching at a shared end does not count)? */
  const cross = (a: P, b: P, c: P, d: P) => {
    const o = (p: P, q: P, r: P) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  };
  const drawn = (data: ReturnType<typeof toNetwork>['data']) => {
    const out: [number, number][] = [];
    for (let l = 0; l < data.linkCount; l++) if (data.linkKinds[l] !== 'cross') out.push([data.links[l * 2], data.links[l * 2 + 1]]);
    return out;
  };

  test('the core sits at the centre; the pages reached from it are evenly around it, the first straight up, then clockwise', () => {
    const { data } = toNetwork(walk(['/', '/a', '/', '/b', '/', '/c', '/', '/d', '/', '/e', '/', '/f']), { external: true });
    const core = at(data, data.core);
    expect(core).toEqual([C, C]);
    const ring = ['/a', '/b', '/c', '/d', '/e', '/f'].map((p) => at(data, index(data, p)));
    const r = dist(core, ring[0]);
    for (const p of ring) expect(dist(core, p)).toBeCloseTo(r, 3);
    expect(ring.map((p) => bearing(core, p))).toEqual([270, 330, 30, 90, 150, 210]);
  });

  test('sections stay evenly around the core even when one holds far more than the others', () => {
    const events: SiteEvent[] = [session, visit(1, `${S}/`)];
    let v = 1;
    const go = (path: string, n = 0) => {
      events.push(visit(++v, `${S}${path}`));
      for (let k = 0; k < n; k++) events.push(req(v, `${S}${path}/f${k}.js`, 'script'));
    };
    go('/big', 40);
    for (let k = 0; k < 6; k++) (go('/big'), go(`/big/${k}`, 20));
    for (const s of ['/b', '/c', '/d']) (go('/'), go(s));
    const { data } = toNetwork(build(events), { external: true });
    const core = at(data, data.core);
    expect(['/big', '/b', '/c', '/d'].map((p) => bearing(core, at(data, index(data, p))))).toEqual([270, 0, 90, 180]);
  });

  test('no drawn line crosses another, on a site with sections, sub-pages, a chain, outside hosts and back-and-forth navigation', () => {
    for (const external of [true, false]) {
      const { data } = toNetwork(site(), { external });
      const lines = drawn(data);
      expect(lines.length).toBeGreaterThan(150);
      const crossings: string[] = [];
      for (let i = 0; i < lines.length; i++)
        for (let j = i + 1; j < lines.length; j++) {
          const [a, b] = lines[i];
          const [c, d] = lines[j];
          if (a === c || a === d || b === c || b === d) continue;
          if (cross(at(data, a), at(data, b), at(data, c), at(data, d))) crossings.push(`${data.meta[a].id}-${data.meta[b].id} x ${data.meta[c].id}-${data.meta[d].id}`);
        }
      expect(crossings.slice(0, 5)).toEqual([]);
    }
  });

  test('every node hangs on exactly one drawn line, to its parent: the drawing is a tree', () => {
    for (const external of [true, false]) {
      const { data } = toNetwork(site(), { external });
      const lines = drawn(data);
      expect(lines.length).toBe(data.count - 1);
      const child = new Set(lines.map(([a, b]) => (data.meta[b].parent === a ? b : a)));
      expect(child.size).toBe(data.count - 1);
      expect(child.has(data.core)).toBe(false);
    }
  });

  test("a page's requests form a cloud around it: every dot nearer its own page than any other, no two dots on top of each other", () => {
    const { data } = toNetwork(site(), { external: true });
    const pages = data.meta.flatMap((n, i) => (n.kind === 'page' ? [i] : []));
    const dots = data.meta.flatMap((n, i) => (n.kind !== 'page' ? [i] : []));
    for (const d of dots) {
      const own = dist(at(data, d), at(data, data.meta[d].parent));
      for (const p of pages) if (p !== data.meta[d].parent) expect(dist(at(data, d), at(data, p))).toBeGreaterThan(own);
    }
    let closest = Infinity;
    for (let i = 0; i < dots.length; i++) for (let j = i + 1; j < dots.length; j++) closest = Math.min(closest, dist(at(data, dots[i]), at(data, dots[j])));
    expect(closest).toBeGreaterThan(4);
  });

  test('sub-pages fan outward: each lies farther from the core than its parent, on the far side of it', () => {
    const { data } = toNetwork(site(), { external: true });
    const core = at(data, data.core);
    data.meta.forEach((n, i) => {
      if (n.kind !== 'page' || n.parent < 0 || n.parent === data.core) return;
      const parent = at(data, n.parent);
      const grand = at(data, data.meta[n.parent].parent);
      expect(dist(core, at(data, i))).toBeGreaterThan(dist(core, parent));
      // Within 112.5 degrees of straight on from the grandparent through the parent.
      const turn = Math.abs(((bearing(parent, at(data, i)) - bearing(grand, parent) + 540) % 360) - 180);
      expect(turn).toBeLessThanOrEqual(113);
    });
  });

  test('a walk from page to page reads as a straight line out from the core: a flow', () => {
    const chain = ['/', '/a', '/b', '/c', '/d'];
    const { data } = toNetwork(walk(chain, 4), { external: true });
    const core = at(data, data.core);
    const bearings = chain.slice(1).map((p) => bearing(core, at(data, index(data, p))));
    expect(new Set(bearings).size).toBe(1);
  });

  test('Scope and recomputation move nothing: the same model gives the same places, with or without outside hosts', () => {
    const m = site();
    const all = toNetwork(m, { external: true });
    const again = toNetwork(m, { external: true });
    expect([...again.data.positions]).toEqual([...all.data.positions]);
    const inside = toNetwork(m, { external: false });
    inside.keys.forEach((k, i) => expect(at(inside.data, i)).toEqual(at(all.data, all.keys.indexOf(k))));
  });

  test('a site too big for the space is drawn smaller, never outside it (cosmos.gl draws within 4096 units)', () => {
    const chain = ['/', ...Array.from({ length: 60 }, (_, k) => `/step-${k}`)];
    const { data } = toNetwork(walk(chain, 12), { external: true });
    let far = 0;
    for (let i = 0; i < data.count; i++) far = Math.max(far, dist([C, C], at(data, i)));
    expect(far).toBeLessThan(SPACE_SIZE / 2 - 50);
    expect(at(data, data.core)).toEqual([C, C]);
  });

  test('every node holds its computed place (the drawing is not simulated)', () => {
    const { data, fixed } = toNetwork(site(), { external: true });
    expect(fixed).toEqual(data.meta.map((_, i) => i));
  });
});
