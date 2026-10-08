// The autopilot's flight plan (the user's notes, with the yoke sketch): explore the site on its
// own, without a language model, the way the cosmos draws it best.
//
// - Branch by branch: from a page, open each of its links in turn and come back to it before the
//   next (Back, or its address when Back lands elsewhere). Each new page is then reached from the
//   page that links to it, so the cosmos grows as a tree around the core, not as one long line.
//   Pages are expanded in the order they were found: the core's sections first, then theirs.
// - Never repeat what is in the cosmos: pages already recorded are not visited again (their links
//   are still explored); a page's links are read while it is visited, so a page with nothing new
//   is never gone back to.
// - Two or three pages of each kind (product 1, 2, 3, not every product), by address template.
// - Menus built on demand are unfolded first: in-page links and closed expand buttons, up to three
//   levels, each once per flight (a menu repeated on every page is unfolded once). A link they
//   reveal is opened by clicking the same path, as a person would, and is never sampled away: a
//   menu lists features, not items.
// - Safe: links and menu controls only (no forms), inside the review scope, never sign-out,
//   delete, unsubscribe.
// - Never stuck: a link that goes nowhere, a redirect out of the scope, a Back that does not
//   return, loops: each is passed and noted; too many failures in a row end the flight.
//
// Pure logic over a FlightDriver; server/autopilot-driver.ts drives the owned browser's site page.
// Choices made here steer navigation only: nothing is stored as a category.

import { inScope, pageKeyOf, pageQuery } from '../src/scope';

export interface Link {
  href: string;
  text: string;
  /** False when the link is in the page but not showing (a closed dropdown). */
  visible?: boolean;
  /** The menu controls to open, in order, for this link to show. */
  via?: Control[];
}

/** An in-page control that may show more links: an in-page link, a closed expand button. */
export interface Control {
  /** Tells the control apart on its page (its id, or what it is and says). */
  key: string;
  text: string;
}

export interface FlightDriver {
  /** The address the site is on. */
  url(): Promise<string>;
  /** The links on the current page, in page order. */
  links(): Promise<Link[]>;
  /** Click the link on the current page; false when nothing happened. */
  follow(link: Link): Promise<boolean>;
  back(): Promise<void>;
  goTo(url: string): Promise<void>;
  /** Stay on the page as long as the speed asks (scrolling at the slow speed). */
  dwell(): Promise<void>;
  /** The menu controls showing on the current page. */
  controls?(): Promise<Control[]>;
  /** Open the last control of the path, opening the ones before it first when it is not showing. */
  reveal?(path: Control[]): Promise<boolean>;
}

export interface FlightProgress {
  visited: number;
  /** Pages found and not yet visited. */
  pending: number;
  /** Time left for the pages found so far, from the flight's measured pace. */
  etaMs: number;
  url: string;
}

export type Verdict = 'follow' | 'this page' | 'unsafe' | 'not a page' | 'outside the scope';
export type SkipReason = Exclude<Verdict, 'follow'> | 'sampled' | 'went nowhere' | 'left the scope' | 'failed';

export interface FlightResult {
  visited: string[];
  skipped: { href: string; why: SkipReason }[];
  ended: 'done' | 'stopped' | 'stuck';
}

export interface FlightOptions {
  scopeHost: string;
  /** Page addresses already in the cosmos: never visited again. */
  known: Iterable<string>;
  /** Recorded pages whose links are explored after the current page's, in recording order. */
  hubs?: string[];
  /** Pages of one kind to visit (by address template). */
  perTemplate?: number;
  stopped: () => boolean;
  now?: () => number;
  /** Time a page takes at the current speed, until the flight has measured its own pace. */
  estimateMs?: () => number;
  onProgress?: (p: FlightProgress) => void;
  /** Failures in a row that end the flight as stuck. */
  maxFailures?: number;
  /** Menu levels unfolded (3) and menu controls opened on one page at most (80). */
  menuDepth?: number;
  maxReveals?: number;
}

const FILE = /\.(pdf|zip|gz|tgz|tar|rar|7z|dmg|exe|msi|pkg|apk|iso|png|jpe?g|gif|webp|svg|ico|mp4|mp3|wav|mov|avi|webm|docx?|xlsx?|pptx?|csv|json|xml|txt)$/i;
const UNSAFE_TEXT = /\b(log\s?-?out|sign\s?-?out|log\s?-?off|sign\s?-?off|delete|remove|unsubscribe|deactivate|destroy|cancel\s+(my\s+)?(account|subscription|membership))\b/i;
const UNSAFE_PATH = /(log-?out|sign-?out|log-?off|sign-?off|delete|destroy|unsubscribe|deactivate)/i;

const parse = (href: string): URL | null => {
  try {
    return new URL(href);
  } catch {
    return null;
  }
};

export const keyOf = (href: string): string => {
  const u = parse(href);
  return u ? pageKeyOf(u) : href;
};

