// The autopilot flying the owned browser's site (the user's notes): the flight plan in
// server/autopilot.ts, driven here with Playwright on the site's page. The console sets the speed
// (D); the shell keeps it (shell/main.ts, shell/autopilot-state.ts); this polls it, flies while it
// is not off, marks when it acts so its clicks are recorded as its own, and reports the flight.
//
// Speeds: slow stays about 10 s on a page and scrolls down it for a person to glance at; regular
// about 3 s, no scrolling; max goes on as soon as the page has loaded. A change of speed applies at
// once, off stops the flight between steps (within a quarter second while it dwells).

import type { ElectronApplication, Page } from 'playwright';
import { fly, keyOf, type FlightDriver, type Link } from './autopilot';
import type { Recorder } from './recorder';
import { inScope, scopeHostOf } from '../src/scope';

type Speed = 0 | 1 | 2 | 3;

const DWELL_MS = { 1: 10_000, 2: 3_000 } as const;
/** A page's time at each speed, until the flight has measured its own pace. */
const ESTIMATE_MS = { 1: 11_000, 2: 4_000, 3: 1_500 } as const;
const NAV_TIMEOUT = 15_000;
const STEP_MS = 250;

// Page-side code goes as script strings: the server compiles without DOM types.
const LINKS = `(() => [...document.querySelectorAll('a[href]')].map((a) => ({
  href: a.href,
  text: (a.innerText || a.getAttribute('aria-label') || a.title || '').replace(/\\s+/g, ' ').trim().slice(0, 120)
})))()`;
const visibleLinkIndex = (href: string) => `(() => [...document.querySelectorAll('a[href]')].findIndex((a) => {
  const r = a.getBoundingClientRect();
  const s = getComputedStyle(a);
  return a.href === ${JSON.stringify(href)} && r.width > 0 && r.height > 0 && s.visibility !== 'hidden';
}))()`;
/** One step of the slow speed's scroll: about 32 steps from the top to the bottom. */
const SCROLL_STEP = `(() => {
  const max = document.documentElement.scrollHeight - innerHeight;
  if (max > 0) scrollTo({ top: Math.min(max, scrollY + Math.max(40, max / 32)), behavior: 'smooth' });
})()`;

export interface Autopilot {
  /** Whether it is flying now (a speed is set): the site's dialogs are then its to answer. */
  flying(): boolean;
  /** It answered a dialog of the site's (the note says how): it moves on from that page at once. */
  answered(note: string): void;
  stop(): Promise<void>;
}

/**
 * What the flight tells the Bun side (the launcher's terminal): the reports it sends the console,
 * and `speed` when the speed it reads changes (the console's D, or a hand on the site: off).
 */
export interface AutopilotEvent {
  event: 'speed' | 'progress' | 'done' | 'disengaged' | 'stuck' | 'note';
  speed: Speed;
  previous?: Speed;
  visited?: number;
  pending?: number;
  etaMs?: number;
  url?: string;
  reason?: string;
  text?: string;
}

