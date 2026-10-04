// The live cosmos's data: built in the console from the recorder's events (src/site-events.ts) as
// the operator (or later the autopilot) browses. Observations only, organised for drawing:
//
// - a page is a node, keyed by address without query or fragment (the database keeps full URLs);
//   navigation between pages links them, in the order page views committed;
// - first-party API calls (fetch, XHR, beacons, streams) become one endpoint node per method and
//   path, shared by every page that calls it;
// - anything from a host outside the review scope becomes one service node per host, shared;
// - first-party assets (scripts, styles, images, fonts) are a count on their page, not nodes;
// - a node that answered with an error status or failed counts the errors (the Anomalies lens).
//
// The model only grows (indices stay stable), and applying an event twice changes nothing, so a
// snapshot replayed after live events is harmless. toNetwork() turns it into the graph's shape.
import { inScope } from './scope';
import { SECTOR_COUNT, SPACE_SIZE, type LinkKind, type NetworkData, type NodeMeta } from './graph/data';
import type { SiteEvent } from './site-events';

export type SiteNodeKind = 'page' | 'api' | 'service';

export interface SiteNode {
  key: string;
  kind: SiteNodeKind;
  label: string;
  host: string;
  external: boolean;
  /** Index of the page's first path segment, in order of discovery (endpoints/services: their first page's). */
  section: number;
  /** The node that brought this one in (a page's previous page; an endpoint's or service's page). */
  parent: number | null;
  assets: number;
  errors: number;
  requests: number;
}

export interface SiteLink {
  a: number;
  b: number;
  kind: 'nav' | 'api' | 'third';
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
    const page = node(`${u.origin}${u.pathname}`, () => ({
      kind: 'page',
      label: out ? `${u.hostname}${u.pathname}` : u.pathname,
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
    } else if (external(u.hostname)) {
      const svc = node(`service:${u.hostname}`, () => ({ kind: 'service', label: u.hostname, host: u.hostname, external: true, section: m.nodes[page].section, parent: page }));
      link(page, svc, 'third');
      m.nodes[svc].requests++;
      m.requests.set(e.id, svc);
    } else if (API_TYPES.has(e.resourceType)) {
      const api = node(`${e.method} ${u.origin}${u.pathname}`, () => ({
        kind: 'api',
        label: `${e.method} ${u.pathname}`,
        host: u.hostname,
        external: false,
        section: m.nodes[page].section,
        parent: page
      }));
      link(page, api, 'api');
      m.nodes[api].requests++;
      m.requests.set(e.id, api);
    } else {
      m.nodes[page].assets++;
      m.requests.set(e.id, page);
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

/** Distance between neighbouring cells of the honeycomb pages sit on, in space units. */
export const CELL = 150;

// A flat-top hexagonal lattice in axial coordinates: the core's cell at the centre, ring k around
// it holding 6k cells, neighbours CELL apart at 30 + 60n degrees (so none sits beside a label).
const AXIAL: [number, number][] = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const HEX = CELL / Math.sqrt(3);
interface Cell {
  key: string;
  q: number;
  r: number;
  ring: number;
  x: number;
  y: number;
  /** Screen bearing from the core in degrees: 270 straight up, increasing clockwise. */
  bearing: number;
}
const byKey = new Map<string, Cell>();
const rings: Cell[][] = [];
/** Ring k's cells (around the core, or used as offsets around any cell), clockwise from the top. */
const ring = (k: number): Cell[] => {
  if (rings[k]) return rings[k];
  const make = (q: number, r: number): Cell => {
    const x = HEX * 1.5 * q;
    const y = HEX * Math.sqrt(3) * (r + q / 2);
    // Rounded so a cell straight along another's bearing turns 0 degrees, never 359.9999.
    const bearing = k === 0 ? 270 : Math.round((((Math.atan2(y, x) * 180) / Math.PI + 360) % 360) * 1e6) / 1e6;
    const cell = { key: `${q},${r}`, q, r, ring: k, x, y, bearing: bearing % 360 };
    byKey.set(cell.key, cell);
    return cell;
  };
  const cells: Cell[] = [];
  if (k === 0) cells.push(make(0, 0));
  let [q, r] = [AXIAL[4][0] * k, AXIAL[4][1] * k];
  for (let side = 0; k > 0 && side < 6; side++)
    for (let step = 0; step < k; step++) {
      cells.push(make(q, r));
      q += AXIAL[side][0];
      r += AXIAL[side][1];
    }
  return (rings[k] = cells.sort((a, b) => ((a.bearing + 90) % 360) - ((b.bearing + 90) % 360)));
};
const cellAt = (q: number, r: number): Cell => {
  ring(Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)));
  return byKey.get(`${q},${r}`)!;
};
/** Degrees turned clockwise from bearing `from` to bearing `to`. */
const clockwise = (from: number, to: number) => (to - from + 360) % 360;

/**
 * Each page's cell. Pages grow like a crystal: the core takes the centre, and each new page
 * attaches beside the page it came from, on the free cell nearest the core, turning clockwise
 * (when every neighbour is taken, the nearest free cell beyond them, by the same order). A walk
 * winds around the hexagon and then the next ring, a hub gathers its pages around it, and
 * navigation runs along the honeycomb's edges. Decided in discovery order over every page, outside
 * the scope too, so nothing already placed ever moves as the site grows or Scope changes.
 */
function honeycomb(m: SiteModel): Map<number, Cell> {
  const cells = new Map<number, Cell>();
  const taken = new Set<string>();
  m.nodes.forEach((n, i) => {
    if (n.kind !== 'page') return;
    const from = (n.parent !== null ? cells.get(n.parent) : undefined) ?? (m.entry !== null ? cells.get(m.entry) : undefined);
    if (i === m.entry || !from) {
      const centre = ring(0)[0];
      cells.set(i, centre);
      taken.add(centre.key);
      return;
    }
    const order = (a: Cell, b: Cell) => a.ring - b.ring || clockwise(from.bearing, a.bearing) - clockwise(from.bearing, b.bearing);
    for (let d = 1; ; d++) {
      const free = ring(d)
        .map((o) => cellAt(from.q + o.q, from.r + o.r))
        .filter((c) => !taken.has(c.key))
        .sort(order);
      if (!free.length) continue;
      taken.add(free[0].key);
      cells.set(i, free[0]);
      return;
    }
  });
  return cells;
}

const hash01 = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0) / 4294967296;
};
const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

