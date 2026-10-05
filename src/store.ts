import { useSyncExternalStore } from 'react';
import type { ViewId } from './views';
import type { MachineStats, PerfStats } from './metrics';
import { browserStorage, loadSettings, startsMuted, type Settings } from './settings';
import type { PageLoad } from './page-load';

export type { ViewId } from './views';

/** A lens is a perspective within a view: same graph, different emphasis. Keys 1-5. */
export type LensId = 'overview' | 'clusters' | 'hubs' | 'routes' | 'anomalies';

export const LENSES: { id: LensId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'clusters', label: 'Clusters' },
  { id: 'hubs', label: 'Hubs' },
  { id: 'routes', label: 'Routes' },
  { id: 'anomalies', label: 'Anomalies' }
];

/** A view switch in flight. `dir` is the camera's motion: 'in' dives toward the page, 'out' pulls back. */
export interface ViewTransition {
  from: ViewId;
  to: ViewId;
  dir: 'in' | 'out';
  id: number;
}

export interface UIState {
  engaged: boolean;
  /** The website under review, canonical http(s) URL. Null until the console is engaged. */
  targetUrl: string | null;
  /** Address the browser is on now (the shell reports it as the site navigates); null until known. */
  pageUrl: string | null;
  /** Whether the site's own history has somewhere to go (owned browser only). */
  canGoBack: boolean;
  canGoForward: boolean;
  /** The page loading now, for the address field's progress bar (src/page-load.ts); null when none. */
  pageLoad: PageLoad | null;
  muted: boolean;
  view: ViewId;
  viewTransition: ViewTransition | null;
  /** The view the stage is currently showing; lags `view` until the dive's midpoint. */
  stageView: ViewId;
  lens: LensId;
  /** Node index of the page the browser is on; the centre of the Page view. */
  currentPage: number;
  /** Connection depth shown in the Page view. */
  pageHops: 1 | 2;
  /** True while keyboard focus is inside the framed website. */
  keyboardInPage: boolean;
  /** Bottom panels folded away (C); the header stays so they can be brought back. */
  panelsHidden: boolean;
  /** The page's own performance (src/metrics.ts); null until the first sample. */
  perf: PerfStats | null;
  /** Machine and Artemis-process figures from the owned browser; null elsewhere. */
  machine: MachineStats | null;
  paused: boolean;
  simRunning: boolean;
  linksOn: boolean;
  targetMode: boolean;
  selected: number | null;
  pinned: number[];
  status: string;
  statusTone: 'info' | 'ok' | 'warn';
  statusId: number;
  nodeCount: number;
  linkCount: number;
  seed: number;
  /** The cosmos is the live recording of the site (owned browser), not the emulated network. */
  recorded: boolean;
  /** Recorded cosmos: also show hosts outside the review scope (the Scope command). */
  showExternal: boolean;
  /** Bumped whenever the graph's nodes change (labels follow it). */
  graphVersion: number;
  /** The settings in effect (saved in the browser's storage, src/settings.ts). */
  settings: Settings;
  /** The configuration view is open over the current view (`,`). */
  settingsOpen: boolean;
  /** The settings as edited, until Apply; null while the configuration view is closed. */
  settingsDraft: Settings | null;
  settingsCategory: string;
  settingsQuery: string;
  /** Autopilot speed (D in the Browser view): 0 off, 1 slow, 2 regular, 3 max. */
  autopilot: 0 | 1 | 2 | 3;
  /** The flight's progress as the owned browser reports it; null before the first report. */
  autopilotProgress: { visited: number; pending: number; etaMs: number } | null;
}

const savedSettings = loadSettings(browserStorage());

let state: UIState = {
  engaged: false,
  targetUrl: null,
  pageUrl: null,
  canGoBack: false,
  canGoForward: false,
  pageLoad: null,
  muted: startsMuted(savedSettings),
  view: 'cosmos',
  viewTransition: null,
  stageView: 'cosmos',
  lens: 'overview',
  currentPage: 0,
  pageHops: 1,
  keyboardInPage: false,
  panelsHidden: false,
  perf: null,
  machine: null,
  paused: false,
  simRunning: false,
  linksOn: true,
  targetMode: false,
  selected: null,
  pinned: [],
  status: 'Standby. Awaiting operator.',
  statusTone: 'info',
  statusId: 0,
  nodeCount: 0,
  linkCount: 0,
  seed: 7,
  recorded: false,
  showExternal: true,
  graphVersion: 0,
  settings: savedSettings,
  settingsOpen: false,
  settingsDraft: null,
  settingsCategory: 'scope',
  settingsQuery: '',
  autopilot: 0,
  autopilotProgress: null
};

const listeners = new Set<() => void>();

export const getState = (): UIState => state;

export const setState = (patch: Partial<UIState> | ((s: UIState) => Partial<UIState>)): void => {
  const next = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Select a primitive or stable reference from the store. */
export function useStore<T>(selector: (s: UIState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}
