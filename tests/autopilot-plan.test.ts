import { describe, expect, test } from 'bun:test';
import { fly, linkVerdict, templateKey, type FlightDriver, type FlightProgress, type Link } from '../server/autopilot';
import { applySiteEvents, emptySiteModel } from '../src/site-model';
import type { SiteEvent } from '../src/site-events';

// The autopilot's flight plan (the user's notes): branch by branch, opening each link of a page
// and coming back to it before the next, so the cosmos grows as a tree around the core and not as
// a single long line; never repeating what is already in the cosmos; two or three pages of each
// kind; never getting stuck. Pure logic over a driver; the owned browser's driver clicks for real.

const ORIGIN = 'https://shop.example';
const at = (path: string) => (path.startsWith('http') ? path : `${ORIGIN}${path}`);
const a = (href: string, text = href): Link => ({ href: at(href), text });

interface FakePage {
  links: Link[];
  /** Following a link here lands somewhere else. */
  redirect?: string;
}

/** A website with a browser's history: follow pushes, back pops, goTo pushes. */
class FakeSite implements FlightDriver {
  history: string[];
  index = 0;
  clock = 0;
  log: string[] = [];
  /** Every page the browser showed, in order (what the recorder would commit). */
  commits: string[];
  dead = new Set<string>();
  /** Back from these pages lands somewhere unrelated (a sign-in wall) instead of where it came from. */
  breaksBack = new Set<string>();
  constructor(public pages: Record<string, FakePage>, start: string, public stepMs = { follow: 400, dwell: 500, back: 100 }) {
    this.history = [at(start)];
    this.commits = [at(start)];
  }
  private show(url: string) {
    this.history = this.history.slice(0, this.index + 1);
    this.history.push(url);
    this.index = this.history.length - 1;
    this.commits.push(url);
  }
  async url() {
    return this.history[this.index];
  }
  async links() {
    const u = new URL(this.history[this.index]);
    return this.pages[`${u.origin}${u.pathname}`]?.links ?? this.pages[u.pathname]?.links ?? [];
  }
  async follow(link: Link) {
    this.clock += this.stepMs.follow;
    this.log.push(`follow ${new URL(link.href).pathname}`);
    if (this.dead.has(link.href)) return false;
    const key = new URL(link.href).pathname;
    this.show(this.pages[key]?.redirect ?? link.href);
    return true;
  }
  async back() {
    this.clock += this.stepMs.back;
    this.log.push('back');
    const from = new URL(this.history[this.index]).pathname;
    if (this.breaksBack.has(from)) return this.show(at('/sign-in-wall'));
    if (this.index > 0) {
      this.index--;
      this.commits.push(this.history[this.index]);
    }
  }
  async goTo(url: string) {
    this.clock += this.stepMs.follow;
    this.log.push(`goto ${new URL(url).pathname}`);
    this.show(url);
  }
  async dwell() {
    this.clock += this.stepMs.dwell;
  }
}

/** What the cosmos makes of the flight: every page's parent, by path. */
function cosmosParents(commits: string[], scopeHost = 'shop.example'): Record<string, string | null> {
  const m = emptySiteModel();
  const events: SiteEvent[] = [{ type: 'session', target: commits[0], scopeHost }];
  commits.forEach((url, i) => {
    events.push({ type: 'visit', id: i + 1, t: i, url, kind: 'document', committed: false }, { type: 'commit', id: i + 1, url });
  });
  applySiteEvents(m, events);
  const label = (n: number | null) => (n === null ? null : new URL(m.nodes[n].key).pathname);
  return Object.fromEntries(m.nodes.filter((n) => n.kind === 'page').map((n) => [new URL(n.key).pathname, label(n.parent)]));
}

const SHOP: Record<string, FakePage> = {
  '/': { links: [a('/a'), a('/b'), a('/c')] },
  '/a': { links: [a('/a/1'), a('/a/2'), a('/')] },
  '/b': { links: [a('/b/1'), a('/a')] },
  '/c': { links: [a('/a'), a('/c/1')] },
  '/a/1': { links: [a('/')] },
  '/a/2': { links: [] },
  '/b/1': { links: [a('/b')] },
  '/c/1': { links: [] }
};

