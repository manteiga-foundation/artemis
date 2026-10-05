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
    // pages /, /contact, each wearing its API call and the maps script as dots of its own
    expect(await stateOf(page)).toMatchObject({ nodeCount: 6 });

    await page.keyboard.press('v');
    await page.waitForFunction('window.__artemis().view === "cosmos" && window.__artemis().viewTransition === null', { timeout: 4000 });
    expect(((await stateOf(page)) as { status: string }).status).toBe('View: Cosmos. Current page /contact selected.');
    await page.waitForTimeout(600);
    expect((await selectedLabel(page))?.text).toBe('/contact');
    // ...centred on screen, as in the emulated cosmos, and still there once the layout has moved.
    for (const wait of [0, 2000]) {
      await page.waitForTimeout(wait);
      const label = (await selectedLabel(page))!;
      expect([Math.abs(label.dx) < 80, Math.abs(label.dy) < 80]).toEqual([true, true]);
    }
    const landedZoom = await zoomReadout(page);
    // Pages are labelled as they appear.
    expect(await page.locator('.hub-label .hub-text').allTextContents()).toEqual(expect.arrayContaining(['/', '/contact']));

    // Browsing on: the cosmos grows in place, the camera stays where the operator put it.
    const positions = () => page.evaluate('window.__artemisPositions()') as Promise<number[]>;
    const coreBefore = (await positions()).slice(0, 2);
    await feed(page, recorded(3, ['/thanks']));
    await page.waitForFunction('window.__artemis().nodeCount === 9');
    await page.waitForFunction(() => [...document.querySelectorAll('.hub-label .hub-text')].some((e) => e.textContent === '/thanks'));
    expect(((await stateOf(page)) as { selected: number }).selected).not.toBeNull();
    expect(await zoomReadout(page)).toBeCloseTo(landedZoom, 2);

    // The core is the fixed centre of the cosmos; the first page reached from it sits straight
    // up, and the page reached from that one further out on the same line, once the growth glided.
    await page.waitForTimeout(1500);
    const p = await positions();
    expect(coreBefore).toEqual([2048, 2048]);
    expect(p.slice(0, 2)).toEqual([2048, 2048]);
    const names = (await page.evaluate('window.__artemisNodes()')) as string[];
    const [contact, thanks] = ['/contact', '/thanks'].map((id) => names.indexOf(id));
    // Offsets from the core as seen on screen (cosmos.gl's space has y up).
    const from = (i: number) => [p[i * 2] - 2048, 2048 - p[i * 2 + 1]];
    expect(Math.abs(from(contact)[0])).toBeLessThan(0.5);
    expect(from(contact)[1]).toBeLessThan(-50);
    expect(Math.abs(from(thanks)[0])).toBeLessThan(0.5);
    expect(from(thanks)[1]).toBeLessThan(from(contact)[1] - 50);
    // "Up" means up on screen: the labels say where the graph really drew them.
    const labelY = (text: string) =>
      page.evaluate((t) => {
        const el = [...document.querySelectorAll<HTMLElement>('.hub-label')].find((e) => e.textContent === t);
        const m = el && /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(el.style.transform);
        return m ? Number(m[2]) : null;
      }, text);
    await page.keyboard.press('f'); // frame the selection's surroundings so both labels are on screen
    await page.waitForTimeout(1200);
    const [coreY, contactY] = [await labelY('/'), await labelY('/contact')];
    expect(coreY).not.toBeNull();
    expect(contactY!).toBeLessThan(coreY!);

    // Scope sits where Regenerate was; it hides the outside host and brings it back.
    expect(await anyCount(page, 'button', 'Regenerate (R)')).toBe(0);
    await visible(page, 'Scope (E)');
    await page.keyboard.press('e');
    await page.waitForFunction('window.__artemis().nodeCount === 6');
    expect(await page.getByRole('button', { name: 'Scope (E)' }).getAttribute('aria-pressed')).toBe('true');
    await page.keyboard.press('e');
    await page.waitForFunction('window.__artemis().nodeCount === 9');
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
    expect(await page.getByRole('textbox', { name: 'Address' }).inputValue()).toBe('https://shop.example.co.uk/checkout');
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
}, 40000);

