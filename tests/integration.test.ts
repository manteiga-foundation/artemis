import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, type Browser, type Page } from 'playwright';

// Isolated Vite dev server on a free port, driven by a real (headless, GPU-enabled) Chromium.
const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('reserve') });
const port = reservation.port!;
reservation.stop(true);
let browser: Browser;
let vite: ReturnType<typeof Bun.spawn>;

beforeAll(async () => {
  vite = Bun.spawn(['bun', 'run', 'dev', '--port', String(port), '--strictPort'], {
    cwd: import.meta.dir + '/..',
    stdout: 'ignore',
    stderr: 'ignore'
  });
  let ready = false;
  for (let i = 0; i < 150; i++) {
    if (await fetch(`http://127.0.0.1:${port}`).then((r) => r.ok).catch(() => false)) {
      ready = true;
      break;
    }
    await Bun.sleep(100);
  }
  expect(ready).toBe(true);
  browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
}, 30000);

afterAll(async () => {
  await browser?.close();
  vite?.kill();
});

const cssVar = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.querySelector('.app')!).getPropertyValue(n).trim(), name);
const stateOf = (page: Page) => page.evaluate('window.__artemis()');

async function engaged(reducedMotion = false): Promise<{ page: Page; errors: string[] }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
  await page.waitForFunction('typeof window.__artemis === "function"');
  await page.getByRole('textbox', { name: 'Web App' }).fill('example.com');
  await page.getByRole('button', { name: 'Engage', exact: true }).click();
  await page.waitForFunction('window.__artemis().engaged === true');
  // Arwes staggers the HUD in with visibility:hidden; wait for the card to be usable.
  await visible(page, 'View (V)');
  return { page, errors };
}

/** Waits for a command button to be visible (Arwes hides it until its enter animation starts). */
const visible = (page: Page, name: string) => page.getByRole('button', { name }).waitFor({ state: 'visible', timeout: 5000 });
/** Counts elements regardless of animation visibility. */
const anyCount = (page: Page, role: 'button' | 'tablist', name: string) => page.getByRole(role, { name, includeHidden: true }).count();

/** The selected node's label: its text and where it sits relative to the stage centre (px). */
const selectedLabel = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.hub-label.is-selected');
    const stage = document.querySelector('.graph-layer')!.getBoundingClientRect();
    if (!el) return null;
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(el.style.transform);
    return {
      text: el.textContent,
      dx: m ? Number(m[1]) - stage.width / 2 : NaN,
      dy: m ? Number(m[2]) - stage.height / 2 : NaN
    };
  });
const zoomReadout = (page: Page) => page.evaluate(() => Number(document.querySelector('.minimap .panel-title-right')?.textContent?.slice(1)));

test('after engaging, the console is in the browser view; V pulls back to the cosmos and returns; the Page view is hidden', async () => {
  const { page, errors } = await engaged();
  try {
    expect(await page.getAttribute('.app', 'data-view')).toBe('browser');
    expect(await cssVar(page, '--base')).toBe('#005d2c');
    expect(await page.locator('.browser-surface').count()).toBe(1);
    expect(await anyCount(page, 'button', 'Annotate (A)')).toBe(1);
    expect(await anyCount(page, 'button', 'Vision (V)')).toBe(0);
    expect(await anyCount(page, 'tablist', 'Lenses')).toBe(0);
    expect(await page.locator('.graph-layer').isVisible()).toBe(false);

    await page.keyboard.press('v');
    await page.waitForFunction('window.__artemis().view === "cosmos"');
    expect(await page.getAttribute('.app', 'data-view')).toBe('cosmos');
    await page.waitForFunction('window.__artemis().viewTransition === null', { timeout: 4000 });
    expect(await cssVar(page, '--base')).toBe('#1034a6');
    await visible(page, 'Disperse (D)');
    expect(await anyCount(page, 'button', 'Depth (D)')).toBe(0);
    expect(await anyCount(page, 'tablist', 'Lenses')).toBe(1);
    expect(await page.locator('.hud-header').textContent()).toContain('COSMOS');
    expect(await page.locator('.hud-header').textContent()).not.toContain('PAGE');
    expect(await page.locator('.graph-layer').isVisible()).toBe(true);
    expect(await page.locator('.browser-surface').count()).toBe(0);

    await page.keyboard.press('v');
    await page.waitForFunction('window.__artemis().view === "browser"');
    await page.waitForFunction('window.__artemis().viewTransition === null', { timeout: 4000 });
    expect(await cssVar(page, '--base')).toBe('#005d2c');
    expect(await page.locator('.browser-surface').count()).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await page.context().close();
  }
}, 40000);

