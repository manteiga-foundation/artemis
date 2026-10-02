import { Graph, type GraphConfig } from '@cosmos.gl/graph';
import { generateNetwork, linksForChain, pathToCore, type NetworkData } from './data';
import { EG, SECTOR_HUES, mix, rgba, type RGBA } from '../theme';
import { getState, setState, type ViewId } from '../store';

export type Sfx = 'click' | 'info' | 'error' | 'type' | 'intro' | 'hover';
export interface CommandResult {
  ok: boolean;
  message: string;
  sfx?: Sfx;
}

type SfxListener = (sfx: Sfx) => void;
type Listener = () => void;

const BASE_REPULSION = 0.9;
const WHITE = rgba(EG.white);
const BG = rgba(EG.bg);

const LINK_WIDTH: Record<string, number> = {
  trunk: 2.4,
  backbone: 1.6,
  branch: 1.3,
  cross: 1.1,
  leaf: 0.7,
  mesh: 0.5
};

class GraphController {
  main: Graph | null = null;
  mini: Graph | null = null;
  mainEl: HTMLDivElement | null = null;
  miniEl: HTMLDivElement | null = null;
  data: NetworkData = generateNetwork(getState().seed);

  private miniLastSync = 0;
  private viewportListeners = new Set<Listener>();
  private sfxListeners = new Set<SfxListener>();
  private hubCycle = -1;
  private disperseTimer = 0;
  private tickCount = 0;
  private ticksSinceStart = 0;
  private needsFit = true;
  tickRate = 0; // simulation ticks per second (measured)

  constructor() {
    setState({ nodeCount: this.data.count, linkCount: this.data.linkCount });
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
  private emitSfx(s: Sfx) {
    this.sfxListeners.forEach((l) => l(s));
  }

  // ---------------------------------------------------------------- colours
  private pointColor(i: number, view: ViewId): RGBA {
    const m = this.data.meta[i];
    if (view === 'anomalies' && this.anomalySet.has(i)) return rgba(EG.alert);
    if (m.tier === 'core') return WHITE;
    if (view === 'clusters') {
      const hue = rgba(SECTOR_HUES[m.sector]);
      if (m.tier === 'sector') return mix(hue, WHITE, 0.35);
      if (m.tier === 'relay') return mix(hue, WHITE, 0.1);
      return mix(hue, BG, 0.18 + m.jitter * 0.22);
    }
    if (m.tier === 'sector') return rgba('#9db4f8');
    if (m.tier === 'relay') return rgba(EG.azure);
    return mix(rgba(EG.royal), rgba('#5a7ff0'), m.jitter * 0.8);
  }

  private anomalySet = new Set<number>();

  private pointColors(view: ViewId): Float32Array {
    const { count } = this.data;
    const out = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) out.set(this.pointColor(i, view), i * 4);
    return out;
  }

