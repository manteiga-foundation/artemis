// The live cosmos's data: built in the console from the recorder's events (src/site-events.ts) as
// the operator (or later the autopilot) browses. Observations only, organised for drawing:
//
// - a page is a node, keyed by address without query or fragment (the database keeps full URLs),
//   hanging under the page it was first reached from; navigation links pages in commit order;
// - every request a page makes is a small dot of that page, one per method and address (without
//   the query): its API calls (fetch, XHR, beacons, streams), its own files (scripts, styles,
//   images, fonts) and anything from hosts outside the review scope (marked external). Nothing is
//   shared between pages, so no line runs from one page's cloud to another's;
// - a node that answered with an error status or failed counts the errors (the Anomalies lens).
//
// The model only grows (indices stay stable), and applying an event twice changes nothing, so a
// snapshot replayed after live events is harmless. toNetwork() turns it into the graph's shape.
import { inScope, pageKeyOf, pageLabelOf } from './scope';
import { SECTOR_COUNT, SPACE_SIZE, type LinkKind, type NetworkData, type NodeMeta } from './graph/data';
import type { SiteEvent } from './site-events';

export type SiteNodeKind = 'page' | 'api' | 'asset' | 'service';

export interface SiteNode {
  key: string;
  kind: SiteNodeKind;
  label: string;
  host: string;
  external: boolean;
  /** Index of the page's first path segment, in order of discovery (dots: their page's). */
  section: number;
  /** The node that brought this one in (a page's previous page; a dot's page). */
  parent: number | null;
  assets: number;
  errors: number;
  requests: number;
}

export interface SiteLink {
  a: number;
  b: number;
  kind: 'nav' | 'api' | 'asset' | 'third';
}

interface VisitState {
  url: string;
  committed: boolean;
  node: number | null;
  pending: SiteEvent[];
}

export interface SiteModel {
  scopeHost: string | null;
  nodes: SiteNode[];
  links: SiteLink[];
  /** The first page: the core of the cosmos. */
  entry: number | null;
  /** The page the browser is on now. */
  current: number | null;
  index: Map<string, number>;
  linkKeys: Set<string>;
  sections: Map<string, number>;
  visits: Map<number, VisitState>;
  /** Request id -> node that answered it (null: not drawn). */
  requests: Map<number, number | null>;
  responded: Set<number>;
  earlyResponses: Map<number, SiteEvent>;
  lastPage: number | null;
}

export const emptySiteModel = (): SiteModel => ({
  scopeHost: null,
  nodes: [],
  links: [],
  entry: null,
  current: null,
  index: new Map(),
  linkKeys: new Set(),
  sections: new Map(),
  visits: new Map(),
  requests: new Map(),
  responded: new Set(),
  earlyResponses: new Map(),
  lastPage: null
});

const API_TYPES = new Set(['fetch', 'xhr', 'ping', 'eventsource', 'websocket']);

const parse = (url: string): URL | null => {
  try {
    return new URL(url);
  } catch {
    return null;
  }
};