export interface RecordedNetwork {
  data: NetworkData;
  /** Model key of each graph index, to carry positions and selections across rebuilds. */
  keys: string[];
  /** Graph indices that hold their place: the core and every page, on their cells. */
  fixed: number[];
}

/**
 * The graph's network for the recorded site. `external: false` leaves out everything outside the
 * review scope. The core and pages sit on the honeycomb (fixed); endpoints and services float:
 * known ones keep their `positions`, new ones start next to the page that brought them in.
 */
export function toNetwork(m: SiteModel, o: { external: boolean; positions?: Map<string, [number, number]> }): RecordedNetwork {
  const remap = new Array<number>(m.nodes.length).fill(-1);
  const keys: string[] = [];
  m.nodes.forEach((n, i) => {
    if (o.external || !n.external) remap[i] = keys.push(n.key) - 1;
  });
  const count = keys.length;
  const entry = m.entry !== null ? remap[m.entry] : -1;
  const meta: NodeMeta[] = [];
  const pos = new Float32Array(count * 2);
  const C = SPACE_SIZE / 2;
  const cells = honeycomb(m);
  const fixed: number[] = [];

  m.nodes.forEach((n, i) => {
    const idx = remap[i];
    if (idx < 0) return;
    const isEntry = idx === entry;
    const parent = !isEntry && n.parent !== null ? remap[n.parent] : -1;
    meta.push({
      id: n.label,
      tier: isEntry ? 'core' : n.kind === 'page' ? 'relay' : 'node',
      sector: isEntry ? -1 : n.section % SECTOR_COUNT,
      parent,
      degree: 0,
      jitter: hash01(n.key),
      kind: n.kind,
      external: n.external
    });
    const cell = cells.get(i);
    const known = o.positions?.get(n.key);
    if (cell) {
      pos[idx * 2] = C + cell.x;
      pos[idx * 2 + 1] = C + cell.y;
      fixed.push(idx);
    } else if (known) {
      pos[idx * 2] = known[0];
      pos[idx * 2 + 1] = known[1];
    } else if (parent >= 0) {
      const a = hash01(`${n.key}#a`) * Math.PI * 2;
      const r = 50 + hash01(`${n.key}#r`) * 40;
      pos[idx * 2] = pos[parent * 2] + Math.cos(a) * r;
      pos[idx * 2 + 1] = pos[parent * 2 + 1] + Math.sin(a) * r;
    } else {
      pos[idx * 2] = C + (hash01(`${n.key}#x`) - 0.5) * 40;
      pos[idx * 2 + 1] = C + (hash01(`${n.key}#y`) - 0.5) * 40;
    }
  });

  const links: number[] = [];
  const linkKinds: LinkKind[] = [];
  const linkIndex = new Map<string, number>();
  const crossLinks: number[] = [];
  for (const l of m.links) {
    const a = remap[l.a];
    const b = remap[l.b];
    if (a < 0 || b < 0) continue;
    const at = linkKinds.length;
    links.push(a, b);
    linkKinds.push(l.kind);
    if (!linkIndex.has(pairKey(a, b))) linkIndex.set(pairKey(a, b), at);
    if (l.kind === 'nav') crossLinks.push(at);
    meta[a].degree++;
    meta[b].degree++;
  }

  const relays = meta.flatMap((n, i) => (n.kind === 'page' && i !== entry ? [i] : []));
  return {
    keys,
    fixed,
    data: {
      seed: 0,
      count,
      meta,
      positions: pos,
      links: new Float32Array(links),
      linkKinds,
      linkCount: linkKinds.length,
      linkIndex,
      core: entry >= 0 ? entry : 0,
      sectors: [],
      relays,
      hubs: entry >= 0 ? [entry, ...relays] : relays,
      crossLinks,
      anomalies: m.nodes.flatMap((n, i) => (remap[i] >= 0 && n.errors > 0 ? [remap[i]] : [])),
      clusterPositions: []
    }
  };
}