const options = (site: FakeSite, more: Partial<Parameters<typeof fly>[1]> = {}) => ({
  scopeHost: 'shop.example',
  known: [] as string[],
  stopped: () => false,
  now: () => site.clock,
  estimateMs: () => 1000,
  ...more
});

describe('the flight plan', () => {
  test('branch by branch: each link opened and the page returned to before the next; sections first, then their pages; the cosmos is a tree around the core', async () => {
    const site = new FakeSite(SHOP, '/');
    const result = await fly(site, options(site));
    expect(result.ended).toBe('done');
    expect(result.visited.map((u) => new URL(u).pathname)).toEqual(['/a', '/b', '/c', '/a/1', '/a/2', '/b/1', '/c/1']);
    expect(site.log).toEqual([
      'follow /a', 'back', 'follow /b', 'back', 'follow /c', 'back',
      'goto /a', 'follow /a/1', 'back', 'follow /a/2', 'back',
      'goto /b', 'follow /b/1', 'back',
      'goto /c', 'follow /c/1', 'back'
    ]);
    // Not a single long line: the core holds the three sections, each its own pages.
    expect(cosmosParents(site.commits)).toEqual({ '/': null, '/a': '/', '/b': '/', '/c': '/', '/a/1': '/a', '/a/2': '/a', '/b/1': '/b', '/c/1': '/c' });
  });

  test('never repeats what is in the cosmos: recorded pages are not visited again, but their links are explored', async () => {
    const site = new FakeSite(SHOP, '/');
    const result = await fly(site, options(site, { known: [at('/'), at('/a')], hubs: [at('/a')] }));
    const paths = result.visited.map((u) => new URL(u).pathname);
    expect(paths).not.toContain('/a');
    expect(paths).toEqual(['/b', '/c', '/a/1', '/a/2', '/b/1', '/c/1']);
    expect(site.log).not.toContain('follow /a');
  });

  test('two or three pages of each kind: nine products, three visited, the rest sampled away', async () => {
    const products = Array.from({ length: 9 }, (_, i) => a(`/product/${i + 1}`));
    const site = new FakeSite({ '/': { links: [...products, a('/about')] } }, '/');
    const result = await fly(site, options(site));
    expect(result.visited.map((u) => new URL(u).pathname)).toEqual(['/product/1', '/product/2', '/product/3', '/about']);
    expect(result.skipped.filter((s) => s.why === 'sampled')).toHaveLength(6);
  });

  test('safe and in scope: sign-out, delete, mail, phone, scripts, files, other hosts and same-page anchors are never followed; subdomains are', async () => {
    const site = new FakeSite(
      {
        '/': {
          links: [
            a('/logout', 'Sign out'),
            a('/session/end', 'Log out'),
            a('/account/delete', 'Delete account'),
            { href: 'mailto:hi@shop.example', text: 'Mail us' },
            { href: 'tel:+15551234', text: 'Call' },
            { href: 'javascript:void(0)', text: 'Menu' },
            a('/report.pdf', 'Annual report'),
            a('https://other.example/', 'Partner'),
            a('/#top', 'Top'),
            a('/about#team', 'Team'),
            a('/about', 'About'),
            a('https://blog.shop.example/', 'Blog')
          ]
        },
        '/about': { links: [] }
      },
      '/'
    );
    const result = await fly(site, options(site));
    expect(result.visited).toEqual([at('/about#team'), 'https://blog.shop.example/']);
    const why = Object.fromEntries(result.skipped.map((s) => [s.href, s.why]));
    expect(why).toMatchObject({
      [at('/logout')]: 'unsafe',
      [at('/session/end')]: 'unsafe',
      [at('/account/delete')]: 'unsafe',
      'mailto:hi@shop.example': 'not a page',
      'tel:+15551234': 'not a page',
      'javascript:void(0)': 'not a page',
      [at('/report.pdf')]: 'not a page',
      'https://other.example/': 'outside the scope',
      [at('/#top')]: 'this page'
    });
  });

  test('never stuck: a dead link, a redirect out of the scope, a back that goes elsewhere and a loop are all passed', async () => {
    const site = new FakeSite(
      {
        '/': { links: [a('/dead'), a('/away'), a('/lost'), a('/loop1'), a('/end')] },
        '/away': { links: [], redirect: 'https://evil.example/' },
        '/lost': { links: [] },
        '/loop1': { links: [a('/loop2')] },
        '/loop2': { links: [a('/loop1')] },
        '/end': { links: [] }
      },
      '/'
    );
    site.dead.add(at('/dead'));
    site.breaksBack.add('/lost');
    const result = await fly(site, options(site));
    expect(result.ended).toBe('done');
    expect(result.visited.map((u) => new URL(u).pathname)).toEqual(['/lost', '/loop1', '/end', '/loop2']);
    const why = Object.fromEntries(result.skipped.map((s) => [new URL(s.href).pathname, s.why]));
    expect(why).toMatchObject({ '/dead': 'went nowhere', '/away': 'left the scope' });
    // The hub is found again by address when Back does not return to it.
    expect(site.log.slice(site.log.indexOf('follow /lost'), site.log.indexOf('follow /lost') + 3)).toEqual(['follow /lost', 'back', 'goto /']);
  });

  test('the stop flag ends the flight between steps', async () => {
    const site = new FakeSite(SHOP, '/');
    let visits = 0;
    const result = await fly(site, options(site, { stopped: () => visits >= 2, onProgress: () => void visits++ }));
    expect(result.ended).toBe('stopped');
    expect(result.visited).toHaveLength(2);
  });

  test('progress: pages visited, pages known and not yet visited, and time left from the measured steps', async () => {
    const site = new FakeSite(SHOP, '/');
    const seen: FlightProgress[] = [];
    await fly(site, options(site, { onProgress: (p) => void seen.push(p) }));
    // After /a: /b and /c known on the core, /a/1 and /a/2 found on /a.
    expect(seen[0]).toMatchObject({ visited: 1, pending: 4, url: at('/a') });
    // One step (follow 400 + dwell 500 + back 100) measured: 1000 ms a page.
    expect(seen[0].etaMs).toBe(4000);
    expect(seen.at(-1)).toMatchObject({ visited: 7, pending: 0, etaMs: 0 });
  });
});

