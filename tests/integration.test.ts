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

test('after engaging, the console is in the browser view; V walks browser -> page -> cosmos -> browser', async () => {
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
    await page.waitForFunction('window.__artemis().view === "page"');
    expect(await page.getAttribute('.app', 'data-view')).toBe('page');
    await page.waitForFunction('window.__artemis().viewTransition === null', { timeout: 4000 });
    expect(await cssVar(page, '--base')).toBe('#954c00');
    expect(await cssVar(page, '--alert')).toBe('#9fb6ff');
    await visible(page, 'Depth (D)');
    expect(await anyCount(page, 'tablist', 'Lenses')).toBe(1);
    expect(await page.locator('.hud-header').textContent()).toContain('PAGE');
    expect(await page.locator('.graph-layer').isVisible()).toBe(true);

    await page.keyboard.press('v');
    await page.waitForFunction('window.__artemis().view === "cosmos"');
    await page.waitForFunction('window.__artemis().viewTransition === null', { timeout: 4000 });
    expect(await cssVar(page, '--base')).toBe('#1034a6');
    await visible(page, 'Disperse (D)');
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

    // Works in the other views too, and a view change does not bring the panels back by itself.
    await page.keyboard.press('v');
    await page.waitForFunction('window.__artemis().view === "page" && window.__artemis().viewTransition === null', { timeout: 5000 });
    await page.keyboard.press('c');
    await page.waitForFunction('window.__artemis().panelsHidden === true');
    await card.waitFor({ state: 'hidden', timeout: 4000 });
    await page.keyboard.press('v');
    await page.waitForFunction('window.__artemis().view === "cosmos" && window.__artemis().viewTransition === null', { timeout: 5000 });
    expect(await card.isVisible()).toBe(false);
    await page.keyboard.press('c');
    await card.waitFor({ state: 'visible', timeout: 4000 });
    expect(errors).toEqual([]);
  } finally {
    await page.context().close();
  }
}, 40000);

test('the dive is a staged depth animation: the old view leaves before the new one is shown', async () => {
  const { page, errors } = await engaged();
  try {
    await page.keyboard.press('v');
    // Immediately after the keypress the store is already on page, but the stage still shows cosmos.
    expect(await page.getAttribute('.app', 'data-view')).toBe('page');
    expect(await page.getAttribute('.stage', 'data-shown')).toBe('browser');
    expect(await page.getAttribute('.stage', 'data-dir')).toBe('out');
    expect(await page.evaluate('document.querySelector(".stage").getAnimations().length')).toBeGreaterThan(0);
    await page.waitForFunction('document.querySelector(".stage").dataset.shown === "page"', { timeout: 4000 });
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
    expect(await page.getAttribute('.stage', 'data-shown')).toBe('page');
    expect(errors).toEqual([]);
  } finally {
    await page.context().close();
  }
}, 30000);

test('lenses keep working from the keyboard inside the page and cosmos views', async () => {
  const { page, errors } = await engaged();
  try {
    await page.keyboard.press('v');
    await page.waitForFunction('window.__artemis().viewTransition === null', { timeout: 4000 });
    await page.keyboard.press('3');
    expect(await page.getByRole('tab', { name: /Hubs/ }).getAttribute('aria-selected')).toBe('true');
    await page.keyboard.press('v');
    await page.waitForFunction('window.__artemis().viewTransition === null', { timeout: 4000 });
    await page.keyboard.press('4');
    expect(await page.getByRole('tab', { name: /Routes/ }).getAttribute('aria-selected')).toBe('true');
    expect(await stateOf(page)).toMatchObject({ view: 'cosmos', lens: 'routes' });
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