  private linkColors(view: ViewId): Float32Array {
    const { linkKinds, links, meta } = this.data;
    const out = new Float32Array(linkKinds.length * 4);
    for (let l = 0; l < linkKinds.length; l++) {
      const kind = linkKinds[l];
      let c: RGBA;
      if (view === 'clusters' && kind !== 'trunk' && kind !== 'backbone' && kind !== 'cross') {
        const s = meta[links[l * 2 + 1]].sector;
        c = rgba(SECTOR_HUES[Math.max(0, s)], kind === 'branch' ? 0.6 : 0.26);
      } else if (view === 'routes' && kind === 'cross') {
        c = rgba(EG.mist, 0.95);
      } else {
        switch (kind) {
          case 'trunk':
            c = rgba(EG.mist, 0.85);
            break;
          case 'backbone':
            c = rgba(EG.sky, 0.55);
            break;
          case 'branch':
            c = rgba(EG.azure, 0.6);
            break;
          case 'cross':
            c = rgba(EG.azure, 0.35);
            break;
          case 'mesh':
            c = rgba(EG.royal, 0.2);
            break;
          default:
            c = rgba(EG.royal, 0.3);
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
      const base = m.tier === 'core' ? 32 : m.tier === 'sector' ? 16 : m.tier === 'relay' ? 8 : 2.6 + m.jitter * 1.8;
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
      simulationGravity: 0.22,
      simulationRepulsion: BASE_REPULSION,
      simulationLinkSpring: 1.1,
      simulationLinkDistance: 9,
      simulationFriction: 0.86,
      simulationDecay: 4200,
      simulationCluster: 0.22,
      simulationRepulsionFromMouse: 2,
      enableDrag: true,
      fitViewOnInit: true,
      fitViewDelay: 900,
      fitViewPadding: 0.18,
      fitViewDuration: 700,
      attribution: '',
      onPointClick: (index) => this.handlePointClick(index),
      onBackgroundClick: () => this.handleBackgroundClick(),
      onZoom: () => this.emitViewport(),
      onZoomEnd: () => this.emitViewport(),
      onSimulationStart: () => {
        this.ticksSinceStart = 0;
        setState({ simRunning: true });
      },
      onSimulationTick: () => {
        this.tickCount++;
        this.ticksSinceStart++;
        if (this.needsFit && (this.ticksSinceStart === 90 || this.ticksSinceStart === 240)) {
          this.main?.fitView(700, 0.16, true);
        }
        this.syncMini();
      },
      onSimulationEnd: () => {
        setState({ simRunning: false });
        if (this.needsFit) {
          this.needsFit = false;
          this.main?.fitView(900, 0.16, false);
        }
        this.syncMini(true);
      },
      onSimulationPause: () => setState({ simRunning: false }),
      onSimulationUnpause: () => setState({ simRunning: true }),
      onDragEnd: () => this.syncMini(true),
      onPointMouseOver: () => this.emitSfx('hover')
    };
    const g = new Graph(el, config);
    this.main = g;
    this.loadInto(g, 1);
    g.trackPointPositionsByIndices([this.data.core, ...this.data.sectors]);
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

  private loadInto(g: Graph, sizeScale: number) {
    const view = getState().view;
    this.anomalySet = new Set(this.data.anomalies);
    g.setPointPositions(new Float32Array(this.data.positions));
    g.setLinks(this.data.links);
    g.setPointColors(this.pointColors(view));
    g.setPointSizes(this.pointSizes(sizeScale));
    g.setLinkColors(this.linkColors(view));
    g.setLinkWidths(this.linkWidths().map((w) => w * (sizeScale < 1 ? 0.6 : 1)));
    if (sizeScale === 1) {
      // Pull each sector toward a fixed slot on a hexagonal ring so the overview keeps
      // the core -> sectors -> satellites reading from the sketch.
      g.setPointClusters(this.data.meta.map((m) => (m.sector >= 0 ? m.sector : undefined)));
      g.setClusterPositions(this.data.clusterPositions);
    }
  }

  /** Copy current simulated positions from the main graph into the minimap. */
  syncMini(force = false) {
    const now = performance.now();
    if (!this.main || !this.mini) return;
    if (!force && now - this.miniLastSync < 180) return;
    this.miniLastSync = now;
    const p = this.main.getPointPositions();
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
    if (!this.main) return out;
    const tracked = this.main.getTrackedPointPositionsMap();
    tracked.forEach((pos, idx) => out.set(idx, this.main!.spaceToScreenPosition(pos)));
    return out;
  }

  // ---------------------------------------------------------------- view + selection
  applyView() {
    const s = getState();
    const d = this.data;
    let highlightedPointIndices: number[] | undefined;
    let highlightedLinkIndices: number[] | undefined;

    if (s.selected !== null) {
      if (s.view === 'routes') {
        const chain = pathToCore(d, s.selected);
        highlightedPointIndices = chain;
        highlightedLinkIndices = linksForChain(d, chain);
      } else {
        const neighbours = this.main?.getNeighboringPointIndices(s.selected) ?? [];
        highlightedPointIndices = [s.selected, ...neighbours];
      }
    } else if (s.view === 'hubs') {
      highlightedPointIndices = d.hubs;
    } else if (s.view === 'anomalies') {
      highlightedPointIndices = d.anomalies;
    } else if (s.view === 'routes') {
      highlightedLinkIndices = [...d.crossLinks, ...d.linkKinds.flatMap((k, i) => (k === 'backbone' ? [i] : []))];
      const ends = new Set<number>();
      highlightedLinkIndices.forEach((l) => {
        ends.add(d.links[l * 2]);
        ends.add(d.links[l * 2 + 1]);
      });
      highlightedPointIndices = [...ends];
    }

    const partial: GraphConfig = {
      renderLinks: s.linksOn,
      curvedLinks: s.view === 'routes',
      focusedPointIndex: s.selected ?? undefined,
      highlightedPointIndices,
      highlightedLinkIndices,
      outlinedPointIndices: s.view === 'anomalies' ? d.anomalies : s.pinned.length ? s.pinned : undefined
    };

    const pc = this.pointColors(s.view);
    const lc = this.linkColors(s.view);
    for (const g of [this.main, this.mini]) {
      if (!g) continue;
      g.setPointColors(pc);
      g.setLinkColors(lc);
      g.setConfigPartial(partial);
      g.render();
    }
  }

  private select(index: number | null) {
    setState({ selected: index });
    if (this.main) {
      const base = [this.data.core, ...this.data.sectors];
      this.main.trackPointPositionsByIndices(index === null ? base : [...base, index]);
    }
    this.applyView();
  }

  private handlePointClick(index: number) {
    const s = getState();
    if (!s.engaged) return;
    const m = this.data.meta[index];
    if (s.targetMode) {
      setState({ targetMode: false });
      this.select(index);
      this.main?.zoomToPointByIndex(index, 900, Math.max(3, this.main.getZoomLevel()), false);
      this.status(`Target locked: ${m.id}. ${m.degree} connections traced.`, 'ok');
      this.emitSfx('info');
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
      this.emitSfx('error');
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

  setView(view: ViewId) {
    setState({ view });
    this.applyView();
    const label = view.charAt(0).toUpperCase() + view.slice(1);
    this.status(`View: ${label}.`, 'info');
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
      sfx: on ? 'info' : 'click'
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
    return this.done({ ok: true, message: paused ? 'Simulation halted.' : 'Simulation resumed.', sfx: 'click' });
  }

  hold(): CommandResult {
    const s = getState();
    if (s.selected === null) return this.done({ ok: false, message: 'Hold requires a selected node.', sfx: 'error' });
    const set = new Set(s.pinned);
    const id = this.data.meta[s.selected].id;
    const pinned = set.has(s.selected);
    if (pinned) set.delete(s.selected);
    else set.add(s.selected);
    const list = [...set];
    setState({ pinned: list });
    this.main?.setPinnedPoints(list.length ? list : null);
    this.applyView();
    return this.done({ ok: true, message: pinned ? `${id} released.` : `${id} holding position.`, sfx: 'click' });
  }

  vision(): CommandResult {
    this.main?.fitView(700, 0.18, false);
    return this.done({ ok: true, message: 'Full network in view.', sfx: 'click' });
  }

  focus(): CommandResult {
    const g = this.main;
    if (!g) return { ok: false, message: 'Graph not ready.' };
    const s = getState();
    if (s.selected !== null) {
      g.zoomToPointByIndex(s.selected, 800, Math.max(4, g.getZoomLevel()), false, false);
      return this.done({ ok: true, message: `Focused on ${this.data.meta[s.selected].id}.`, sfx: 'click' });
    }
    this.hubCycle = (this.hubCycle + 1) % this.data.sectors.length;
    const idx = this.data.sectors[this.hubCycle];
    g.zoomToPointByIndex(idx, 800, 2.2, true, false);
    return this.done({ ok: true, message: `Focused on ${this.data.meta[idx].id}.`, sfx: 'click' });
  }

  links(): CommandResult {
    const linksOn = !getState().linksOn;
    setState({ linksOn });
    this.applyView();
    return this.done({ ok: true, message: linksOn ? 'Links visible.' : 'Links hidden.', sfx: 'click' });
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
    return this.done({ ok: true, message: 'Disperse pulse. Layout re-settling.', sfx: 'info' });
  }

  regenerate(): CommandResult {
    const seed = Math.floor(Math.random() * 1e6);
    this.data = generateNetwork(seed);
    setState({
      seed,
      selected: null,
      pinned: [],
      targetMode: false,
      paused: false,
      nodeCount: this.data.count,
      linkCount: this.data.linkCount
    });
    for (const [g, scale] of [
      [this.main, 1],
      [this.mini, 0.42]
    ] as const) {
      if (!g) continue;
      g.setPinnedPoints(null);
      this.loadInto(g, scale);
    }
    this.main?.trackPointPositionsByIndices([this.data.core, ...this.data.sectors]);
    this.applyView();
    this.needsFit = true;
    this.main?.start(1);
    window.setTimeout(() => this.syncMini(true), 60);
    return this.done({
      ok: true,
      message: `Network regenerated (seed ${seed}). ${this.data.count.toLocaleString()} nodes.`,
      sfx: 'info'
    });
  }

  clear(): CommandResult {
    const s = getState();
    const had = s.selected !== null || s.pinned.length > 0 || s.targetMode;
    setState({ targetMode: false, pinned: [] });
    this.main?.setPinnedPoints(null);
    this.select(null);
    return this.done({
      ok: had,
      message: had ? 'Selection, holds and targeting cleared.' : 'Nothing to clear.',
      sfx: had ? 'click' : 'error'
    });
  }

  cancel(): CommandResult | null {
    const s = getState();
    if (s.targetMode) {
      setState({ targetMode: false });
      return this.done({ ok: true, message: 'Target mode disarmed.', sfx: 'click' });
    }
    if (s.selected !== null) {
      this.select(null);
      return this.done({ ok: true, message: 'Selection cleared.', sfx: 'click' });
    }
    return null;
  }
}

export const controller = new GraphController();