test('the configuration view (the sketch): opens from the header or with ",", searches, ticks, applies; Esc returns; the sound default is real', async () => {
  const { page, errors } = await engaged();
  try {
    await page.getByRole('button', { name: 'Settings (,)' }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await dialog.waitFor({ state: 'visible' });
    const nav = dialog.getByRole('navigation', { name: 'Setting categories' });
    const categories = async () => (await nav.getByRole('button').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))));
    expect(await categories()).toEqual(['Scope', 'Export', 'LLM connections', 'Sound', 'Autopilot', 'Copilot', 'Defaults']);
    await dialog.getByRole('heading', { name: 'Scope', exact: true }).waitFor({ state: 'visible' });
    await dialog.getByText('Interface only for now').waitFor({ state: 'visible' });
    // The map card and the command card stay; the card holds the settings commands.
    expect(await page.locator('.minimap').isVisible()).toBe(true);
    for (const name of ['Apply (A)', 'Search (S)', 'View (V)']) await page.getByRole('button', { name, exact: true }).waitFor({ state: 'visible' });
    expect(await page.locator('.command-card .panel-title-right').textContent()).toBe('SETTINGS');

    // Search finds settings by their words.
    const search = dialog.getByRole('searchbox', { name: 'Search settings' });
    await search.fill('subdomain');
    expect(await categories()).toEqual(['Scope']);
    expect(await dialog.getByRole('checkbox').count()).toBe(1);
    await dialog.getByRole('checkbox', { name: /Include subdomains/ }).waitFor({ state: 'visible' });
    await search.fill('nothing like this');
    await dialog.getByText('No setting matches').waitFor({ state: 'visible' });
    await search.fill('');

    // Sound works for real: nothing changes until Apply, then it does.
    await nav.getByRole('button', { name: 'Sound', exact: true }).click();
    const sound = dialog.getByRole('checkbox', { name: /Sound on when Artemis starts/ });
    expect(await sound.isChecked()).toBe(true);
    expect(await dialog.getByText('Interface only for now').count()).toBe(0);
    await sound.uncheck();
    await dialog.getByText('1 change not applied').waitFor({ state: 'visible' });
    expect(await stateOf(page)).toMatchObject({ muted: false });
    // The card's Apply lights while a change waits.
    expect(await page.getByRole('button', { name: 'Apply (A)' }).getAttribute('aria-pressed')).toBe('true');
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    expect(await stateOf(page)).toMatchObject({ muted: true, status: 'Settings applied: 1 change.' });
    expect(await page.getByRole('button', { name: 'Apply (A)' }).getAttribute('aria-pressed')).toBe('false');

    // Esc closes it and the view is where it was.
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Settings"]'));
    expect(await stateOf(page)).toMatchObject({ view: 'browser', settingsOpen: false });

    // "," opens it again, the applied setting kept; a change not applied is discarded on close,
    // and "," still works with a checkbox focused (only text fields keep their keys).
    await page.keyboard.press(',');
    await dialog.waitFor({ state: 'visible' });
    expect(await sound.isChecked()).toBe(false);
    await sound.check();
    await page.keyboard.press(',');
    await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Settings"]'));
    expect(await stateOf(page)).toMatchObject({ muted: true, status: 'Settings closed: 1 change not applied, discarded.' });

    // Kept for the next start: Artemis starts muted.
    await page.reload();
    await page.waitForFunction(() => typeof (window as unknown as { __artemis?: unknown }).__artemis === 'function');
    expect(await stateOf(page)).toMatchObject({ muted: true });
    expect(errors).toEqual([]);
  } finally {
    await page.context().close();
  }
}, 40000);