/** Applies events in order. Returns true when anything drawable changed. */
export function applySiteEvents(m: SiteModel, events: SiteEvent[]): boolean {
  let changed = false;

  const sectionOf = (path: string): number => {
    const key = path.split('/')[1] ?? '';
    if (!m.sections.has(key)) m.sections.set(key, m.sections.size);
    return m.sections.get(key)!;
  };
  const node = (key: string, make: () => Omit<SiteNode, 'key' | 'assets' | 'errors' | 'requests'>): number => {
    const known = m.index.get(key);
    if (known !== undefined) return known;
    m.nodes.push({ key, assets: 0, errors: 0, requests: 0, ...make() });
    m.index.set(key, m.nodes.length - 1);
    changed = true;
    return m.nodes.length - 1;
  };
  const link = (a: number, b: number, kind: SiteLink['kind']) => {
    const k = `${a}>${b}:${kind}`;
    if (a === b || m.linkKeys.has(k)) return;
    m.linkKeys.add(k);
    m.links.push({ a, b, kind });
    changed = true;
  };
  const external = (host: string) => (m.scopeHost ? !inScope(host, m.scopeHost) : false);

  const commit = (v: VisitState) => {
    const u = parse(v.url);
    if (!u) return;
    v.committed = true;
    const out = external(u.hostname);
    const from = m.lastPage;
    const page = node(pageKeyOf(u, !out), () => ({
      kind: 'page',
      label: out ? `${u.hostname}${u.pathname}` : pageLabelOf(u),
      host: u.hostname,
      external: out,
      section: sectionOf(u.pathname),
      parent: from
    }));
    v.node = page;
    if (from !== null) link(from, page, 'nav');
    m.lastPage = page;
    if (m.current !== page) changed = true;
    m.current = page;
    m.entry ??= page;
    const pending = v.pending;
    v.pending = [];
    for (const e of pending) apply(e);
  };

  const respond = (e: Extract<SiteEvent, { type: 'response' }>) => {
    if (m.responded.has(e.id)) return;
    if (!m.requests.has(e.id)) {
      m.earlyResponses.set(e.id, e);
      return;
    }
    m.responded.add(e.id);
    const at = m.requests.get(e.id);
    if (at != null && (e.failed || (e.status !== null && e.status >= 400))) {
      m.nodes[at].errors++;
      changed = true;
    }
  };

  const request = (e: Extract<SiteEvent, { type: 'request' }>) => {
    if (m.requests.has(e.id)) return;
    const v = e.visitId === null ? undefined : m.visits.get(e.visitId);
    if (!v) return;
    if (!v.committed) {
      v.pending.push(e);
      return;
    }
    const page = v.node;
    const u = parse(e.url);
    if (page === null || !u) {
      m.requests.set(e.id, null);
    } else if (e.mainDocument) {
      m.requests.set(e.id, page);
    } else {
      // A dot of this page: one per method and address, whatever else uses the same address.
      const p = m.nodes[page];
      const out = external(u.hostname);
      const kind: SiteNodeKind = out ? 'service' : API_TYPES.has(e.resourceType) ? 'api' : 'asset';
      const where = u.hostname === p.host ? u.pathname : `${u.hostname}${u.pathname}`;
      const dot = node(`${p.key} ${e.method} ${u.origin}${u.pathname}`, () => ({
        kind,
        label: out ? `${u.hostname}${u.pathname}` : `${e.method} ${where}`,
        host: u.hostname,
        external: out,
        section: p.section,
        parent: page
      }));
      link(page, dot, kind === 'service' ? 'third' : kind);
      m.nodes[dot].requests++;
      if (kind === 'asset') p.assets++;
      m.requests.set(e.id, dot);
    }
    changed = true;
    const early = m.earlyResponses.get(e.id);
    if (early) {
      m.earlyResponses.delete(e.id);
      apply(early);
    }
  };

  function apply(e: SiteEvent) {
    switch (e.type) {
      case 'reset': {
        const fresh = emptySiteModel();
        Object.assign(m, fresh);
        changed = true;
        return;
      }
      case 'session':
        m.scopeHost = e.scopeHost;
        return;
      case 'visit': {
        if (m.visits.has(e.id)) return;
        const v: VisitState = { url: e.url, committed: false, node: null, pending: [] };
        m.visits.set(e.id, v);
        if (e.committed) commit(v);
        return;
      }
      case 'commit': {
        const v = m.visits.get(e.id);
        if (!v || v.committed) return;
        v.url = e.url;
        commit(v);
        return;
      }
      case 'request':
        return request(e);
      case 'response':
        return respond(e);
    }
  }

  for (const e of events) apply(e);
  return changed;
}

// ---------------------------------------------------------------- graph shape
//
// The drawing is a tree, laid out like the sketch the emulated cosmos follows: the core (the first
// page) at the centre, the pages reached from it evenly around it (six make a hexagon), deeper
// pages fanning outward from the page they were reached from, and every page wearing its requests
// as a sunflower cloud. Each branch claims a circle big enough for everything under it, and
// sub-pages take separate slices of their parent's fan, so no drawn line can cross another.
// Navigation that does not follow the tree (back to an earlier page, across sections) is kept as
// routes (cross links) for the Routes lens. Places are computed from the whole model, outside the
// scope too, so Scope only hides; growth re-flows the branches it touches.

/** Between neighbouring dots of a page's cloud (sunflower spacing), in space units. */
const DOT_SPACING = 9;
/** The innermost dot's distance from its page, clear of the page's own disc. */
const DOT_CLEAR = 16;
/** Room a page takes without any requests. */
const PAGE_ALONE = 18;
/** Between the clouds of one ring and the next. */
const GAP = 28;
/** Between neighbouring branches. */
const MARGIN = 16;
/** Sub-pages share at most this much of their parent's slice, centred on it, so no line swings across. */
const FAN = (2 * Math.PI) / 3;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const UP = -Math.PI / 2;

interface Tree {
  root: number;
  /** Pages under each page, in discovery order. */
  kids: number[][];
  /** Each page's requests, in discovery order. */
  dots: number[][];
}

