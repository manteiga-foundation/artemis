// The Interceptor as a session over the store, the way the configuration view has one
// (src/settings-session.ts): arming, holding, editing, forwarding and dropping the traffic, each
// saying what happened on the console's status line. The panel and the hotkeys both call these, so
// a click and a key do the same thing.
//
// Pure data and the mutations over it live in src/interceptor.ts; this file is where they meet the
// store and the operator's words.

import { getState, setState, type UIState } from './store';
import {
  seedTraffic,
  trafficFromSiteEvents,
  type Header,
  type Traffic,
  type TrafficEntry
} from './interceptor';
import type { SiteEvent } from './site-events';
import { closeSettings } from './settings-session';

const say = (status: string, statusTone: UIState['statusTone'] = 'info') => setState((s) => ({ status, statusTone, statusId: s.statusId + 1 }));

/** The traffic in effect. The panel opens on the emulated sample until the recording fills it. */
export const currentTraffic = (s: Pick<UIState, 'traffic'>): Traffic => s.traffic ?? seedTraffic();

const put = (t: Traffic) => setState({ traffic: t });

const findHeld = (t: Traffic, id: number): TrafficEntry | null => {
  const e = t.entries.find((x) => x.id === id);
  return e && e.state === 'held' && !e.observed ? e : null;
};

/** Arm or disarm the proxy. Disarming releases whatever it was holding. */
export function armTraffic(t: Traffic = currentTraffic(getState()), armed = !t.armed): Traffic {
  const next: Traffic = armed
    ? { ...t, armed: true }
    : { ...t, armed: false, paused: false, entries: t.entries.map((e) => (e.state === 'held' ? { ...e, state: 'forwarded' as const } : e)) };
  put(next);
  say(armed ? 'Interceptor armed: requests stop here first.' : 'Interceptor disarmed: nothing is held; traffic goes straight through.', armed ? 'ok' : 'info');
  return next;
}

export const toggleArm = (): Traffic => armTraffic(currentTraffic(getState()));

/** Hold every request as it arrives. Holding is a property of an armed proxy. */
export function pauseTraffic(t: Traffic = currentTraffic(getState()), paused = !t.paused): Traffic {
  if (paused && !t.armed) {
    say('Hold needs the proxy armed (A). Nothing is being held.', 'warn');
    return t;
  }
  const next: Traffic = { ...t, paused };
  put(next);
  say(paused ? 'Hold on: every request waits for you.' : 'Hold off: requests go straight through.', paused ? 'ok' : 'info');
  return next;
}

export const togglePause = (): Traffic => pauseTraffic(currentTraffic(getState()));

export interface EditPatch {
  method?: string;
  url?: string;
  requestBody?: string | null;
  requestHeaders?: Header[];
}

/** Rewrite a held request before it goes. Only a held request can be rewritten. */
export function editEntry(t: Traffic, id: number, patch: EditPatch, silent = false): Traffic | null {
  const e = findHeld(t, id);
  if (!e) {
    if (!silent) say('Only a held request can be edited. Arm the proxy (A) to stop one first.', 'warn');
    return null;
  }
  const next: Traffic = {
    ...t,
    entries: t.entries.map((x) => (x.id === id ? { ...x, ...patch, edited: true } : x))
  };
  put(next);
  if (!silent) say(`Request ${id} edited: ${patch.method ?? e.method} ${patch.url ?? e.url}.`, 'ok');
  return next;
}

/** Send a held request on its way, as edited if it was. */
export function forwardEntry(t: Traffic, id: number): Traffic | null {
  const e = findHeld(t, id);
  if (!e) {
    say('Only a held request can be forwarded.', 'warn');
    return null;
  }
  // In the sample the answer is known: forwarding a held request completes it as accepted.
  const next: Traffic = {
    ...t,
    entries: t.entries.map((x) =>
      x.id === id
        ? { ...x, state: 'forwarded' as const, status: x.status ?? 200, responseHeaders: x.responseHeaders.length ? x.responseHeaders : [{ name: 'status', value: '200 OK' }], durationMs: x.durationMs ?? 96 }
        : x
    )
  };
  put(next);
  say(`Forwarded ${e.method} ${e.url}${e.edited ? ' (as edited)' : ''}.`, 'ok');
  return next;
}

/** Refuse a held request: it never reaches the site. */
export function dropEntry(t: Traffic, id: number): Traffic | null {
  const e = findHeld(t, id);
  if (!e) {
    say('Only a held request can be dropped.', 'warn');
    return null;
  }
  const next: Traffic = { ...t, entries: t.entries.map((x) => (x.id === id ? { ...x, state: 'dropped' as const } : x)) };
  put(next);
  say(`Dropped ${e.method} ${e.url}: it never reached the site.`, 'ok');
  return next;
}