test('autopilot (the sketch): D in the old bulb slot with a yoke and three squares; each press steps the speed; outside the owned browser it says where it flies', async () => {
  const { page, errors } = await engaged();
  try {
    const d = page.getByRole('button', { name: 'Autopilot (D)' });
    await d.waitFor({ state: 'visible' });
    // Top-right slot of the card; Highlight is gone and DOM moved to O.
    expect(await page.locator('.cmd-grid .cmd-btn').nth(2).getAttribute('aria-label')).toBe('Autopilot (D)');
    expect(await page.getByRole('button', { name: 'Highlight (H)' }).count()).toBe(0);
    await page.getByRole('button', { name: 'DOM (O)' }).waitFor({ state: 'visible' });
    const lit = () => d.locator('.cmd-pip.is-on').count();
    expect([await d.locator('.cmd-pip').count(), await lit()]).toEqual([3, 0]);
    // The squares sit under the yoke, inside the button.
    const [btn, pips, icon] = await Promise.all([d.boundingBox(), d.locator('.cmd-pips').boundingBox(), d.locator('.cmd-icon').boundingBox()]);
    expect(pips!.y).toBeGreaterThan(icon!.y + icon!.height - 2);
    expect(pips!.y + pips!.height).toBeLessThanOrEqual(btn!.y + btn!.height);

    const mode = page.locator('.console-mode');
    const steps: [number, string, string][] = [
      [1, 'true', 'MODE AUTOPILOT SLOW'],
      [2, 'true', 'MODE AUTOPILOT REGULAR'],
      [3, 'true', 'MODE AUTOPILOT MAX'],
      [0, 'false', 'MODE REVIEW']
    ];
    for (const [n, pressed, readout] of steps) {
      await page.keyboard.press('d');
      expect(await lit()).toBe(n);
      expect(await d.getAttribute('aria-pressed')).toBe(pressed);
      expect((await mode.textContent())?.replace(/\s+/g, ' ').trim()).toBe(readout);
      expect(await stateOf(page)).toMatchObject({ autopilot: n });
      if (n === 1) expect(((await stateOf(page)) as { status: string }).status).toContain('flies in the owned browser');
    }

    // Only in the Browser view for now: in the Cosmos, D is still Disperse.
    await page.keyboard.press('v');
    await page.waitForFunction(() => (window as unknown as { __artemis: () => { viewTransition: unknown; view: string } }).__artemis().view === 'cosmos' && !(window as unknown as { __artemis: () => { viewTransition: unknown } }).__artemis().viewTransition);
    await page.getByRole('button', { name: 'Disperse (D)' }).waitFor({ state: 'visible' });
    expect(errors).toEqual([]);
  } finally {
    await page.context().close();
  }
}, 40000);

