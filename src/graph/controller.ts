import { Graph, PointShape, type GraphConfig } from '@cosmos.gl/graph';
import { generateNetwork, linksForChain, linksWithin, pageSubgraph, pathToCore, type NetworkData } from './data';
import { EG, SECTOR_HUES, mix, rgba, type RGBA } from '../theme';
import { PALETTES, type Palette } from '../views';
import { getState, setState, type LensId } from '../store';
import { graphPixelRatio } from '../quality';
import { VIEW_BY_ID, nextView, viewDepth, type ViewId } from '../views';
import { inShell } from '../shell';
import { applySiteEvents as applyToModel, emptySiteModel, toNetwork, type SiteModel } from '../site-model';
import type { SiteEvent } from '../site-events';

import type { SfxAction } from '../sounds';
export type { SfxAction } from '../sounds';
export interface CommandResult {
  ok: boolean;
  message: string;
  sfx?: SfxAction;
}

type SfxListener = (sfx: SfxAction) => void;
type Listener = () => void;

const BASE_REPULSION = 0.9;
/** Zoom level the camera closes in to when the cosmos opens on the current page. */
const PAGE_ZOOM = 4;
/** Half the least width the recorded cosmos is framed at around the current page (space units). */
const LAND_MIN_EXTENT = 220;
/** How long the recorded cosmos takes to glide into its new shape as the site grows. */
const GROW_GLIDE_MS = 450;

const LINK_WIDTH: Record<string, number> = {
  trunk: 2.4,
  backbone: 1.6,
  branch: 1.3,
  cross: 1.1,
  leaf: 0.7,
  mesh: 0.5,
  nav: 1.8,
  api: 1.0,
  third: 0.9
};

class GraphController {
  main: Graph | null = null;
  mini: Graph | null = null;
  mainEl: HTMLDivElement | null = null;
  miniEl: HTMLDivElement | null = null;
  /** In the owned browser the cosmos is the live recording (src/site-model.ts); elsewhere, emulated. */
  recorded = inShell();
  site: SiteModel = emptySiteModel();
  /** Model key of each graph index (recorded cosmos), to carry selections across rebuilds. */
  private siteKeys: string[] = [];
  private showExternal = true;
  /** Recorded cosmos: every node, held at its computed place. */
  private fixedPoints: number[] = [];
  data: NetworkData = this.recorded ? toNetwork(emptySiteModel(), { external: true }).data : generateNetwork(getState().seed);

  private miniLastSync = 0;
  private viewportListeners = new Set<Listener>();
  private sfxListeners = new Set<SfxListener>();
  private hubCycle = -1;
  private disperseTimer = 0;
  private tickCount = 0;
  private ticksSinceStart = 0;
  private needsFit = true;
  /** The operator has pointed the camera somewhere; nothing automatic moves it after that. */
  private operatorAimed = false;
  tickRate = 0; // simulation ticks per second (measured)

  constructor() {
    setState({
      nodeCount: this.data.count,
      linkCount: this.data.linkCount,
      currentPage: this.recorded ? -1 : this.data.relays[0],
      recorded: this.recorded
    });
    window.setInterval(() => {
      this.tickRate = this.tickCount;
      this.tickCount = 0;
    }, 1000);
  }

  // ---------------------------------------------------------------- events
  onViewport(l: Listener): () => void {
    this.viewportListeners.add(l);
    return () => {
      this.viewportListeners.delete(l);
    };
  }
  onSfx(l: SfxListener): () => void {
    this.sfxListeners.add(l);
    return () => {
      this.sfxListeners.delete(l);
    };
  }
  private emitViewport() {
    this.viewportListeners.forEach((l) => l());
  }
  private emitSfx(s: SfxAction) {
    this.sfxListeners.forEach((l) => l(s));
  }

  // ---------------------------------------------------------------- colours
  /** Palette of the view the stage is showing: the graph recolours at the dive's midpoint. */
  private palette(): Palette {
    return PALETTES[getState().stageView];
  }

  private pointColor(i: number, lens: LensId, P: Palette, white: RGBA, bg: RGBA): RGBA {
    const m = this.data.meta[i];
    if (lens === 'anomalies' && this.anomalySet.has(i)) return rgba(P.alert);
    if (m.tier === 'core') return white;
    // Recorded cosmos: hosts outside the review scope wear the attention accent, dimmed.
    if (m.external) return mix(rgba(P.alert), bg, m.kind === 'page' ? 0.05 : 0.12);
    if (lens === 'clusters') {
      const hue = rgba(SECTOR_HUES[Math.max(0, m.sector) % SECTOR_HUES.length]);
      if (m.tier === 'sector') return mix(hue, white, 0.35);
      if (m.tier === 'relay') return mix(hue, white, 0.1);
      return mix(hue, bg, 0.18 + m.jitter * 0.22);
    }
    if (m.kind === 'api') return mix(rgba(P.sky), white, 0.25);
    if (m.tier === 'sector') return mix(rgba(P.sky), white, 0.35);
    if (m.tier === 'relay') return rgba(P.azure);
    return mix(rgba(P.royal), rgba(P.sky), m.jitter * 0.55);
  }

