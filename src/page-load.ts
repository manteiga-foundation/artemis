// Page loading, for the address field that doubles as a soft progress bar. No browser knows a real
// percentage of a page load; like theirs, this bar eases toward a cap for each phase it has seen
// (navigation started, document committed, DOM ready) and fills when loading stops. The shell
// reports all four signals (shell/main.ts); an ordinary browser's frame only says started and
// loaded, so its bar creeps between the two.

import { setState } from './store';

export type LoadPhase = 'start' | 'commit' | 'dom' | 'done';
export type LoadEvent = LoadPhase | 'fail';

/** A load in progress: the phase, when it began, how full the bar was then, when the load began. */
export interface PageLoad {
  phase: LoadPhase;
  at: number;
  from: number;
  since: number;
}

/** How long the full bar stays before it goes (ms). */
export const DONE_MS = 450;

const ORDER: Record<LoadPhase, number> = { start: 0, commit: 1, dom: 2, done: 3 };
// Where each phase starts, the cap it eases toward and how quickly (ms).
const PHASES: Record<Exclude<LoadPhase, 'done'>, { floor: number; cap: number; tau: number }> = {
  start: { floor: 0.08, cap: 0.45, tau: 2000 },
  commit: { floor: 0.35, cap: 0.8, tau: 1600 },
  dom: { floor: 0.7, cap: 0.95, tau: 1200 }
};

/** How full the bar is at `now` (0 to 1), or null when there is no bar. */
export function loadProgress(load: PageLoad | null, now: number): number | null {
  if (!load) return null;
  if (load.phase === 'done') return now - load.at < DONE_MS ? 1 : null;
  const { floor, cap, tau } = PHASES[load.phase];
  const start = Math.max(load.from, floor);
  return start + (Math.max(cap, start) - start) * (1 - Math.exp(-Math.max(0, now - load.at) / tau));
}

/** The load after a signal. A new page always starts again; nothing else goes backwards. */
export function loadStep(load: PageLoad | null, event: LoadEvent, now: number): PageLoad | null {
  if (event === 'start') return { phase: 'start', at: now, from: 0, since: now };
  if (!load || load.phase === 'done') return load;
  const phase: LoadPhase = event === 'fail' ? 'done' : event;
  if (ORDER[phase] <= ORDER[load.phase]) return load;
  return { phase, at: now, from: loadProgress(load, now) ?? 0, since: load.since };
}

/** A page-load signal into the store: the shell's, or the ordinary browser's frame. */
export const pageLoadSignal = (event: LoadEvent) => setState((s) => ({ pageLoad: loadStep(s.pageLoad, event, performance.now()) }));