test('a big recording whose current page is a leaf at its edge: V centres that page with the core in view', async () => {
  const { page, errors } = await engaged();
  try {
    await page.waitForFunction('window.__artemisSiteFeed === true');
    // Like an ASP.NET back office: six sections with two pages each, fifty calls a page, and last a
    // handler link (a download) reached from the far end.
    const sections = ['admin', 'reports', 'documents', 'billing', 'calls', 'setup'];
    const paths = ['/', ...sections.flatMap((s) => [`/${s}`, `/${s}/one`, `/${s}/two`]), '/setup/two/Link.ashx'];
    const events: unknown[] = [{ type: 'reset' }, { type: 'session', target: `${S}/`, scopeHost: 'shop.example' }];
    paths.forEach((path, i) => {
      const id = i + 1;
      events.push({ type: 'visit', id, t: id, url: `${S}${path}`, kind: 'document', committed: true });
      const calls = path.endsWith('.ashx') ? 0 : 50;
      for (let k = 0; k < calls; k++) events.push({ type: 'request', id: id * 1000 + k, visitId: id, method: 'GET', url: `${S}/scripts/${id}/${k}.js`, resourceType: 'script', mainDocument: false });
      // Back to the section's page or the core between pages, as a person (or the autopilot) does.
      const back = path === '/' || path.split('/').length > 2 ? '/' : path;
      if (back !== path) events.push({ type: 'visit', id: 500 + id, t: id + 0.5, url: `${S}${back}`, kind: 'document', committed: true });
    });
    events.push({ type: 'visit', id: 999, t: 999, url: `${S}/setup/two`, kind: 'document', committed: true }, { type: 'visit', id: 1000, t: 1000, url: `${S}/setup/two/Link.ashx`, kind: 'document', committed: true });
    await feed(page, events);
    await page.waitForFunction('window.__artemis().recorded === true && window.__artemis().nodeCount > 900');

    await page.keyboard.press('v');
    await page.waitForFunction('window.__artemis().view === "cosmos" && window.__artemis().viewTransition === null', { timeout: 4000 });
    await page.waitForTimeout(1300);
    const label = (await selectedLabel(page))!;
    expect(label.text).toBe('/setup/two/Link.ashx');
    expect([Math.abs(label.dx) < 80, Math.abs(label.dy) < 80]).toEqual([true, true]);
    // The whole recording is present: the core's label is on the stage too.
    const core = await page.evaluate(() => {
      const el = [...document.querySelectorAll<HTMLElement>('.hub-label')].find((e) => e.textContent === '/');
      const stage = document.querySelector('.graph-layer')!.getBoundingClientRect();
      const m = el && /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(el.style.transform);
      return m ? { x: Number(m[1]), y: Number(m[2]), w: stage.width, h: stage.height } : null;
    });
    expect(core).not.toBeNull();
    expect([core!.x > 0 && core!.x < core!.w, core!.y > 0 && core!.y < core!.h]).toEqual([true, true]);
    // Seen whole, the labels give way rather than pile up: no two shown labels overlap, and the
    // selected page's always shows.
    await page.waitForTimeout(300);
    const boxes = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.hub-label')]
        .filter((el) => Number(getComputedStyle(el).opacity) > 0.5)
        .map((el) => {
          const r = el.querySelector('.hub-text')!.getBoundingClientRect();
          return { text: el.textContent, selected: el.classList.contains('is-selected'), x0: r.left, x1: r.right, y0: r.top, y1: r.bottom };
        })
    );
    expect(boxes.some((b) => b.selected)).toBe(true);
    const overlaps = boxes.flatMap((a, i) => boxes.slice(i + 1).filter((b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1).map((b) => `${a.text} / ${b.text}`));
    expect(overlaps).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await page.context().close();
  }
}, 40000);

test('while a page loads, the address field itself is a soft progress bar and the strip says LOADING; once loaded it fills and goes', async () => {
  const { page, errors } = await engaged();
  try {
    // The slow page answers only when the test lets it.
    let release = () => {};
    const gated = async () => {
      await page.context().unroute('https://slow.example/**');
      const gate = new Promise<void>((r) => (release = r));
      await page.context().route('https://slow.example/**', async (route) => {
        await gate;
        await route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Slow page</h1>' });
      });
    };
    await gated();
    const bar = page.locator('.browser-bar');
    const address = page.getByRole('textbox', { name: 'Address' });
    const progress = bar.getByRole('progressbar', { name: 'Page loading' });
    const noBar = () => page.waitForFunction(() => !document.querySelector('.browser-bar [role="progressbar"]'), null, { timeout: 15000 });
    const value = async () => Number(await progress.getAttribute('aria-valuenow'));
    await address.waitFor({ state: 'visible' });
    await noBar(); // the first page (example.com) has loaded

    await address.fill('https://slow.example/');
    await address.press('Enter');
    await progress.waitFor({ state: 'visible', timeout: 3000 });
    // The bar is the address field: same box.
    const [pb, ab] = [(await progress.boundingBox())!, (await address.boundingBox())!];
    for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(pb[k] - ab[k])).toBeLessThanOrEqual(1);
    const first = await value();
    await page.waitForTimeout(700);
    const later = await value();
    expect([first > 0, later > first, later < 100]).toEqual([true, true, true]);
    expect(await address.getAttribute('aria-busy')).toBe('true');
    expect(await bar.locator('.browser-state').textContent()).toContain('LOADING');

    release();
    await page.waitForFunction(() => document.querySelector('.browser-bar [role="progressbar"]')?.getAttribute('aria-valuenow') === '100', null, { timeout: 5000 });
    await noBar();
    expect(await address.getAttribute('aria-busy')).not.toBe('true');
    expect(await bar.locator('.browser-state').textContent()).toContain('LIVE');

    // Reload shows it again.
    await gated();
    await bar.getByRole('button', { name: 'Reload', exact: true }).click();
    await progress.waitFor({ state: 'visible', timeout: 3000 });
    release();
    await noBar();
    expect(errors).toEqual([]);
  } finally {
    await page.context().close();
  }
}, 40000);