  private anomalySet = new Set<number>();

  private pointColors(lens: LensId): Float32Array {
    const { count } = this.data;
    const P = this.palette();
    const white = rgba(P.white);
    const bg = rgba(P.bg);
    const out = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) out.set(this.pointColor(i, lens, P, white, bg), i * 4);
    return out;
  }

  private linkColors(lens: LensId): Float32Array {
    const { linkKinds, links, meta } = this.data;
    const P = this.palette();
    const out = new Float32Array(linkKinds.length * 4);
    for (let l = 0; l < linkKinds.length; l++) {
      const kind = linkKinds[l];
      let c: RGBA;
      if (lens === 'clusters' && kind !== 'trunk' && kind !== 'backbone' && kind !== 'cross') {
        const s = meta[links[l * 2 + 1]].sector;
        c = rgba(SECTOR_HUES[Math.max(0, s)], kind === 'branch' ? 0.6 : 0.26);
      } else if (lens === 'routes' && (kind === 'cross' || kind === 'nav')) {
        c = rgba(P.mist, 0.95);
      } else {
        switch (kind) {
          case 'nav':
            c = rgba(P.mist, 0.8);
            break;
          case 'api':
            c = rgba(P.sky, 0.5);
            break;
          case 'third':
            c = rgba(P.alert, 0.3);
            break;
          case 'trunk':
            c = rgba(P.mist, 0.85);
            break;
          case 'backbone':
            c = rgba(P.sky, 0.55);
            break;
          case 'branch':
            c = rgba(P.azure, 0.6);
            break;
          case 'cross':
            // Recorded: routes outside the tree belong to the Routes lens, not the overview.
            c = rgba(P.azure, this.recorded ? 0 : 0.35);
            break;
          case 'mesh':
            c = rgba(P.royal, 0.2);
            break;
          default:
            c = rgba(P.royal, 0.3);
        }
      }
      out.set(c, l * 4);
    }
    return out;
  }

  private linkWidths(): Float32Array {
    const { linkKinds } = this.data;
    const out = new Float32Array(linkKinds.length);
    for (let l = 0; l < linkKinds.length; l++) out[l] = LINK_WIDTH[linkKinds[l]] ?? 0.7;
    return out;
  }

  private pointSizes(scale: number): Float32Array {
    const { meta, count } = this.data;
    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const m = meta[i];
      const base =
        m.kind === 'api' || m.kind === 'service'
          ? 4.2
          : m.tier === 'core'
            ? 32
            : m.tier === 'sector'
              ? 16
              : m.tier === 'relay'
                ? m.kind
                  ? 11
                  : 8
                : 2.6 + m.jitter * 1.8;
      out[i] = base * scale;
    }
    return out;
  }

  // ---------------------------------------------------------------- setup
  initMain(el: HTMLDivElement) {
    if (this.main) return;
    this.mainEl = el;
    const config: GraphConfig = {
      backgroundColor: [0, 0, 0, 0],
      transitionDuration: 0,
      spaceSize: 4096,
      pointDefaultSize: 4,
      scalePointsOnZoom: false,
      renderHoveredPointRing: true,
      hoveredPointRingColor: EG.mist,
      focusedPointRingColor: EG.white,
      outlinedPointRingColor: EG.alert,
      hoveredPointCursor: 'crosshair',
      pointGreyoutOpacity: 0.1,
      linkGreyoutOpacity: 0.04,
      linkDefaultWidth: 0.8,
      linkOpacity: 0.95,
      curvedLinkWeight: 0.8,
      curvedLinkControlPointDistance: 0.35,
      simulationRepulsion: BASE_REPULSION,
      simulationLinkSpring: 1.1,
      simulationFriction: 0.86,
      simulationDecay: 4200,
      ...this.physics(),
      simulationRepulsionFromMouse: 2,
      enableDrag: true,
      fitViewOnInit: true,
      fitViewDelay: 900,
      fitViewPadding: 0.18,
      fitViewDuration: 700,
      attribution: '',
      pixelRatio: graphPixelRatio(el.clientWidth || window.innerWidth, el.clientHeight || window.innerHeight, window.devicePixelRatio),
      onPointClick: (index) => this.handlePointClick(index),
      onBackgroundClick: () => this.handleBackgroundClick(),
      onZoomStart: (_e, userDriven) => this.zoomStarted(userDriven),
      onZoom: () => this.emitViewport(),
      onZoomEnd: () => this.emitViewport(),
      onSimulationStart: () => this.layoutStarted(),
      onSimulationTick: () => this.layoutTick(),
      onSimulationEnd: () => this.layoutSettled(),
      onSimulationPause: () => setState({ simRunning: false }),
      onSimulationUnpause: () => setState({ simRunning: true }),
      onDragEnd: () => this.syncMini(true),
      onPointMouseOver: () => this.emitSfx('hover')
    };
    const g = new Graph(el, config);
    this.main = g;
    this.loadInto(g, 1);
    g.trackPointPositionsByIndices(this.trackedIndices());
    g.render();
    g.start(1);
  }

  initMini(el: HTMLDivElement) {
    if (this.mini) return;
    this.miniEl = el;
    const g = new Graph(el, {
      backgroundColor: [0, 0, 0, 0],
      enableSimulation: false,
      rescalePositions: false,
      transitionDuration: 0,
      spaceSize: 4096,
      enableZoom: false,
      enableDrag: false,
      fitViewOnInit: true,
      fitViewDelay: 0,
      fitViewDuration: 0,
      fitViewPadding: 0.12,
      pointGreyoutOpacity: 0.15,
      linkGreyoutOpacity: 0.05,
      linkOpacity: 0.8,
      focusedPointRingColor: EG.white,
      outlinedPointRingColor: EG.alert,
      linkVisibilityDistanceRange: [0, 4000],
      linkVisibilityMinTransparency: 1,
      attribution: ''
    });
    this.mini = g;
    this.loadInto(g, 0.42);
    g.render();
    window.setTimeout(() => this.syncMini(true), 200);
  }

  /** cosmos.gl point shapes: the core is a hexagon, everything else a circle. */
  private pointShapes(): Float32Array {
    const out = new Float32Array(this.data.count);
    if (this.data.count) out[this.data.core] = PointShape.Hexagon;
    return out;
  }

  private loadInto(g: Graph, sizeScale: number) {
    const lens = getState().lens;
    this.anomalySet = new Set(this.data.anomalies);
    g.setPointPositions(new Float32Array(this.data.positions));
    g.setLinks(this.data.links);
    g.setPointColors(this.pointColors(lens));
    g.setPointSizes(this.pointSizes(sizeScale));
    g.setPointShapes(this.pointShapes());
    g.setLinkColors(this.linkColors(lens));
    g.setLinkWidths(this.linkWidths().map((w) => w * (sizeScale < 1 ? 0.6 : 1)));
    if (sizeScale === 1) {
      // Pull each sector toward a fixed slot on a hexagonal ring so the overview keeps
      // the core -> sectors -> satellites reading from the sketch.
      g.setPointClusters(this.data.meta.map((m) => (m.sector >= 0 ? m.sector : undefined)));
      g.setClusterPositions(this.data.clusterPositions);
    }
  }

  // ---------------------------------------------------------------- layout and camera lifecycle
  // A new layout frames itself as it unfolds (ticks 90 and 240, then once settled) so the
  // network arrives in view. Called by the graph's simulation callbacks.

  layoutStarted() {
    this.ticksSinceStart = 0;
    setState({ simRunning: true });
  }

  layoutTick() {
    this.tickCount++;
    this.ticksSinceStart++;
    if (this.needsFit && (this.ticksSinceStart === 90 || this.ticksSinceStart === 240)) {
      this.fitAll(700, 0.16, true);
    }
    this.syncMini();
  }

  layoutSettled() {
    setState({ simRunning: false });
    if (this.needsFit) {
      this.needsFit = false;
      this.fitAll(900, 0.16, false);
    }
    this.syncMini(true);
  }

  /** The camera starts moving; `userDriven` when the operator wheels or drags the graph. */
  zoomStarted(userDriven: boolean) {
    if (userDriven) this.aimed();
  }

  /**
   * The operator has pointed the camera somewhere (a command, the minimap, the wheel): the first
   * layout's pending fits must not take it away again.
   */
  private aimed() {
    this.needsFit = false;
    this.operatorAimed = true;
  }

  // ---------------------------------------------------------------- the recorded cosmos

  /**
   * The emulated network spreads by sheer numbers under these forces. The recorded cosmos is
   * computed instead (site-model.ts: every node pinned, the simulation kept off), so its values
   * only matter for the emulated network it replaces.
   */
  private physics() {
    return this.recorded
      ? { simulationGravity: 0, simulationLinkDistance: 45, simulationCluster: 0 }
      : { simulationGravity: 0.22, simulationLinkDistance: 9, simulationCluster: 0.22 };
  }

  /** Points the layout must not move: the recorded structure, plus the operator's holds. */
  private applyPins() {
    const pins = [...new Set([...this.fixedPoints, ...getState().pinned])];
    this.main?.setPinnedPoints(pins.length ? pins : null);
  }

  /**
   * Events from the owned browser's recorder (src/site-events.ts). The first one turns the cosmos
   * into the recording; each batch grows it in place: known nodes stay where they are, new ones
   * start beside the node that brought them in, and the layout re-settles gently.
   */
  applySiteEvents(events: SiteEvent[]) {
    const switching = !this.recorded;
    if (switching) {
      this.recorded = true;
      this.site = emptySiteModel();
      this.siteKeys = [];
      setState({ recorded: true, selected: null, pinned: [], targetMode: false });
      this.fixedPoints = [];
      this.applyPins();
      this.main?.setConfigPartial(this.physics());
    }
    if (applyToModel(this.site, events) || switching) this.rebuildRecorded(switching);
  }

  /** Scope: show or hide what lies outside the review host (recorded cosmos). */
  scope(): CommandResult {
    if (!this.recorded) return this.done({ ok: false, message: 'Scope applies to a recorded site.', sfx: 'command-error' });
    this.showExternal = !this.showExternal;
    setState({ showExternal: this.showExternal });
    this.rebuildRecorded(false, true);
    const host = this.site.scopeHost ?? 'the target';
    return this.done({
      ok: true,
      message: this.showExternal ? `Scope: everything, including hosts outside ${host}.` : `Scope: only ${host} and its subdomains.`,
      sfx: 'command-ok'
    });
  }

  /** `fresh`: the graph held the emulated network, so nothing on screen is the recording yet. */
  private rebuildRecorded(fresh = false, snap = false) {
    const prevCount = fresh ? 0 : this.data.count;
    const s = getState();
    const keyOf = (i: number | null) => (i === null ? undefined : this.siteKeys[i]);
    const selectedKey = keyOf(s.selected);
    const pinnedKeys = s.pinned.map(keyOf);
    const { data, keys, fixed } = toNetwork(this.site, { external: this.showExternal });
    this.data = data;
    this.siteKeys = keys;
    this.fixedPoints = fixed;
    const at = (k: string | undefined) => (k === undefined ? -1 : keys.indexOf(k));
    const current = this.site.current !== null ? at(this.site.nodes[this.site.current].key) : -1;
    const selected = at(selectedKey);
    const pinned = pinnedKeys.map(at).filter((i) => i >= 0);
    setState((st) => ({
      nodeCount: data.count,
      linkCount: data.linkCount,
      currentPage: current,
      selected: selected >= 0 ? selected : null,
      pinned,
      simRunning: false,
      graphVersion: st.graphVersion + 1
    }));
    for (const [g, scale] of [
      [this.main, 1],
      [this.mini, 0.42]
    ] as const) {
      if (g) this.loadInto(g, scale);
    }
    this.applyPins();
    this.main?.trackPointPositionsByIndices(this.trackedIndices());
    this.applyLens();
    // The drawing is computed (site-model.ts), not simulated: alpha 0 keeps the simulation off.
    // Growth glides every node to its new place; the first nodes and Scope (which renumbers
    // nodes, so a glide would mix them up) arrive in place.
    const glide = prevCount === 0 || snap ? 0 : GROW_GLIDE_MS;
    this.main?.render(0, glide);
    this.mini?.render(0, 0);
    // The camera follows the site as it grows, framing where nodes are going, until the operator aims.
    if (data.count > 0 && !this.operatorAimed) {
      this.main?.fitViewByPointPositions([...data.positions], prevCount === 0 ? 0 : glide, 0.3);
    }
    window.setTimeout(() => this.syncMini(true), glide + 60);
  }

  /** Back to the emulated network (tests; an ordinary browser never leaves it). */
  useEmulated() {
    this.recorded = false;
    this.site = emptySiteModel();
    this.siteKeys = [];
    this.showExternal = true;
    this.operatorAimed = false;
    this.data = generateNetwork(getState().seed);
    this.fixedPoints = [];
    this.main?.setConfigPartial(this.physics());
    setState({
      recorded: false,
      showExternal: true,
      nodeCount: this.data.count,
      linkCount: this.data.linkCount,
      currentPage: this.data.relays[0],
      selected: null,
      pinned: []
    });
    this.applyPins();
  }

  /** Live simulated positions, [x0, y0, x1, y1, ...] (tests and scripts read it through DEV hooks). */
  nodePositions(): number[] {
    return this.livePositions();
  }

  /**
   * Frames the whole graph; nothing to frame (and nothing cosmos.gl can measure) when it is empty.
   * Recorded pages carry their names beside them, so the recorded cosmos keeps a wider margin.
   */
  fitAll(duration: number, padding: number, simulation = false) {
    if (this.main && this.data.count > 0) this.main.fitView(duration, this.recorded ? Math.max(padding, 0.3) : padding, simulation);
  }

  /**
   * Current simulated positions of the main graph. cosmos.gl cannot read positions from a graph
   * that holds no points (it has no position texture yet): an empty recording reads as none.
   */
  private livePositions(): number[] {
    return this.main && this.data.count > 0 ? this.main.getPointPositions() : [];
  }

  /**
   * Points whose frame is centred on a page and holds every node: each node with its mirror
   * through the page, and a least extent so a lone page is not zoomed in on without end.
   */
  private aroundPage(page: number): number[] {
    const p = this.data.positions;
    const cx = p[page * 2];
    const cy = p[page * 2 + 1];
    const out: number[] = [cx - LAND_MIN_EXTENT, cy - LAND_MIN_EXTENT, cx + LAND_MIN_EXTENT, cy + LAND_MIN_EXTENT];
    for (let i = 0; i < this.data.count; i++) out.push(p[i * 2], p[i * 2 + 1], 2 * cx - p[i * 2], 2 * cy - p[i * 2 + 1]);
    return out;
  }

  /** Copy current simulated positions from the main graph into the minimap. */
  syncMini(force = false) {
    const now = performance.now();
    if (!this.main || !this.mini) return;
    if (!force && now - this.miniLastSync < 180) return;
    this.miniLastSync = now;
    const p = this.livePositions();
    if (!p.length) return;
    this.mini.setPointPositions(new Float32Array(p), true);
    this.mini.render();
    this.mini.fitView(0, 0.12);
    this.emitViewport();
  }

  // ---------------------------------------------------------------- viewport helpers
  /** Main-graph viewport expressed in minimap screen coordinates. */
  viewportInMini(): { x: number; y: number; w: number; h: number } | null {
    if (!this.main || !this.mini || !this.mainEl) return null;
    const { width, height } = this.mainEl.getBoundingClientRect();
    const tl = this.main.screenToSpacePosition([0, 0]);
    const br = this.main.screenToSpacePosition([width, height]);
    const a = this.mini.spaceToScreenPosition(tl);
    const b = this.mini.spaceToScreenPosition(br);
    if (![...a, ...b].every(Number.isFinite)) return null;
    return {
      x: Math.min(a[0], b[0]),
      y: Math.min(a[1], b[1]),
      w: Math.abs(b[0] - a[0]),
      h: Math.abs(b[1] - a[1])
    };
  }

  /** Centre the main camera on a point clicked inside the minimap. */
  panToMini(x: number, y: number, duration = 250) {
    if (!this.main || !this.mini) return;
    this.aimed();
    const space = this.mini.screenToSpacePosition([x, y]);
    this.main.setZoomTransformByPointPositions(
      new Float32Array(space),
      duration,
      this.main.getZoomLevel(),
      undefined,
      false
    );
  }

  hubScreenPositions(): Map<number, [number, number]> {
    const out = new Map<number, [number, number]>();
    if (!this.main || this.data.count === 0) return out;
    const tracked = this.main.getTrackedPointPositionsMap();
    tracked.forEach((pos, idx) => out.set(idx, this.main!.spaceToScreenPosition(pos)));
    return out;
  }

  // ---------------------------------------------------------------- lens + selection
  /** The node at the centre of the Page view: the selection if any, else the browser's page. */
  pageFocus(): number {
    const s = getState();
    return s.selected ?? s.currentPage;
  }

  applyLens() {
    const s = getState();
    const d = this.data;
    let highlightedPointIndices: number[] | undefined;
    let highlightedLinkIndices: number[] | undefined;

    if (s.view === 'page') {
      // One page and its connections: everything else is hidden, not greyed.
      // Under the Routes lens the page's path back to the core is included.
      const focus = this.pageFocus();
      let nodes = pageSubgraph(d, focus, s.pageHops);
      if (s.lens === 'routes') nodes = [...new Set([...nodes, ...pathToCore(d, focus)])].sort((x, y) => x - y);
      highlightedPointIndices = nodes;
      highlightedLinkIndices = linksWithin(d, nodes);
    } else if (s.selected !== null) {
      if (s.lens === 'routes') {
        const chain = pathToCore(d, s.selected);
        highlightedPointIndices = chain;
        highlightedLinkIndices = linksForChain(d, chain);
      } else {
        const neighbours = this.main?.getNeighboringPointIndices(s.selected) ?? [];
        highlightedPointIndices = [s.selected, ...neighbours];
      }
    } else if (s.lens === 'hubs') {
      highlightedPointIndices = d.hubs;
    } else if (s.lens === 'anomalies') {
      highlightedPointIndices = d.anomalies;
    } else if (s.lens === 'routes') {
      highlightedLinkIndices = [...d.crossLinks, ...d.linkKinds.flatMap((k, i) => (k === 'backbone' ? [i] : []))];
      const ends = new Set<number>();
      highlightedLinkIndices.forEach((l) => {
        ends.add(d.links[l * 2]);
        ends.add(d.links[l * 2 + 1]);
      });
      highlightedPointIndices = [...ends];
    }

    const inPage = s.view === 'page';
    const P = this.palette();
    const partial: GraphConfig = {
      hoveredPointRingColor: P.mist,
      focusedPointRingColor: P.white,
      outlinedPointRingColor: P.alert,
      renderLinks: s.linksOn,
      curvedLinks: s.lens === 'routes',
      pointGreyoutOpacity: inPage ? 0 : 0.1,
      linkGreyoutOpacity: inPage ? 0 : 0.04,
      focusedPointIndex: inPage ? this.pageFocus() : s.selected ?? undefined,
      highlightedPointIndices,
      highlightedLinkIndices,
      outlinedPointIndices: s.lens === 'anomalies' ? d.anomalies : s.pinned.length ? s.pinned : undefined
    };

    const pc = this.pointColors(s.lens);
    const lc = this.linkColors(s.lens);
    if (this.main) {
      this.main.setPointColors(pc);
      this.main.setLinkColors(lc);
      this.main.setConfigPartial(partial);
      this.main.render();
    }
    if (this.mini) {
      // The minimap always keeps the whole cosmos as context: dim, never hide.
      this.mini.setPointColors(pc);
      this.mini.setLinkColors(lc);
      this.mini.setConfigPartial({ ...partial, pointGreyoutOpacity: 0.15, linkGreyoutOpacity: 0.05 });
      this.mini.render();
    }
  }

  /** Page view camera: frame the page subgraph rather than a single node. */
  private framePage(duration = 900) {
    const s = getState();
    if (s.view !== 'page' || !this.main) return;
    this.aimed();
    const nodes = pageSubgraph(this.data, this.pageFocus(), s.pageHops);
    this.main.fitViewByPointIndices(nodes, duration, 0.3, false);
  }

  private select(index: number | null) {
    setState({ selected: index });
    this.main?.trackPointPositionsByIndices(this.trackedIndices());
    this.applyLens();
  }

  /** Nodes whose names stay on screen: the core and sectors (emulated), the core and pages (recorded). */
  labelIndices(): number[] {
    const d = this.data;
    if (!d.count) return [];
    return this.recorded ? [d.core, ...d.sectors, ...d.relays].slice(0, 61) : [d.core, ...d.sectors];
  }

  private trackedIndices(): number[] {
    const base = this.labelIndices();
    const sel = getState().selected;
    return sel === null || base.includes(sel) ? base : [...base, sel];
  }

  private handlePointClick(index: number) {
    const s = getState();
    if (!s.engaged) return;
    const m = this.data.meta[index];
    if (s.targetMode) {
      setState({ targetMode: false });
      this.select(index);
      this.aimed();
      this.main?.zoomToPointByIndex(index, 900, Math.max(3, this.main.getZoomLevel()), false);
      this.status(`Target locked: ${m.id}. ${m.degree} connections traced.`, 'ok');
      this.emitSfx('notice');
      return;
    }
    this.select(index);
    this.status(`Selected ${m.id} (${m.tier.toUpperCase()}).`, 'info');
    this.emitSfx('click');
  }

  private handleBackgroundClick() {
    const s = getState();
    if (!s.engaged) return;
    if (s.targetMode) {
      this.status('Target mode: select a node, or press ESC to cancel.', 'warn');
      this.emitSfx('command-error');
      return;
    }
    if (s.selected !== null) {
      this.select(null);
      this.status('Selection cleared.', 'info');
    }
  }

  private status(message: string, tone: 'info' | 'ok' | 'warn' = 'info') {
    setState((s) => ({ status: message, statusTone: tone, statusId: s.statusId + 1 }));
  }

  setLens(lens: LensId) {
    setState({ lens });
    this.applyLens();
    const label = lens.charAt(0).toUpperCase() + lens.slice(1);
    this.status(`Lens: ${label}.`, 'info');
  }

  // ---------------------------------------------------------------- views
  private transitionSeq = 0;

  /** Switch to another view. The transition record drives the stage's depth animation. */
  setView(to: ViewId): CommandResult {
    const from = getState().view;
    if (to === from) return { ok: false, message: `Already in the ${VIEW_BY_ID.get(to)!.label} view.`, sfx: 'command-error' };
    const dir = viewDepth(to) < viewDepth(from) ? 'in' : 'out';
    const id = ++this.transitionSeq;
    setState({ view: to, viewTransition: { from, to, dir, id } });
    const spec = VIEW_BY_ID.get(to)!;
    if (to === 'cosmos' && from === 'browser') {
      // Pulling back from the page itself: the cosmos opens on that page, selected and zoomed in on.
      const page = getState().currentPage;
      if (page < 0 || page >= this.data.count) {
        this.applyLens();
        this.fitAll(900, 0.18, false);
        return this.done({ ok: true, message: `View: ${spec.label}. Nothing recorded yet.`, sfx: 'view-dive' });
      }
      this.select(page);
      this.aimed();
      if (this.recorded) {
        // The recording: centred on the page with the whole drawing in view. A fixed close-up
        // left a big site's leaf page alone on screen with everything else outside it.
        this.main?.fitViewByPointPositions(this.aroundPage(page), 900, 0.12);
      } else this.main?.zoomToPointByIndex(page, 900, PAGE_ZOOM, true, false);
      return this.done({ ok: true, message: `View: ${spec.label}. Current page ${this.data.meta[page].id} selected.`, sfx: 'view-dive' });
    }
    this.applyLens();
    if (to === 'page') {
      this.framePage();
    } else if (to === 'cosmos') {
      this.fitAll(900, 0.18, false);
    }
    return this.done({ ok: true, message: `View: ${spec.label}. ${spec.tagline}.`, sfx: 'view-dive' });
  }

  /** V: pull back one view, wrapping from the cosmos back into the browser. */
  cycleView(): CommandResult {
    return this.setView(nextView(getState().view));
  }

  /** Called by the stage when its animation ends; ignores transitions already superseded. */
  endViewTransition(id: number) {
    if (getState().viewTransition?.id === id) setState({ viewTransition: null });
  }

  // ---------------------------------------------------------------- commands
  private done(r: CommandResult): CommandResult {
    this.status(r.message, r.ok ? 'ok' : 'warn');
    return r;
  }

  target(): CommandResult {
    const on = !getState().targetMode;
    setState({ targetMode: on });
    return this.done({
      ok: true,
      message: on ? 'Target mode armed. Select a node to lock on.' : 'Target mode disarmed.',
      sfx: on ? 'notice' : 'command-ok'
    });
  }

  stop(): CommandResult {
    const g = this.main;
    if (!g) return { ok: false, message: 'Graph not ready.' };
    const paused = !getState().paused;
    if (paused) g.pause();
    else if (g.progress >= 1) g.start(0.3);
    else g.unpause();
    setState({ paused });
    return this.done({ ok: true, message: paused ? 'Simulation halted.' : 'Simulation resumed.', sfx: 'command-ok' });
  }

  hold(): CommandResult {
    const s = getState();
    if (s.selected === null) return this.done({ ok: false, message: 'Hold requires a selected node.', sfx: 'command-error' });
    const set = new Set(s.pinned);
    const id = this.data.meta[s.selected].id;
    const pinned = set.has(s.selected);
    if (pinned) set.delete(s.selected);
    else set.add(s.selected);
    const list = [...set];
    setState({ pinned: list });
    this.applyPins();
    this.applyLens();
    return this.done({ ok: true, message: pinned ? `${id} released.` : `${id} holding position.`, sfx: 'command-ok' });
  }

  vision(): CommandResult {
    this.fitAll(700, 0.18, false);
    return this.done({ ok: true, message: 'Full network in view.', sfx: 'command-ok' });
  }

  focus(): CommandResult {
    const g = this.main;
    if (!g) return { ok: false, message: 'Graph not ready.' };
    this.aimed();
    const s = getState();
    if (s.selected !== null) {
      g.zoomToPointByIndex(s.selected, 800, Math.max(4, g.getZoomLevel()), false, false);
      return this.done({ ok: true, message: `Focused on ${this.data.meta[s.selected].id}.`, sfx: 'command-ok' });
    }
    // Tour the sectors; the step after the last sector fits the whole network (the old Vision).
    this.hubCycle = (this.hubCycle + 1) % (this.data.sectors.length + 1);
    if (this.hubCycle === this.data.sectors.length) return this.vision();
    const idx = this.data.sectors[this.hubCycle];
    g.zoomToPointByIndex(idx, 800, 2.2, true, false);
    return this.done({ ok: true, message: `Focused on ${this.data.meta[idx].id}.`, sfx: 'command-ok' });
  }

  /** Page view: toggle the connection depth between one and two hops. */
  depth(): CommandResult {
    const pageHops = getState().pageHops === 1 ? 2 : 1;
    setState({ pageHops });
    this.applyLens();
    this.framePage();
    return this.done({ ok: true, message: pageHops === 2 ? 'Depth: two hops. Connections of connections shown.' : 'Depth: one hop. Direct connections only.', sfx: 'command-ok' });
  }

  /** Page view: toggle the Routes lens, which adds the page's path back to the core. */
  route(): CommandResult {
    const on = getState().lens !== 'routes';
    this.setLens(on ? 'routes' : 'overview');
    return this.done({ ok: true, message: on ? 'Route traced to the core.' : 'Route hidden.', sfx: 'command-ok' });
  }

  /** Browser view commands exist as interface placeholders until the live page attaches. */
  placeholder(name: string): CommandResult {
    return this.done({ ok: true, message: `${name}: interface placeholder. Functionality attaches with the live page.`, sfx: 'command-ok' });
  }

  links(): CommandResult {
    const linksOn = !getState().linksOn;
    setState({ linksOn });
    this.applyLens();
    return this.done({ ok: true, message: linksOn ? 'Links visible.' : 'Links hidden.', sfx: 'command-ok' });
  }

  disperse(): CommandResult {
    const g = this.main;
    if (!g) return { ok: false, message: 'Graph not ready.' };
    window.clearTimeout(this.disperseTimer);
    g.setConfigPartial({ simulationRepulsion: BASE_REPULSION * 2.6 });
    g.start(1);
    setState({ paused: false });
    this.disperseTimer = window.setTimeout(() => {
      g.setConfigPartial({ simulationRepulsion: BASE_REPULSION });
    }, 1400);
    return this.done({ ok: true, message: 'Disperse pulse. Layout re-settling.', sfx: 'notice' });
  }

  regenerate(): CommandResult {
    if (this.recorded) return this.done({ ok: false, message: 'The cosmos is the recording: browse to grow it.', sfx: 'command-error' });
    const seed = Math.floor(Math.random() * 1e6);
    this.data = generateNetwork(seed);
    setState({
      seed,
      selected: null,
      pinned: [],
      targetMode: false,
      paused: false,
      nodeCount: this.data.count,
      linkCount: this.data.linkCount,
      currentPage: this.data.relays[0]
    });
    for (const [g, scale] of [
      [this.main, 1],
      [this.mini, 0.42]
    ] as const) {
      if (!g) continue;
      g.setPinnedPoints(null);
      this.loadInto(g, scale);
    }
    this.main?.trackPointPositionsByIndices(this.trackedIndices());
    this.applyLens();
    this.needsFit = true;
    this.main?.start(1);
    window.setTimeout(() => this.syncMini(true), 60);
    return this.done({
      ok: true,
      message: `Network regenerated (seed ${seed}). ${this.data.count.toLocaleString()} nodes.`,
      sfx: 'notice'
    });
  }

  clear(): CommandResult {
    const s = getState();
    const had = s.selected !== null || s.pinned.length > 0 || s.targetMode;
    setState({ targetMode: false, pinned: [] });
    this.applyPins();
    this.select(null);
    return this.done({
      ok: had,
      message: had ? 'Selection, holds and targeting cleared.' : 'Nothing to clear.',
      sfx: had ? 'command-ok' : 'command-error'
    });
  }

  cancel(): CommandResult | null {
    const s = getState();
    if (s.targetMode) {
      setState({ targetMode: false });
      return this.done({ ok: true, message: 'Target mode disarmed.', sfx: 'command-ok' });
    }
    if (s.selected !== null) {
      this.select(null);
      return this.done({ ok: true, message: 'Selection cleared.', sfx: 'command-ok' });
    }
    return null;
  }
}

export const controller = new GraphController();
