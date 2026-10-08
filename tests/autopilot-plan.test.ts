import { describe, expect, test } from 'bun:test';
import { dialogAnswer, fly, linkVerdict, templateKey, type Control, type FlightDriver, type FlightProgress, type Link } from '../server/autopilot';
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
  protected show(url: string) {
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

  test('stopped while it dwells (the operator took the controls): the site stays where it is, no Back', async () => {
    const site = new FakeSite(SHOP, '/');
    let stop = false;
    const dwell = site.dwell.bind(site);
    site.dwell = async () => {
      await dwell();
      stop = true; // the operator clicks during the first page's dwell
    };
    const result = await fly(site, options(site, { stopped: () => stop }));
    expect(result.ended).toBe('stopped');
    expect(site.log).toEqual(['follow /a']);
    expect(new URL(await site.url()).pathname).toBe('/a');
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

/**
 * A menu built on demand, as one-address applications do: only the top level exists at first;
 * opening a control (an in-page link, an expand button) shows its children and hides the others'
 * (an accordion). Links can also sit in the page hidden until their control opens (a dropdown).
 */
interface MenuNode {
  control: Control;
  links?: Link[];
  /** In the page all along, shown only while this control is open. */
  hidden?: Link[];
  children?: MenuNode[];
  /** An in-page-looking control that the site's script turns into a navigation. */
  navigatesTo?: string;
}

class FakeMenuSite extends FakeSite {
  open: string[] = [];
  reveals: string[][] = [];
  constructor(pages: Record<string, FakePage>, public menus: Record<string, MenuNode[]>, start: string) {
    super(pages, start);
  }
  protected show(url: string) {
    super.show(url);
    this.open = [];
  }
  private tree() {
    return this.menus[new URL(this.history[this.index]).pathname] ?? [];
  }
  /** The open nodes, outermost first. */
  private chain(): MenuNode[] {
    const out: MenuNode[] = [];
    let level = this.tree();
    for (const key of this.open) {
      const n = level.find((m) => m.control.key === key);
      if (!n) break;
      out.push(n);
      level = n.children ?? [];
    }
    return out;
  }
  private all(nodes = this.tree()): MenuNode[] {
    return nodes.flatMap((n) => [n, ...this.all(n.children ?? [])]);
  }
  async controls() {
    return [...this.tree(), ...this.chain().flatMap((n) => n.children ?? [])].map((n) => n.control);
  }
  async links() {
    const base = await super.links();
    const shown = this.chain().flatMap((n) => [...(n.links ?? []), ...(n.hidden ?? [])]);
    const hidden = this.all().flatMap((n) => n.hidden ?? []).filter((l) => !shown.includes(l)).map((l) => ({ ...l, visible: false }));
    return [...base, ...shown, ...hidden];
  }
  /** Open the last control of the path; the ones before it are opened first when it is not showing. */
  private async openPath(path: Control[]) {
    for (let i = 0; i < path.length; i++) {
      const visible = (await this.controls()).some((c) => c.key === path[i].key);
      if (!visible) {
        if (i === 0) return false;
        this.open = path.slice(0, i).map((c) => c.key);
        if (!(await this.controls()).some((c) => c.key === path[i].key)) return false;
      }
      const depth = this.open.length;
      // Opening a sibling closes the others at that level.
      const at = this.chain().findIndex((n) => (n.children ?? []).some((m) => m.control.key === path[i].key));
      this.open = [...this.open.slice(0, at + 1), path[i].key];
      void depth;
      const node = this.all().find((n) => n.control.key === path[i].key);
      if (node?.navigatesTo) {
        this.show(at0(node.navigatesTo));
        return true;
      }
    }
    return true;
  }
  async reveal(path: Control[]) {
    this.reveals.push(path.map((c) => c.key));
    this.log.push(`reveal ${path.map((c) => c.key).join(' > ')}`);
    return this.openPath(path);
  }
  async follow(link: Link) {
    const menuLink = this.all().some((n) => [...(n.links ?? []), ...(n.hidden ?? [])].some((l) => l.href === link.href));
    if (menuLink) {
      const showing = (await this.links()).some((l) => l.href === link.href && l.visible !== false);
      if (!showing) {
        if (!link.via?.length || !(await this.openPath(link.via))) return false;
        if (!(await this.links()).some((l) => l.href === link.href && l.visible !== false)) return false;
      }
    }
    return super.follow(link);
  }
}
const at0 = (p: string) => (p.startsWith('http') ? p : `${ORIGIN}${p}`);
const ctl = (key: string, text = key): Control => ({ key, text });

const MENU: MenuNode[] = [
  {
    control: ctl('#Sales', 'Sales'),
    children: [
      { control: ctl('#orders', 'Orders'), links: [a('/App.aspx?comp=OrderEntry&NavLinkID=11', 'Order entry'), ...[1, 2, 3, 4].map((n) => a(`/Mode.aspx?NavLinkID=${n}`, `Mode ${n}`))] },
      { control: ctl('#summaries', 'Summaries'), links: [a('/App.aspx?comp=SalesSummary&NavLinkID=21', 'Sales summary')] }
    ]
  },
  {
    control: ctl('#Purchasing', 'Purchasing'),
    children: [
      {
        control: ctl('#invoices', 'Invoices'),
        links: [a('/App.aspx?comp=Invoices&NavLinkID=31', 'Invoices')],
        children: [{ control: ctl('#archive', 'Archive'), links: [a('/App.aspx?comp=Archive&NavLinkID=32', 'Archive')], children: [{ control: ctl('#older', 'Older'), links: [a('/too-deep', 'Too deep')] }] }]
      }
    ]
  },
  { control: ctl('button#more', 'More'), hidden: [a('/reports', 'Reports')] },
  { control: ctl('button#user', 'Account'), links: [a('/logout', 'Sign out')] },
  { control: ctl('#delete-all', 'Delete all records'), links: [a('/deleted', 'Gone')] },
  { control: ctl('#help', 'Help'), navigatesTo: '/help' }
];
const MENU_SITE: Record<string, FakePage> = {
  '/Welcome.aspx': { links: [a('/Welcome.aspx', 'Home')] },
  '/App.aspx': { links: [a('/Welcome.aspx', 'Home')] },
  '/Mode.aspx': { links: [a('/Welcome.aspx', 'Home')] },
  '/reports': { links: [] },
  '/help': { links: [] },
  '/too-deep': { links: [] }
};
const menus = { '/Welcome.aspx': MENU, '/App.aspx': MENU, '/Mode.aspx': MENU };

describe('menus built on demand', () => {
  test('the menus are unfolded, three levels deep, and every page behind them is visited by clicking the path that shows it (an app whose top level is in-page links)', async () => {
    const site = new FakeMenuSite(MENU_SITE, menus, '/Welcome.aspx');
    const result = await fly(site, options(site));
    expect(result.ended).toBe('done');
    const shown = (u: string) => new URL(u).pathname + new URL(u).search;
    expect(result.visited.map(shown)).toEqual([
      '/help',
      '/reports',
      '/App.aspx?comp=OrderEntry&NavLinkID=11',
      '/Mode.aspx?NavLinkID=1',
      '/Mode.aspx?NavLinkID=2',
      '/Mode.aspx?NavLinkID=3',
      '/Mode.aspx?NavLinkID=4',
      '/App.aspx?comp=SalesSummary&NavLinkID=21',
      '/App.aspx?comp=Invoices&NavLinkID=31',
      '/App.aspx?comp=Archive&NavLinkID=32'
    ]);
    // Never past the third level, never signed out, never a control named delete.
    const paths = site.commits.map((u) => new URL(u).pathname);
    expect(paths).not.toContain('/too-deep');
    expect(paths).not.toContain('/logout');
    expect(paths).not.toContain('/deleted');
    expect(site.reveals.some((p) => p.includes('#delete-all') || p.includes('#older'))).toBe(false);
  });

  test('a menu repeated on every page is unfolded once per flight, not on each page', async () => {
    const site = new FakeMenuSite(MENU_SITE, menus, '/Welcome.aspx');
    await fly(site, options(site));
    const opened = site.reveals.map((p) => p.at(-1));
    expect(new Set(opened).size).toBe(opened.length);
    expect(opened.sort()).toEqual(['#Purchasing', '#Sales', '#archive', '#help', '#invoices', '#orders', '#summaries', 'button#more', 'button#user'].sort());
  });

  test('a page whose only links are behind its menu is still explored when the flight reaches it', async () => {
    const site = new FakeMenuSite(
      { '/': { links: [a('/app', 'App')] }, '/app': { links: [] }, '/app/one': { links: [] } },
      { '/app': [{ control: ctl('#tools', 'Tools'), links: [a('/app/one', 'One')] }] },
      '/'
    );
    const result = await fly(site, options(site));
    expect(result.visited.map((u) => new URL(u).pathname)).toEqual(['/app', '/app/one']);
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

  test('pages of one kind by their query too: id-like values (numbers, dates, long tokens) stand for any, other values name the page, tracking parameters are ignored', () => {
    expect(templateKey(at('/product?id=12'))).toBe(templateKey(at('/product?id=9876')));
    expect(templateKey(at('/report?day=2026-10-08'))).toBe(templateKey(at('/report?day=2026-10-09')));
    expect(templateKey(at('/view?t=Zm9vYmFyYmF6cXV4cXV1eHh5enp6eg'))).toBe(templateKey(at('/view?t=YWJjZGVmZ2hpamtsbW5vcHFyc3R1dg')));
    expect(templateKey(at('/App.aspx?comp=SalesSummary&NavLinkID=21'))).not.toBe(templateKey(at('/App.aspx?comp=OrderEntry&NavLinkID=11')));
    expect(templateKey(at('/App.aspx?NavLinkID=11&comp=OrderEntry'))).toBe(templateKey(at('/App.aspx?comp=OrderEntry&NavLinkID=12')));
    expect(templateKey(at('/about?utm_source=mail'))).toBe(templateKey(at('/about')));
  });

  test('a link to the same path with another query is another page to follow; the same query in another order, or with tracking added, is this page', () => {
    const page = at('/App.aspx?comp=SalesSummary&NavLinkID=21');
    const v = (href: string) => linkVerdict({ href: at(href), text: '' }, page, 'shop.example');
    expect(v('/App.aspx?comp=OrderEntry&NavLinkID=11')).toBe('follow');
    expect(v('/App.aspx?NavLinkID=21&comp=SalesSummary')).toBe('this page');
    expect(v('/App.aspx?comp=SalesSummary&NavLinkID=21&utm_campaign=x#top')).toBe('this page');
  });

  test('the screens of a one-address application are all visited: App.aspx?comp=A, ?comp=B and ?comp=C are three pages, not one', async () => {
    const site = new FakeSite(
      { '/': { links: [a('/App.aspx?comp=A&NavLinkID=1'), a('/App.aspx?comp=B&NavLinkID=2'), a('/App.aspx?comp=C&NavLinkID=3')] }, '/App.aspx': { links: [a('/')] } },
      '/'
    );
    const result = await fly(site, options(site));
    expect(result.visited.map((u) => new URL(u).search)).toEqual(['?comp=A&NavLinkID=1', '?comp=B&NavLinkID=2', '?comp=C&NavLinkID=3']);
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

  test('the site\'s dialogs while it flies: OK to an alert, Leave to leave-this-page, Cancel to a confirm or a prompt (it never deletes)', () => {
    expect(['alert', 'beforeunload', 'confirm', 'prompt', 'something-new'].map(dialogAnswer)).toEqual(['accept', 'accept', 'dismiss', 'dismiss', 'dismiss']);
  });
});
