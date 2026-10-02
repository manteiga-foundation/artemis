import { useSyncExternalStore } from 'react';

export type ViewId = 'overview' | 'clusters' | 'hubs' | 'routes' | 'anomalies';

export const VIEWS: { id: ViewId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'clusters', label: 'Clusters' },
  { id: 'hubs', label: 'Hubs' },
  { id: 'routes', label: 'Routes' },
  { id: 'anomalies', label: 'Anomalies' }
];

export interface UIState {
  engaged: boolean;
  muted: boolean;
  view: ViewId;
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
}

let state: UIState = {
  engaged: false,
  muted: false,
  view: 'overview',
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
  seed: 7
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
