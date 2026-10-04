// Procedural hierarchical network used to drive the draft console.
// Topology mirrors the paper sketch: one core, six sectors radiating from it,
// relays fanning out of each sector, and leaf nodes clustered around relays.

export type Tier = 'core' | 'sector' | 'relay' | 'node';
export type LinkKind = 'trunk' | 'branch' | 'leaf' | 'mesh' | 'backbone' | 'cross' | 'nav' | 'api' | 'third';

export interface NodeMeta {
  id: string;
  tier: Tier;
  sector: number; // -1 for core
  parent: number; // -1 for core
  degree: number;
  jitter: number; // 0..1, stable per node, used for colour variation
  /** Recorded networks only: what the node is (src/site-model.ts). */
  kind?: 'page' | 'api' | 'asset' | 'service';
  external?: boolean;
}

export interface NetworkData {
  seed: number;
  count: number;
  meta: NodeMeta[];
  positions: Float32Array;
  links: Float32Array;
  linkKinds: LinkKind[];
  linkCount: number;
  linkIndex: Map<string, number>;
  core: number;
  sectors: number[];
  relays: number[];
  hubs: number[];
  crossLinks: number[];
  anomalies: number[];
  clusterPositions: number[];
}

export const SPACE_SIZE = 4096;
export const SECTOR_COUNT = 6;
const LAYOUT_SCALE = 0.3;

const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

export function generateNetwork(seed = 7): NetworkData {
  const rnd = mulberry32(seed);
  const meta: NodeMeta[] = [];
  const pos: number[] = [];
  const linkPairs: number[] = [];
  const linkKinds: LinkKind[] = [];
  const linkIndex = new Map<string, number>();

  const C = SPACE_SIZE / 2;

  const addNode = (m: Omit<NodeMeta, 'degree' | 'jitter'>, x: number, y: number) => {
    meta.push({ ...m, degree: 0, jitter: rnd() });
    pos.push(x, y);
    return meta.length - 1;
  };

  const addLink = (a: number, b: number, kind: LinkKind) => {
    if (a === b) return;
    const k = key(a, b);
    if (linkIndex.has(k)) return;
    linkIndex.set(k, linkKinds.length);
    linkPairs.push(a, b);
    linkKinds.push(kind);
    meta[a].degree++;
    meta[b].degree++;
  };

  const core = addNode({ id: 'CORE', tier: 'core', sector: -1, parent: -1 }, C, C);
  const sectors: number[] = [];
  const relays: number[] = [];
  const relaysBySector: number[][] = [];
  const clusterPositions: number[] = [];

  for (let s = 0; s < SECTOR_COUNT; s++) {
    const ang = (s / SECTOR_COUNT) * Math.PI * 2 - Math.PI / 2 + (rnd() - 0.5) * 0.25;
    const r = 560 + rnd() * 120;
    const sx = C + Math.cos(ang) * r;
    const sy = C + Math.sin(ang) * r;
    const sectorId = `SEC-${String(s + 1).padStart(2, '0')}`;
    const si = addNode({ id: sectorId, tier: 'sector', sector: s, parent: core }, sx, sy);
    const cr = (r + 260) * LAYOUT_SCALE;
    clusterPositions.push(C + Math.cos(ang) * cr, C + Math.sin(ang) * cr);
    sectors.push(si);
    addLink(core, si, 'trunk');

    const nRelays = 5 + Math.floor(rnd() * 4);
    const sectorRelays: number[] = [];
    for (let k = 0; k < nRelays; k++) {
      const spread = Math.PI * 1.25;
      const a2 = ang + (nRelays === 1 ? 0 : (k / (nRelays - 1) - 0.5) * spread) + (rnd() - 0.5) * 0.15;
      const r2 = 230 + rnd() * 90;
      const rx = sx + Math.cos(a2) * r2;
      const ry = sy + Math.sin(a2) * r2;
      const ri = addNode(
        { id: `RL-${s + 1}${String.fromCharCode(65 + k)}`, tier: 'relay', sector: s, parent: si },
        rx,
        ry
      );
      relays.push(ri);
      sectorRelays.push(ri);
      addLink(si, ri, 'branch');

      const nLeaves = 22 + Math.floor(rnd() * 58);
      const leaves: number[] = [];
      for (let j = 0; j < nLeaves; j++) {
        const a3 = a2 + (rnd() - 0.5) * Math.PI * 1.8;
        const r3 = 40 + Math.sqrt(rnd()) * 120;
        const li = addNode(
          {
            id: `ND-${s + 1}${String.fromCharCode(65 + k)}-${String(j + 1).padStart(3, '0')}`,
            tier: 'node',
            sector: s,
            parent: ri
          },
          rx + Math.cos(a3) * r3,
          ry + Math.sin(a3) * r3
        );
        addLink(ri, li, 'leaf');
        if (leaves.length > 2 && rnd() < 0.09) {
          addLink(li, leaves[Math.floor(rnd() * leaves.length)], 'mesh');
        }
        leaves.push(li);
      }
    }
    relaysBySector.push(sectorRelays);
  }

  // Backbone ring between neighbouring sectors.
  for (let s = 0; s < SECTOR_COUNT; s++) {
    addLink(sectors[s], sectors[(s + 1) % SECTOR_COUNT], 'backbone');
  }

  // Long-haul cross routes between relays in different sectors.
  const crossLinks: number[] = [];
  let guard = 0;
  while (crossLinks.length < 16 && guard++ < 500) {
    const s1 = Math.floor(rnd() * SECTOR_COUNT);
    const s2 = (s1 + 1 + Math.floor(rnd() * (SECTOR_COUNT - 1))) % SECTOR_COUNT;
    const a = relaysBySector[s1][Math.floor(rnd() * relaysBySector[s1].length)];
    const b = relaysBySector[s2][Math.floor(rnd() * relaysBySector[s2].length)];
    const before = linkKinds.length;
    addLink(a, b, 'cross');
    if (linkKinds.length > before) crossLinks.push(linkKinds.length - 1);
  }

  const anomalies: number[] = [];
  for (let i = 0; i < meta.length; i++) {
    if (meta[i].tier === 'node' && rnd() < 0.014) anomalies.push(i);
  }

  // Seed positions close to the force layout's equilibrium size so the first
  // frames do not collapse dramatically.
  for (let i = 0; i < pos.length; i++) pos[i] = C + (pos[i] - C) * LAYOUT_SCALE;

  return {
    seed,
    count: meta.length,
    meta,
    positions: new Float32Array(pos),
    links: new Float32Array(linkPairs),
    linkKinds,
    linkCount: linkKinds.length,
    linkIndex,
    core,
    sectors,
    relays,
    hubs: [core, ...sectors, ...relays],
    crossLinks,
    anomalies,
    clusterPositions
  };
}