/** Pages hang under the page they were first reached from; requests under their page. */
function siteTree(m: SiteModel): Tree | null {
  if (m.entry === null) return null;
  const kids: number[][] = m.nodes.map(() => []);
  const dots: number[][] = m.nodes.map(() => []);
  m.nodes.forEach((n, i) => {
    if (i === m.entry) return;
    if (n.kind !== 'page') {
      if (n.parent !== null) dots[n.parent].push(i);
    } else kids[n.parent ?? m.entry!].push(i);
  });
  return { root: m.entry, kids, dots };
}

/** Each node's place relative to the centre. */
function geometry(t: Tree): Map<number, [number, number]> {
  const cloud = (p: number) => (t.dots[p].length ? DOT_CLEAR + DOT_SPACING * Math.sqrt(t.dots[p].length) : PAGE_ALONE);

  // Rings by depth from the core, far enough apart for the widest clouds on either side.
  const depth = new Map<number, number>([[t.root, 0]]);
  const order = [t.root];
  for (let i = 0; i < order.length; i++) for (const k of t.kids[order[i]]) depth.set(k, depth.get(order[i])! + 1), order.push(k);
  const widest: number[] = [];
  for (const p of order) widest[depth.get(p)!] = Math.max(widest[depth.get(p)!] ?? 0, cloud(p));
  const ring = [0];
  for (let d = 1; d < widest.length; d++) ring[d] = ring[d - 1] + widest[d - 1] + widest[d] + GAP;

  // Bottom up: the angle each branch needs, its own cloud on its ring or its pages further out.
  const need = new Map<number, number>();
  for (const p of [...order].reverse()) {
    if (p === t.root) continue;
    const own = (2 * cloud(p) + MARGIN) / ring[depth.get(p)!];
    need.set(p, Math.max(own, t.kids[p].reduce((s, k) => s + need.get(k)!, 0)));
  }
  const sum = (ks: number[]) => ks.reduce((s, k) => s + need.get(k)!, 0);
  // Push every ring out together until each of the core's pages fits an equal share of the
  // circle (sections evenly around the core, however unequal) and every fan fits FAN.
  const sections = t.kids[t.root];
  let scale = Math.max(1, (sections.length * Math.max(0, ...sections.map((k) => need.get(k)!))) / (2 * Math.PI));
  for (const p of order) if (p !== t.root && t.kids[p].length) scale = Math.max(scale, sum(t.kids[p]) / FAN);
  for (let d = 0; d < ring.length; d++) ring[d] *= scale;
  for (const [k, a] of need) need.set(k, a / scale);

  // Top down: each page in the middle of its slice, its pages sharing the slice (spare angle
  // shared out evenly), its requests a sunflower around it.
  const at = new Map<number, [number, number]>();
  const spread = (p: number, from: number, span: number) => {
    const kids = t.kids[p];
    const spare = (span - sum(kids)) / kids.length;
    let a = from;
    for (const k of kids) {
      const slice = need.get(k)! + spare;
      place(k, a + slice / 2, slice);
      a += slice;
    }
  };
  const place = (p: number, angle: number, slice: number) => {
    const r = ring[depth.get(p)!];
    const [x, y] = [Math.cos(angle) * r, Math.sin(angle) * r];
    at.set(p, [x, y]);
    t.dots[p].forEach((dot, k) => {
      const dr = DOT_CLEAR + DOT_SPACING * Math.sqrt(k);
      const a = angle + k * GOLDEN;
      at.set(dot, [x + Math.cos(a) * dr, y + Math.sin(a) * dr]);
    });
    if (!t.kids[p].length) return;
    if (p === t.root) {
      // Evenly around the core: the first page reached from it straight up, the rest clockwise.
      const share = (2 * Math.PI) / t.kids[p].length;
      t.kids[p].forEach((k, i) => place(k, UP + i * share, share));
    } else {
      const span = Math.min(slice, FAN);
      spread(p, angle - span / 2, span);
    }
  };
  place(t.root, UP, 2 * Math.PI);
  // cosmos.gl draws within its space: a site too big for it is drawn smaller, all of it alike (the
  // same shape, so still nothing crosses; only the clouds grow denser).
  let far = 0;
  for (const [x, y] of at.values()) far = Math.max(far, Math.hypot(x, y));
  const room = SPACE_SIZE / 2 - 100;
  if (far > room) for (const [k, [x, y]] of at) at.set(k, [(x * room) / far, (y * room) / far]);
  return at;
}

const hash01 = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0) / 4294967296;
};
const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

export interface RecordedNetwork {
  data: NetworkData;
  /** Model key of each graph index, to carry selections across rebuilds. */
  keys: string[];
  /** Graph indices that hold their place: all of them (the drawing is computed, not simulated). */
  fixed: number[];
}