test('pulling back from the browser opens the cosmos on the current page: selected, labelled, centred and zoomed in, and it stays there', async () => {
  const { page, errors } = await engaged();
  try {
    const before = await zoomReadout(page);
    // Pressed at once, while the first layout is still unfolding and wants to frame itself.
    await page.keyboard.press('v');
    await page.waitForFunction('window.__artemis().view === "cosmos" && window.__artemis().viewTransition === null', { timeout: 4000 });
    const s = (await stateOf(page)) as { selected: number; currentPage: number; status: string };
    expect(s.selected).toBe(s.currentPage);

    // The camera settles on the page: well past the whole-network fit, the page at the centre.
    await page.waitForFunction(() => Number(document.querySelector('.minimap .panel-title-right')?.textContent?.slice(1)) >= 3.9, null, { timeout: 4000 });
    expect(await zoomReadout(page)).toBeGreaterThan(before * 2);
    await page.waitForTimeout(400);
    const label = (await selectedLabel(page))!;
    expect(label).not.toBeNull();
    expect(s.status).toContain(label.text!);
    expect(await page.locator('.hub-label.is-selected .hub-text').isVisible()).toBe(true);
    expect(Math.abs(label.dx)).toBeLessThan(80);
    expect(Math.abs(label.dy)).toBeLessThan(80);

    // The console readout names the page as the selection.
    expect(await page.locator('.console-readout').textContent()).toContain(label.text!);

    // The layout keeps settling; its framing must not take the camera off the page.
    await page.waitForTimeout(3000);
    expect(await zoomReadout(page)).toBeGreaterThanOrEqual(3.9);
    const still = (await selectedLabel(page))!;
    expect(Math.abs(still.dx)).toBeLessThan(80);
    expect(Math.abs(still.dy)).toBeLessThan(80);
    expect(errors).toEqual([]);
  } finally {
    await page.context().close();
  }
}, 40000);

// The recorder's events, as the owned browser's feed delivers them (src/site-events.ts).
const S = 'http://shop.example';
const recorded = (from: number, pages: string[]) =>
  pages.flatMap((path, i) => {
    const id = from + i;
    return [
      { type: 'visit', id, t: id, url: `${S}${path}`, kind: 'document', committed: true },
      { type: 'request', id: id * 10, visitId: id, method: 'GET', url: `${S}/api${path}`, resourceType: 'fetch', mainDocument: false },
      { type: 'request', id: id * 10 + 1, visitId: id, method: 'GET', url: 'https://maps.googleapis.com/js', resourceType: 'script', mainDocument: false }
    ];
  });
const feed = (page: Page, events: unknown[]) =>
  page.evaluate((events) => dispatchEvent(new CustomEvent('artemis:site', { detail: events })), events);