/** Node chain from the given node back to the core (inclusive). */
export function pathToCore(data: NetworkData, index: number): number[] {
  const chain: number[] = [];
  let cur = index;
  let guard = 0;
  while (cur !== -1 && guard++ < 16) {
    chain.push(cur);
    cur = data.meta[cur].parent;
  }
  return chain;
}

export function linksForChain(data: NetworkData, chain: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < chain.length - 1; i++) {
    const li = data.linkIndex.get(key(chain[i], chain[i + 1]));
    if (li !== undefined) out.push(li);
  }
  return out;
}

/**
 * The Page view's subgraph: the focus node plus every node within `hops` links of it,
 * as a sorted list of indices. Breadth-first over the undirected link list.
 */
export function pageSubgraph(data: NetworkData, focus: number, hops: 1 | 2): number[] {
  const seen = new Set<number>([focus]);
  let frontier = [focus];
  for (let h = 0; h < hops && frontier.length; h++) {
    const next: number[] = [];
    const inFrontier = new Set(frontier);
    const { links } = data;
    for (let l = 0; l < links.length; l += 2) {
      const a = links[l];
      const b = links[l + 1];
      if (inFrontier.has(a) && !seen.has(b)) {
        seen.add(b);
        next.push(b);
      } else if (inFrontier.has(b) && !seen.has(a)) {
        seen.add(a);
        next.push(a);
      }
    }
    frontier = next;
  }
  return [...seen].sort((x, y) => x - y);
}

/** Indices of links whose both ends are in the given node set. */
export function linksWithin(data: NetworkData, nodes: number[]): number[] {
  const set = new Set(nodes);
  const out: number[] = [];
  const { links } = data;
  for (let l = 0; l < links.length; l += 2) {
    if (set.has(links[l]) && set.has(links[l + 1])) out.push(l / 2);
  }
  return out;
}
