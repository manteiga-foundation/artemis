// The autopilot's control on the console side (the user's sketch): D in the Browser view steps the
// speed, off -> slow -> regular -> max -> off, and the card shows it as three squares. The flight
// itself happens in the owned browser (server/autopilot.ts drives the site); the shell reports
// progress, the end of the site, and the operator taking the controls, which disengages it.

import { setState, getState, type UIState } from './store';
import { shellBridge } from './shell';

export type Speed = UIState['autopilot'];

export const SPEEDS: Record<Exclude<Speed, 0>, { label: string; does: string }> = {
  1: { label: 'slow', does: 'about 10 s a page, scrolling down it, for a person to glance at' },
  2: { label: 'regular', does: 'about 3 s a page, no scrolling' },
  3: { label: 'max', does: 'the next page as soon as one has loaded, to cover the whole site' }
};

export const speedLabel = (s: Speed): string => (s === 0 ? 'off' : SPEEDS[s].label);

/** What the autopilot reports from the owned browser (shell/main.ts relays it). */
export interface AutopilotStatus {
  speed: Speed;
  event: 'progress' | 'done' | 'disengaged' | 'stuck' | 'note';
  visited?: number;
  pending?: number;
  etaMs?: number;
  url?: string;
  reason?: string;
  /** What it did for the site (a dialog answered, a popup closed): a note on the console. */
  text?: string;
}

const say = (status: string, statusTone: UIState['statusTone'] = 'info') => setState((s) => ({ status, statusTone, statusId: s.statusId + 1 }));

export function etaText(ms: number): string {
  if (ms <= 0) return 'nothing left';
  if (ms < 60_000) return 'under a minute left';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `about ${minutes} min left`;
  return `about ${Math.floor(minutes / 60)} h ${minutes % 60} min left`;
}

/** D: the next speed, told to the owned browser when there is one. */
export function stepAutopilot(shell: { autopilot(speed: number): void } | null = shellBridge()): Speed {
  const prev = getState().autopilot;
  const next = ((prev + 1) % 4) as Speed;
  // A new flight starts without the last one's figures.
  setState(prev === 0 ? { autopilot: next, autopilotProgress: null } : { autopilot: next });
  shell?.autopilot(next);
  if (next === 0) say('Autopilot off.');
  else {
    const where = shell ? '' : ' It flies in the owned browser (bun run artemis); here only its controls answer.';
    say(`Autopilot: ${SPEEDS[next].label}, ${SPEEDS[next].does}. D for the next speed.${where}`, 'ok');
  }
  return next;
}

/** A report from the owned browser. */
export function autopilotFromShell(r: AutopilotStatus): void {
  if (r.event === 'disengaged') {
    setState({ autopilot: 0 });
    say(r.reason ? `Autopilot disengaged: ${r.reason}` : 'Autopilot disengaged: you took the controls.', 'warn');
    return;
  }
  if (r.event === 'note') {
    if (getState().autopilot !== 0 && r.text) say(`Autopilot: ${r.text}`);
    return;
  }
  const progress = { visited: r.visited ?? 0, pending: r.pending ?? 0, etaMs: r.etaMs ?? 0 };
  if (r.event === 'done') {
    setState({ autopilot: 0, autopilotProgress: progress });
    say(`Autopilot: the site is covered. ${progress.visited} page${progress.visited === 1 ? '' : 's'} visited, nothing left to open.`, 'ok');
    return;
  }
  if (r.event === 'stuck') {
    setState({ autopilot: 0, autopilotProgress: progress });
    say(`Autopilot stopped: ${r.reason ?? 'it could not go on'}.`, 'warn');
    return;
  }
  // A report still on its way when the flight was turned off (D, or the operator's hand) is stale.
  if (getState().autopilot === 0) return;
  setState({ autopilot: r.speed, autopilotProgress: progress });
  const pages = `${progress.visited} page${progress.visited === 1 ? '' : 's'}`;
  say(`Autopilot: ${speedLabel(r.speed)} · ${pages} visited, ${progress.pending} to go, ${etaText(progress.etaMs)}${r.url ? ` · ${r.url}` : ''}`);
}