/** Everything the proxy was holding, on its way. */
export function forwardAll(t: Traffic = currentTraffic(getState())): Traffic {
  const held = t.entries.filter((e) => e.state === 'held' && !e.observed);
  if (!held.length) {
    say('Nothing is held.', 'info');
    return t;
  }
  const ids = new Set(held.map((e) => e.id));
  const next: Traffic = {
    ...t,
    entries: t.entries.map((x) =>
      ids.has(x.id) ? { ...x, state: 'forwarded' as const, status: x.status ?? 200, responseHeaders: x.responseHeaders.length ? x.responseHeaders : [{ name: 'status', value: '200 OK' }], durationMs: x.durationMs ?? 96 } : x
    )
  };
  put(next);
  say(`Forwarded ${held.length} held request${held.length === 1 ? '' : 's'}.`, 'ok');
  return next;
}

/** Back to the emulated sample: what the panel shows before anything is intercepted. */
export function resetTraffic(): Traffic {
  const next = seedTraffic();
  put(next);
  say(`Interceptor reset: the sample capture, ${next.entries.length} requests.`);
  return next;
}

/** The feed from the recorder (src/App.tsx feeds server/site-feed.ts through this). */
export function trafficFromFeed(events: SiteEvent[]): Traffic {
  const before = currentTraffic(getState());
  const after = trafficFromSiteEvents(before, events);
  // Nothing about traffic in these events: leave the store alone rather than rewrite it.
  if (after !== before) put(after);
  return after;
}

// ---------------------------------------------------------------- the panel as a session

/**
 * Open the Interceptor over the current view. It is not a view: the graph and the site behind it
 * stay where they are. The panel opens on the emulated sample the first time; after that, on
 * whatever the proxy has been doing.
 */
export function openInterceptor(): void {
  const s = getState();
  if (s.interceptorOpen) return;
  const traffic = s.traffic ?? seedTraffic();
  // The two panels both take the stage; the configuration view steps aside.
  if (s.settingsOpen) closeSettings();
  setState({
    interceptorOpen: true,
    traffic,
    trafficSelected: traffic.entries.find((e) => e.state === 'held')?.id ?? traffic.entries[0]?.id ?? null
  });
  say(`Interceptor open: ${traffic.entries.length} requests${traffic.armed ? ', proxy armed' : ', proxy disarmed'}. 1 or Esc closes it.`);
}

export function closeInterceptor(): void {
  const s = getState();
  if (!s.interceptorOpen) return;
  setState({ interceptorOpen: false, trafficQuery: '' });
  say('Interceptor closed.');
}

export const toggleInterceptor = (): void => (getState().interceptorOpen ? closeInterceptor() : openInterceptor());

/** Select a request in the list: what the detail pane shows. */
export function selectTraffic(id: number | null): void {
  setState({ trafficSelected: id });
}

export function setTrafficQuery(query: string): void {
  setState({ trafficQuery: query });
}

/** The selected request, when it is one the operator can act on. */
const selectedHeld = (s: UIState) => {
  const t = currentTraffic(s);
  const e = s.trafficSelected === null ? undefined : t.entries.find((x) => x.id === s.trafficSelected);
  return { t, e: e && e.state === 'held' && !e.observed ? e : null };
};

/** Forward the selected held request. */
export function forwardSelected(): void {
  const { t, e } = selectedHeld(getState());
  if (!e) {
    say('Select a held request first: only those can be forwarded.', 'warn');
    return;
  }
  forwardEntry(t, e.id);
}

/** Drop the selected held request. */
export function dropSelected(): void {
  const { t, e } = selectedHeld(getState());
  if (!e) {
    say('Select a held request first: only those can be dropped.', 'warn');
    return;
  }
  dropEntry(t, e.id);
}

/** Move the selection to the next held request, wrapping: the operator walks the queue. */
export function nextHeld(): void {
  const s = getState();
  const t = currentTraffic(s);
  const held = t.entries.filter((e) => e.state === 'held');
  if (!held.length) {
    say('Nothing is held. Arm the proxy (A) to stop a request.', 'warn');
    return;
  }
  const at = held.findIndex((e) => e.id === s.trafficSelected);
  const next = held[(at + 1) % held.length];
  setState({ trafficSelected: next.id });
  say(`Held ${held.length}: ${next.method} ${next.url}`);
}

export const TRAFFIC_SEARCH_ID = 'traffic-search';

export function focusTrafficSearch(): void {
  document.getElementById(TRAFFIC_SEARCH_ID)?.focus();
}

export const TRAFFIC_EDITOR_ID = 'traffic-editor';

export function focusTrafficEditor(): void {
  const el = document.getElementById(TRAFFIC_EDITOR_ID);
  if (!el) {
    say('Select a held request to edit it.', 'warn');
    return;
  }
  el.focus();
}