/** An id: a number, a uuid, long hex, a short code with digits, a date, or a long token with digits in it. */
const isId = (s: string) =>
  /^\d+$/.test(s) ||
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ||
  /^[0-9a-f]{12,}$/i.test(s) ||
  /^[a-z]{1,3}[-_]?\d{2,}$/i.test(s) ||
  /^\d{4}-\d{2}-\d{2}/.test(s) ||
  (s.length >= 24 && /\d/.test(s) && /[a-z]/i.test(s) && /^[\w\-+/=.%]+$/.test(s));

/**
 * Pages of one kind share a template: path segments and query values that are ids stand for any;
 * other query values name the page (App.aspx?comp=Orders is not App.aspx?comp=Invoices).
 */
export function templateKey(href: string): string {
  const u = parse(href);
  if (!u) return href;
  const path = u.pathname
    .split('/')
    .map((seg) => (seg && isId(seg) ? ':id' : seg))
    .join('/');
  const query = pageQuery(u)
    .map(([k, v]) => `${k}=${isId(v) ? ':id' : v}`)
    .sort()
    .join('&');
  return `${u.origin}${path}${query ? `?${query}` : ''}`;
}

/**
 * How the autopilot answers a dialog the site opens while it flies: OK to an alert, Leave to a
 * leave-this-page question, Cancel to anything that asks to confirm or to type (it never deletes,
 * never signs out, never submits). The operator's own dialogs are never answered for them.
 */
export const dialogAnswer = (type: string): 'accept' | 'dismiss' => (type === 'alert' || type === 'beforeunload' ? 'accept' : 'dismiss');

export function linkVerdict(link: Link, pageUrl: string, scopeHost: string): Verdict {
  const u = parse(link.href);
  if (!u || !/^https?:$/.test(u.protocol)) return 'not a page';
  if (FILE.test(u.pathname)) return 'not a page';
  if (!inScope(u.hostname, scopeHost)) return 'outside the scope';
  if (pageKeyOf(u) === keyOf(pageUrl)) return 'this page';
  if (UNSAFE_TEXT.test(link.text) || UNSAFE_PATH.test(u.pathname)) return 'unsafe';
  return 'follow';
}

interface Hub {
  url: string;
  key: string;
  /** Read while the page was visited; null until then. */
  links: Link[] | null;
  controls: Control[] | null;
}