/**
 * The graph's network for the recorded site. `external: false` leaves out everything outside the
 * review scope (a page whose parent is hidden hangs on its nearest shown ancestor).
 */
export function toNetwork(m: SiteModel, o: { external: boolean }): RecordedNetwork {
  const remap = new Array<number>(m.nodes.length).fill(-1);
  const keys: string[] = [];
  m.nodes.forEach((n, i) => {
    if (o.external || !n.external) remap[i] = keys.push(n.key) - 1;
  });
  const count = keys.length;
  const tree = siteTree(m);
  const places = tree ? geometry(tree) : new Map<number, [number, number]>();
  const root = tree?.root ?? -1;
  const C = SPACE_SIZE / 2;

  // The tree as drawn: each node's nearest shown ancestor, and which section (page reached from
  // the core) it belongs to.
  const treeParent = (i: number): number | null => (i === root ? null : m.nodes[i].kind === 'page' ? (m.nodes[i].parent ?? root) : m.nodes[i].parent);
  const shownParent = (i: number): number => {
    let p = treeParent(i);
    while (p !== null && remap[p] < 0) p = treeParent(p);
    return p === null ? -1 : remap[p];
  };
  const sections = tree ? tree.kids[root] : [];
  const sectionOf = (i: number): number => {
    let p: number | null = i;
    while (p !== null && treeParent(p) !== root && p !== root) p = treeParent(p);
    return p === null || p === root ? -1 : sections.indexOf(p);
  };

  const meta: NodeMeta[] = [];
  const pos = new Float32Array(count * 2);
  m.nodes.forEach((n, i) => {
    const idx = remap[i];
    if (idx < 0) return;
    const isRoot = i === root;
    const section = sectionOf(i);
    meta.push({
      id: n.label,
      tier: isRoot ? 'core' : n.kind !== 'page' ? 'node' : treeParent(i) === root ? 'sector' : 'relay',
      sector: section < 0 ? -1 : section % SECTOR_COUNT,
      parent: shownParent(i),
      degree: 0,
      jitter: hash01(n.key),
      kind: n.kind,
      external: n.external
    });
    const [x, y] = places.get(i) ?? [0, 0];
    // Places are screen-minded (y down, clockwise on screen); cosmos.gl's space has y up.
    pos[idx * 2] = C + x;
    pos[idx * 2 + 1] = C - y;
  });

  const links: number[] = [];
  const linkKinds: LinkKind[] = [];
  const linkIndex = new Map<string, number>();
  const crossLinks: number[] = [];
  const add = (a: number, b: number, kind: LinkKind) => {
    const key = pairKey(a, b);
    if (a === b || linkIndex.has(key)) return;
    linkIndex.set(key, linkKinds.length);
    if (kind === 'cross') crossLinks.push(linkKinds.length);
    links.push(a, b);
    linkKinds.push(kind);
    meta[a].degree++;
    meta[b].degree++;
  };
  // One line per node, to its parent, in discovery order.
  const DOT_LINK: Record<string, LinkKind> = { api: 'api', asset: 'leaf', service: 'third' };
  meta.forEach((n, idx) => {
    if (n.parent < 0) return;
    add(n.parent, idx, n.kind === 'page' ? (meta[n.parent].tier === 'core' ? 'trunk' : 'branch') : DOT_LINK[n.kind!]);
  });
  // Navigation the tree does not already draw: routes.
  for (const l of m.links) {
    if (l.kind !== 'nav') continue;
    const a = remap[l.a];
    const b = remap[l.b];
    if (a >= 0 && b >= 0) add(a, b, 'cross');
  }

  const pagesAt = (tier: NodeMeta['tier']) => meta.flatMap((n, i) => (n.kind === 'page' && n.tier === tier ? [i] : []));
  const core = root >= 0 ? remap[root] : -1;
  const sectorsShown = pagesAt('sector');
  const relays = pagesAt('relay');
  return {
    keys,
    fixed: meta.map((_, i) => i),
    data: {
      seed: 0,
      count,
      meta,
      positions: pos,
      links: new Float32Array(links),
      linkKinds,
      linkCount: linkKinds.length,
      linkIndex,
      core: core >= 0 ? core : 0,
      sectors: sectorsShown,
      relays,
      hubs: core >= 0 ? [core, ...sectorsShown, ...relays] : [...sectorsShown, ...relays],
      crossLinks,
      anomalies: m.nodes.flatMap((n, i) => (remap[i] >= 0 && n.errors > 0 ? [remap[i]] : [])),
      clusterPositions: []
    }
  };
}