export function startAutopilot(o: { app: ElectronApplication; site: Page; recorder: Recorder | null; pollMs?: number; onEvent?: (e: AutopilotEvent) => void }): Autopilot {
  const { app, site } = o;
  let speed: Speed = 0;
  let stopping = false;
  let flight: Promise<void> | null = null;
  const tell = (e: AutopilotEvent) => {
    try {
      o.onEvent?.(e);
    } catch {
      // a listener's trouble never stops the flight
    }
  };

  const shell = <T>(name: 'speed' | 'acting' | 'land' | 'report', arg?: unknown) =>
    app.evaluate(
      // The main process's evaluate gets the electron module first, then the argument.
      (_electron, { name, arg }) => (globalThis as unknown as { __artemisAutopilot?: Record<string, (a?: unknown) => unknown> }).__artemisAutopilot?.[name]?.(arg),
      { name, arg }
    ) as Promise<T>;
  const report = (status: Record<string, unknown>) => {
    tell(status as unknown as AutopilotEvent);
    return shell('report', status).catch(() => {});
  };
  const stopped = () => stopping || speed === 0;
  // The page it is on talked back (it answered a dialog there): it does not stay. Electron's native
  // box for that dialog closes only when the page navigates.
  let talkedBack = false;

  const driver: FlightDriver = {
    url: async () => site.url(),
    links: async () => (await site.evaluate(LINKS)) as Link[],
    async follow(link) {
      talkedBack = false;
      const before = keyOf(site.url());
      const i = (await site.evaluate(visibleLinkIndex(link.href)).catch(() => -1)) as number;
      let clicked = false;
      if (i >= 0) {
        await shell('acting', true).catch(() => {});
        try {
          await site.locator('a[href]').nth(i).click({ timeout: 4000 });
          clicked = true;
        } catch {
          clicked = false;
        } finally {
          await shell('acting', false).catch(() => {});
        }
      }
      // Hidden or covered: reached by its address, still from the page that links to it.
      if (!clicked) await site.goto(link.href, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT }).catch(() => {});
      await site.waitForURL((u) => keyOf(u.toString()) !== before, { timeout: 8000, waitUntil: 'domcontentloaded' }).catch(() => {});
      return keyOf(site.url()) !== before;
    },
    async back() {
      talkedBack = false;
      await site.goBack({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT }).catch(() => {});
    },
    async goTo(url) {
      talkedBack = false;
      await site.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    },
    async dwell() {
      const started = Date.now();
      if (talkedBack) return;
      if (speed === 3) {
        await site.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
        return;
      }
      while (!stopped() && !talkedBack) {
        const stay = speed === 1 ? DWELL_MS[1] : speed === 2 ? DWELL_MS[2] : 0;
        if (Date.now() - started >= stay) break;
        if (speed === 1) await site.evaluate(SCROLL_STEP).catch(() => {});
        await Bun.sleep(STEP_MS);
      }
    }
  };

  /** What the cosmos already has, from the recording: never visited again. */
  const recorded = () => {
    const events = o.recorder?.snapshot() ?? [];
    const session = events.find((e) => e.type === 'session');
    const urls: string[] = [];
    for (const e of events) if (e.type === 'commit' || (e.type === 'visit' && e.committed)) urls.push(e.url);
    return { scopeHost: session?.type === 'session' ? session.scopeHost : null, urls };
  };

  const land = async (status: Record<string, unknown>) => {
    speed = 0;
    await shell('land').catch(() => {});
    await report({ speed: 0, ...status });
    await settle();
  };
  /**
   * Landed on a page that talked back with no navigation since: its native box is still up. A
   * reload closes it, and whatever the site says then is asked of the operator, in a live box.
   */
  const settle = async () => {
    if (!talkedBack) return;
    talkedBack = false;
    await site.reload({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT }).catch(() => {});
  };

  const takeOff = async () => {
    const start = site.url();
    if (!/^https?:\/\//i.test(start)) return land({ event: 'stuck', reason: 'there is no website to fly yet' });
    const { scopeHost, urls } = recorded();
    const scope = scopeHost ?? scopeHostOf(start);
    const hubs = [
      ...new Set(
        urls.filter((u) => {
          try {
            return inScope(new URL(u).hostname, scope);
          } catch {
            return false;
          }
        })
      )
    ];
    try {
      const result = await fly(driver, {
        scopeHost: scope,
        known: urls,
        hubs,
        stopped,
        estimateMs: () => ESTIMATE_MS[speed === 0 ? 3 : speed],
        onProgress: (p) => void report({ speed, event: 'progress', ...p })
      });
      if (stopping) return;
      if (result.ended === 'stopped') await settle();
      if (result.ended === 'done') await land({ event: 'done', visited: result.visited.length, pending: 0, etaMs: 0 });
      else if (result.ended === 'stuck') await land({ event: 'stuck', reason: 'too many links in a row went nowhere', visited: result.visited.length });
    } catch (e) {
      if (!stopping) await land({ event: 'stuck', reason: `the site stopped answering (${String((e as Error).message ?? e).split('\n')[0]})` });
    }
  };

  // Popups the site opens while it flies are its doing: they would cover the console and take the
  // focus, and it cannot use them, so it closes them and says so. The operator's popups (a sign-in
  // window) are never touched.
  const onPopup = (popup: Page) => {
    if (stopped()) return;
    const url = popup.url();
    void popup.close().catch(() => {});
    void report({ speed, event: 'note', text: `closed a popup the site opened${url && url !== 'about:blank' ? ` (${url})` : ''}` });
  };
  site.on('popup', onPopup);

  const timer = setInterval(() => {
    if (stopping) return;
    shell<number>('speed')
      .then((s) => {
        const next = (s === 1 || s === 2 || s === 3 ? s : 0) as Speed;
        if (next !== speed && !stopping) tell({ event: 'speed', speed: next, previous: speed });
        speed = next;
        if (speed > 0 && !flight) flight = takeOff().finally(() => (flight = null));
      })
      .catch(() => {});
  }, o.pollMs ?? 200);

  return {
    flying: () => !stopped(),
    answered(text) {
      talkedBack = true;
      void report({ speed, event: 'note', text });
    },
    async stop() {
      stopping = true;
      clearInterval(timer);
      site.off('popup', onPopup);
      if (flight) await Promise.race([flight.catch(() => {}), Bun.sleep(2000)]);
    }
  };
}