export async function fly(driver: FlightDriver, o: FlightOptions): Promise<FlightResult> {
  const now = o.now ?? Date.now;
  const perTemplate = o.perTemplate ?? 3;
  const maxFailures = o.maxFailures ?? 25;
  const menuDepth = o.menuDepth ?? 3;
  const maxReveals = o.maxReveals ?? 80;
  const visitedKeys = new Set<string>([...o.known].map(keyOf));
  const templates = new Map<string, number>();
  for (const k of visitedKeys) templates.set(templateKey(k), (templates.get(templateKey(k)) ?? 0) + 1);
  const frontier = new Set<string>();
  const skippedKeys = new Set<string>();
  /** Menu controls opened on this flight, on any page. */
  const unfolded = new Set<string>();
  const result: FlightResult = { visited: [], skipped: [], ended: 'done' };
  const started = now();
  let failures = 0;
  let stopped = false;

  const start = await driver.url();
  visitedKeys.add(keyOf(start));
  const queue: Hub[] = [{ url: start, key: keyOf(start), links: null, controls: null }];
  for (const h of o.hubs ?? []) if (keyOf(h) !== keyOf(start)) queue.push({ url: h, key: keyOf(h), links: null, controls: null });

  const skip = (href: string, why: SkipReason) => {
    const k = keyOf(href);
    frontier.delete(k);
    if (skippedKeys.has(`${k} ${why}`)) return;
    skippedKeys.add(`${k} ${why}`);
    result.skipped.push({ href, why });
  };
  // A menu lists features, not items: what it reveals is never sampled away.
  const sampledAway = (link: Link) => !link.via?.length && (templates.get(templateKey(link.href)) ?? 0) >= perTemplate;
  const freshControls = (cs: Control[]) => cs.filter((c) => !unfolded.has(c.key) && !UNSAFE_TEXT.test(c.text));

  /** The links worth following from a page, one per page, in page order. */
  const candidates = (links: Link[], pageUrl: string, note: boolean): Link[] => {
    const seen = new Set<string>();
    const out: Link[] = [];
    for (const link of links) {
      const verdict = linkVerdict(link, pageUrl, o.scopeHost);
      if (verdict !== 'follow') {
        if (note) skip(link.href, verdict);
        continue;
      }
      const k = keyOf(link.href);
      if (visitedKeys.has(k) || seen.has(k) || [...skippedKeys].some((s) => s.startsWith(`${k} `))) continue;
      seen.add(k);
      out.push(link);
    }
    return out;
  };

  const report = (url: string) => {
    const pending = frontier.size;
    const pace = result.visited.length ? (now() - started) / result.visited.length : (o.estimateMs?.() ?? 0);
    o.onProgress?.({ visited: result.visited.length, pending, etaMs: Math.round(pending * pace), url });
  };

  /** Back to the hub: Back first, its address when Back lands elsewhere. */
  const returnTo = async (hub: Hub) => {
    await driver.back().catch(() => {});
    if (keyOf(await driver.url()) !== hub.key) await driver.goTo(hub.url);
  };

  /**
   * Arrived somewhere from the hub (a link followed, or a menu control that navigated): a new page
   * in the scope is counted, looked at, read and queued; then the hub is returned to.
   */
  const arrived = async (hub: Hub, landed: string, linkKey: string | null, href: string) => {
    const landedKey = keyOf(landed);
    const lu = parse(landed);
    if (!lu || !inScope(lu.hostname, o.scopeHost)) {
      skip(href, 'left the scope');
      failures++;
      await returnTo(hub);
      return;
    }
    const alreadyKnown = landedKey !== linkKey && visitedKeys.has(landedKey);
    if (linkKey) {
      visitedKeys.add(linkKey);
      frontier.delete(linkKey);
    }
    if (alreadyKnown) {
      // Redirected to a page the cosmos already has (a sign-in wall, a canonical address).
      await returnTo(hub);
      return;
    }
    visitedKeys.add(landedKey);
    frontier.delete(landedKey);
    templates.set(templateKey(landed), (templates.get(templateKey(landed)) ?? 0) + 1);
    failures = 0;
    result.visited.push(landed);
    await driver.dwell().catch(() => {});
    // Stopped while it looked (the operator took the controls): the site stays where it is.
    if (o.stopped()) {
      stopped = true;
      return;
    }
    const found = await driver.links().catch(() => [] as Link[]);
    const controls = (await driver.controls?.().catch(() => [] as Control[])) ?? [];
    for (const l of candidates(found, landed, false)) if (!sampledAway(l)) frontier.add(keyOf(l.href));
    queue.push({ url: landed, key: landedKey, links: found, controls });
    await returnTo(hub);
    report(landed);
  };

  /**
   * Unfold the hub's menus (breadth first, `menuDepth` levels, each control once per flight): the
   * links they show join the page's, with the path that shows them.
   */
  const unfold = async (hub: Hub, links: Link[]): Promise<Link[]> => {
    if (!driver.controls || !driver.reveal) return links;
    const out = links.map((l) => ({ ...l }));
    const byHref = new Map(out.map((l) => [l.href, l]));
    const paths: Control[][] = freshControls(await driver.controls().catch(() => [])).map((c) => [c]);
    let opened = 0;
    while (paths.length && opened < maxReveals) {
      if (o.stopped()) {
        stopped = true;
        return out;
      }
      const path = paths.shift()!;
      const last = path[path.length - 1];
      if (unfolded.has(last.key)) continue;
      unfolded.add(last.key);
      opened++;
      const ok = await driver.reveal(path).catch(() => false);
      const here = await driver.url();
      if (keyOf(here) !== hub.key) {
        // Not a menu: the site's script made it a navigation. A page reached from this one.
        await arrived(hub, here, null, here);
        if (stopped) return out;
        continue;
      }
      if (!ok) continue;
      for (const l of await driver.links().catch(() => [] as Link[])) {
        const had = byHref.get(l.href);
        if (!had) {
          const shown = { ...l, via: path };
          out.push(shown);
          byHref.set(l.href, shown);
        } else if (had.visible === false && l.visible !== false && !had.via) {
          had.via = path;
        }
      }
      if (path.length < menuDepth) {
        for (const c of freshControls(await driver.controls().catch(() => []))) if (!path.some((p) => p.key === c.key)) paths.push([...path, c]);
      }
    }
    return out;
  };

  while (queue.length) {
    if (o.stopped()) return { ...result, ended: 'stopped' };
    const hub = queue.shift()!;
    // A page visited on this flight has its links read already: nothing new there, no trip back.
    if (hub.links && !candidates(hub.links, hub.url, false).length && !freshControls(hub.controls ?? []).length) continue;
    try {
      if (keyOf(await driver.url()) !== hub.key) await driver.goTo(hub.url);
    } catch {
      failures++;
      continue;
    }
    const read = await unfold(hub, await driver.links().catch(() => [] as Link[]));
    if (stopped) return { ...result, ended: 'stopped' };
    const links = candidates(read, hub.url, true);
    for (const l of links) frontier.add(keyOf(l.href));

    for (const link of links) {
      if (o.stopped()) return { ...result, ended: 'stopped' };
      if (failures >= maxFailures) return { ...result, ended: 'stuck' };
      const k = keyOf(link.href);
      if (visitedKeys.has(k)) {
        frontier.delete(k);
        continue;
      }
      if (sampledAway(link)) {
        skip(link.href, 'sampled');
        continue;
      }
      let moved = false;
      try {
        moved = await driver.follow(link);
      } catch {
        moved = false;
      }
      const landed = moved ? await driver.url() : hub.url;
      if (!moved || keyOf(landed) === hub.key) {
        skip(link.href, 'went nowhere');
        failures++;
        continue;
      }
      await arrived(hub, landed, k, link.href);
      if (stopped) return { ...result, ended: 'stopped' };
    }
  }
  return result;
}