test('the address strip: small Back, Forward and Reload beside LIVE PAGE; the address (its query too) is editable and Enter goes there', async () => {
  const { page, errors } = await engaged();
  try {
    const bar = page.locator('.browser-bar');
    const button = (name: string) => bar.getByRole('button', { name, exact: true });
    for (const name of ['Back', 'Forward', 'Reload']) {
      await button(name).waitFor({ state: 'visible' });
      const box = (await button(name).boundingBox())!;
      expect([box.width <= 20, box.height <= 20]).toEqual([true, true]);
    }
    // Right after LIVE PAGE, in browser order, then the address.
    const xs = (await page.evaluate(() =>
      ['.browser-scheme', '[aria-label="Back"]', '[aria-label="Forward"]', '[aria-label="Reload"]', '.browser-url'].map((s) => document.querySelector(s)!.getBoundingClientRect().x)
    )) as number[];
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    // An ordinary browser cannot reach a cross-origin frame's history: Back and Forward stay off.
    expect([await button('Back').isDisabled(), await button('Forward').isDisabled(), await button('Reload').isDisabled()]).toEqual([true, true, false]);

    const address = page.getByRole('textbox', { name: 'Address' });
    expect(await address.inputValue()).toBe('https://example.com/');
    const frameSrc = () => page.locator('.browser-frame').getAttribute('src');
    // Rewrite the GET parameters; keys typed there are text, not console hotkeys.
    await address.fill('https://example.com/search?q=artemis&page=2');
    await address.press('v');
    expect(await stateOf(page)).toMatchObject({ view: 'browser' });
    await address.press('Backspace');
    await address.press('Enter');
    await page.waitForFunction(() => document.querySelector('.browser-frame')?.getAttribute('src') === 'https://example.com/search?q=artemis&page=2');
    expect(await address.inputValue()).toBe('https://example.com/search?q=artemis&page=2');

    // Escape puts back the address of the page shown; something that is not a web address goes nowhere.
    await address.fill('half typed');
    await address.press('Escape');
    expect(await address.inputValue()).toBe('https://example.com/search?q=artemis&page=2');
    await address.fill('not an address');
    await address.press('Enter');
    expect(await frameSrc()).toBe('https://example.com/search?q=artemis&page=2');
    expect(((await stateOf(page)) as { status: string }).status).toMatch(/not a web address/i);

    // Reload: a fresh load of the same address.
    await page.evaluate(() => ((document.querySelector('.browser-frame') as HTMLIFrameElement & { dataset: DOMStringMap }).dataset.before = '1'));
    await button('Reload').click();
    await page.waitForFunction(() => document.querySelector('.browser-frame') && !(document.querySelector('.browser-frame') as HTMLElement).dataset.before);
    expect(await frameSrc()).toBe('https://example.com/search?q=artemis&page=2');
    expect(errors).toEqual([]);
  } finally {
    await page.context().close();
  }
}, 40000);