describe('the rules the plan follows', () => {
  test('pages of one kind share a template: numbers, long hex and uuids stand for any', () => {
    expect(templateKey(at('/product/12'))).toBe(templateKey(at('/product/9876')));
    expect(templateKey(at('/u/3f2a9c1e5b7d4a60/orders'))).toBe(templateKey(at('/u/9a8b7c6d5e4f3a21/orders')));
    expect(templateKey(at('/o/123e4567-e89b-12d3-a456-426614174000'))).toBe(templateKey(at('/o/00000000-0000-0000-0000-000000000000')));
    expect(templateKey(at('/about'))).not.toBe(templateKey(at('/contact')));
    expect(templateKey(at('/blog/refactoring-hermes'))).not.toBe(templateKey(at('/blog/autopilot-notes')));
  });

  test('link verdicts', () => {
    const page = at('/catalog');
    const v = (href: string, text = '') => linkVerdict({ href, text }, page, 'shop.example');
    expect(v(at('/cart'))).toBe('follow');
    expect(v('https://cdn.shop.example/x')).toBe('follow');
    expect(v(at('/catalog#filters'))).toBe('this page');
    expect(v(at('/signout'))).toBe('unsafe');
    expect(v(at('/x'), 'Unsubscribe')).toBe('unsafe');
    expect(v(at('/manual.zip'))).toBe('not a page');
    expect(v('https://elsewhere.example/')).toBe('outside the scope');
  });
});