test('the recorded cosmos grows live from the feed; V lands on the current page; Scope hides other hosts', async () => {
  const { page, errors } = await engaged();
  try {
    await page.waitForFunction('window.__artemisSiteFeed === true');
    await feed(page, [{ type: 'reset' }, { type: 'session', target: `${S}/`, scopeHost: 'shop.example' }, ...recorded(1, ['/', '/contact'])]);
    await page.waitForFunction('window.__artemis().recorded === true');
    // pages /, /contact; endpoints /api/, /api/contact; one shared maps service
    expect(await stateOf(page)).toMatchObject({ nodeCount: 5 });

    await page.keyboard.press('v');
    await page.waitForFunction('window.__artemis().view === "cosmos" && window.__artemis().viewTransition === null', { timeout: 4000 });
    expect(((await stateOf(page)) as { status: string }).status).toBe('View: Cosmos. Current page /contact selected.');
    await page.waitForTimeout(600);
    expect((await selectedLabel(page))?.text).toBe('/contact');
    // Pages are labelled as they appear.
    expect(await page.locator('.hub-label .hub-text').allTextContents()).toEqual(expect.arrayContaining(['/', '/contact']));

    // Browsing on: the cosmos grows in place, the camera stays where the operator put it.
    await feed(page, recorded(3, ['/thanks']));
    await page.waitForFunction('window.__artemis().nodeCount === 7');
    await page.waitForFunction(() => [...document.querySelectorAll('.hub-label .hub-text')].some((e) => e.textContent === '/thanks'));
    expect(((await stateOf(page)) as { selected: number }).selected).not.toBeNull();
    expect(await zoomReadout(page)).toBeGreaterThanOrEqual(3.9);

    // Scope sits where Regenerate was; it hides the outside host and brings it back.
    expect(await anyCount(page, 'button', 'Regenerate (R)')).toBe(0);
    await visible(page, 'Scope (E)');
    await page.keyboard.press('e');
    await page.waitForFunction('window.__artemis().nodeCount === 6');
    expect(await page.getByRole('button', { name: 'Scope (E)' }).getAttribute('aria-pressed')).toBe('true');
    await page.keyboard.press('e');
    await page.waitForFunction('window.__artemis().nodeCount === 7');
    expect(errors).toEqual([]);
  } finally {
    await page.context().close();
  }
}, 40000);

test('C hides and shows the panels in every view; the header switch does the same', async () => {
  const { page, errors } = await engaged();
  try {
    const card = page.locator('.command-card');
    const toggle = page.getByRole('button', { name: 'Panels (C)' });
    await toggle.waitFor({ state: 'visible' });
    expect(await toggle.textContent()).toContain('ON');

    // Browser view: C folds the bottom panels away; the header (with the switch) stays.
    await page.keyboard.press('c');
    await page.waitForFunction('window.__artemis().panelsHidden === true');
    await card.waitFor({ state: 'hidden', timeout: 4000 });
    expect(await page.locator('.hud-header').isVisible()).toBe(true);
    expect(await toggle.textContent()).toContain('OFF');
    await page.keyboard.press('c');
    await page.waitForFunction('window.__artemis().panelsHidden === false');
    await card.waitFor({ state: 'visible', timeout: 4000 });

    // The header switch, for when C was pressed by mistake.
    await toggle.click();
    await page.waitForFunction('window.__artemis().panelsHidden === true');
    await card.waitFor({ state: 'hidden', timeout: 4000 });
    await toggle.click();
    await page.waitForFunction('window.__artemis().panelsHidden === false');
    await card.waitFor({ state: 'visible', timeout: 4000 });

    // Works in the cosmos too, and a view change does not bring the panels back by itself.
    await page.keyboard.press('v');
    await page.waitForFunction('window.__artemis().view === "cosmos" && window.__artemis().viewTransition === null', { timeout: 5000 });
    await page.keyboard.press('c');
    await page.waitForFunction('window.__artemis().panelsHidden === true');
    await card.waitFor({ state: 'hidden', timeout: 4000 });
    await page.keyboard.press('v');
    await page.waitForFunction('window.__artemis().view === "browser" && window.__artemis().viewTransition === null', { timeout: 5000 });
    expect(await card.isVisible()).toBe(false);
    await page.keyboard.press('c');
    await card.waitFor({ state: 'visible', timeout: 4000 });
    expect(errors).toEqual([]);
  } finally {
    await page.context().close();
  }
}, 40000);

test('the header shows real resource readouts: FPS from the page; machine CPU only in the owned browser', async () => {
  const { page, errors } = await engaged();
  try {
    const stat = (label: string) => page.locator('.stat', { has: page.locator('.stat-label', { hasText: new RegExp(`^${label}$`) }) }).locator('.stat-value');
    await page.waitForFunction(() => /^\d+$/.test(document.querySelector('.stat-fps .stat-value')?.textContent ?? ''), null, { timeout: 5000 });
    expect(Number(await stat('FPS').textContent())).toBeGreaterThan(0);
    expect(await stat('CPU').textContent()).toBe('--');
    expect(await stat('ARTEMIS').textContent()).toBe('--');
    expect(await page.locator('.stat-cpu').getAttribute('title')).toContain('owned browser');
    expect(await page.locator('.stat', { hasText: 'T/S' }).count()).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await page.context().close();
  }
}, 40000);

