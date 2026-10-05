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
  stop(): Promise<void>;
}

export function startAutopilot(o: { app: ElectronApplication; site: Page; recorder: Recorder | null; pollMs?: number }): Autopilot {
  const { app, site } = o;
  let speed: Speed = 0;
  let stopping = false;
  let flight: Promise<void> | null = null;

  const shell = <T>(name: 'speed' | 'acting' | 'land' | 'report', arg?: unknown) =>
    app.evaluate(
      // The main process's evaluate gets the electron module first, then the argument.
      (_electron, { name, arg }) => (globalThis as unknown as { __artemisAutopilot?: Record<string, (a?: unknown) => unknown> }).__artemisAutopilot?.[name]?.(arg),
      { name, arg }
    ) as Promise<T>;
  const report = (status: Record<string, unknown>) => shell('report', status).catch(() => {});
  const stopped = () => stopping || speed === 0;

  const driver: FlightDriver = {
    url: async () => site.url(),
    links: async () => (await site.evaluate(LINKS)) as Link[],
    async follow(link) {
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
      await site.goBack({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT }).catch(() => {});
    },
    async goTo(url) {
      await site.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    },
    async dwell() {
      const started = Date.now();
      if (speed === 3) {
        await site.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
        return;
      }
      while (!stopped()) {
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
      if (result.ended === 'done') await land({ event: 'done', visited: result.visited.length, pending: 0, etaMs: 0 });
      else if (result.ended === 'stuck') await land({ event: 'stuck', reason: 'too many links in a row went nowhere', visited: result.visited.length });
    } catch (e) {
      if (!stopping) await land({ event: 'stuck', reason: `the site stopped answering (${String((e as Error).message ?? e).split('\n')[0]})` });
    }
  };

  const timer = setInterval(() => {
    if (stopping) return;
    shell<number>('speed')
      .then((s) => {
        speed = (s === 1 || s === 2 || s === 3 ? s : 0) as Speed;
        if (speed > 0 && !flight) flight = takeOff().finally(() => (flight = null));
      })
      .catch(() => {});
  }, o.pollMs ?? 200);

  return {
    async stop() {
      stopping = true;
      clearInterval(timer);
      if (flight) await Promise.race([flight.catch(() => {}), Bun.sleep(2000)]);
    }
  };
}