test('the dive is a staged depth animation: the old view leaves before the new one is shown', async () => {
  const { page, errors } = await engaged();
  try {
    await page.keyboard.press('v');
    // Immediately after the keypress the store is already on the cosmos, but the stage still shows the browser.
    expect(await page.getAttribute('.app', 'data-view')).toBe('cosmos');
    expect(await page.getAttribute('.stage', 'data-shown')).toBe('browser');
    expect(await page.getAttribute('.stage', 'data-dir')).toBe('out');
    expect(await page.evaluate('document.querySelector(".stage").getAnimations().length')).toBeGreaterThan(0);
    await page.waitForFunction('document.querySelector(".stage").dataset.shown === "cosmos"', { timeout: 4000 });
    await page.waitForFunction('window.__artemis().viewTransition === null', { timeout: 4000 });
    expect(await page.getAttribute('.stage', 'data-dir')).toBeNull();
    expect(errors).toEqual([]);
  } finally {
    await page.context().close();
  }
}, 30000);

test('with reduced motion the switch still completes and clears its transition', async () => {
  const { page, errors } = await engaged(true);
  try {
    await page.keyboard.press('v');
    await page.waitForFunction('window.__artemis().viewTransition === null', { timeout: 2000 });
    expect(await page.getAttribute('.stage', 'data-shown')).toBe('cosmos');
    expect(errors).toEqual([]);
  } finally {
    await page.context().close();
  }
}, 30000);

test('lenses keep working from the keyboard inside the cosmos, and step aside in the browser', async () => {
  const { page, errors } = await engaged();
  try {
    await page.keyboard.press('v');
    await page.waitForFunction('window.__artemis().viewTransition === null', { timeout: 4000 });
    await page.keyboard.press('3');
    expect(await page.getByRole('tab', { name: /Hubs/ }).getAttribute('aria-selected')).toBe('true');
    await page.keyboard.press('4');
    expect(await page.getByRole('tab', { name: /Routes/ }).getAttribute('aria-selected')).toBe('true');
    expect(await stateOf(page)).toMatchObject({ view: 'cosmos', lens: 'routes' });
    await page.keyboard.press('v');
    await page.waitForFunction('window.__artemis().view === "browser" && window.__artemis().viewTransition === null', { timeout: 4000 });
    expect(await anyCount(page, 'tablist', 'Lenses')).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await page.context().close();
  }
}, 30000);

test('the entry screen asks for the website and nothing starts until a valid one is given', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
  await page.waitForFunction('typeof window.__artemis === "function"');
    const field = page.getByRole('textbox', { name: 'Web App' });
    const engage = page.getByRole('button', { name: 'Engage', exact: true });
    await field.waitFor({ state: 'visible' });
    await page.waitForFunction((id) => document.activeElement?.id === id, 'target-url', { timeout: 5000 });
    expect(await engage.isDisabled()).toBe(true);

    await field.fill('not a website');
    expect(await engage.isDisabled()).toBe(true);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    expect(await stateOf(page)).toMatchObject({ engaged: false, targetUrl: null });
    expect((await page.locator('.boot-note').textContent()) ?? '').toMatch(/web address/i);

    await field.fill('shop.example.co.uk/checkout');
    expect(await engage.isDisabled()).toBe(false);
    await page.keyboard.press('Enter');
    await page.waitForFunction('window.__artemis().engaged === true');
    expect(await stateOf(page)).toMatchObject({ targetUrl: 'https://shop.example.co.uk/checkout' });
    expect(await page.locator('.hud-header').textContent()).toContain('shop.example.co.uk');

    await visible(page, 'View (V)');
    expect(await stateOf(page)).toMatchObject({ view: 'browser' });
    expect(await page.locator('.browser-url').textContent()).toBe('https://shop.example.co.uk/checkout');
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
}, 40000);
