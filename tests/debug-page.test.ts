import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, type Browser } from 'playwright';
import { startVite, type ViteServer } from './vite';

let vite: ViteServer;
let browser: Browser;

beforeAll(async () => {
  vite = await startVite();
  browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
}, 30000);

afterAll(async () => {
  await browser?.close();
  vite?.stop();
});

test('/debug is a page of its own: every sound can be played, actions can be assigned, suggestions copied', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`${vite.url}/debug`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: /debug/i }).waitFor();
    expect(await page.locator('.boot').count()).toBe(0); // not the console's entry screen

    // The catalogue: shipped files and synthesized presets, each with its own Play.
    const rows = page.locator('[data-sound-id]');
    expect(await rows.count()).toBeGreaterThanOrEqual(15);
    expect(await page.locator('[data-sound-id="file:click"]').count()).toBe(1);
    expect(await page.locator('[data-sound-id^="synth:"]').count()).toBeGreaterThanOrEqual(10);

    // Playing a synthesized bleep runs the Web Audio graph without errors and is recorded.
    await page.locator('[data-sound-id="synth:tick"] button', { hasText: 'Play' }).click();
    await page.waitForFunction(() => document.body.dataset.lastPlayed === 'synth:tick');
    await page.locator('[data-sound-id="file:click"] button', { hasText: 'Play' }).click();
    await page.waitForFunction(() => document.body.dataset.lastPlayed === 'file:click');
    // Every synthesized preset schedules cleanly (a bad ramp or filter value throws synchronously).
    const synthIds = await page.locator('[data-sound-id^="synth:"]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.soundId!));
    for (const id of synthIds) {
      await page.locator(`[data-sound-id="${id}"] button`, { hasText: 'Play' }).click();
      await page.waitForFunction((want) => document.body.dataset.lastPlayed === want, id);
    }
    expect(synthIds.length).toBeGreaterThanOrEqual(20);
    expect(errors).toEqual([]);

    // Actions: pick a candidate for hover, audition it, then copy the suggestions.
    const hover = page.locator('[data-action-id="hover"]');
    await hover.locator('select').selectOption('synth:tick');
    await hover.getByRole('button', { name: 'Play' }).click();
    await page.waitForFunction(() => document.body.dataset.lastPlayed === 'synth:tick');
    await page.getByRole('button', { name: /copy suggestions/i }).click();
    const text = await page.locator('.debug-suggestions').textContent();
    expect(text).toContain('hover -> synth:tick');
    expect(text).toContain('command-error -> (keep file:error)');

    // Apply to the console: the real hover in the real console now plays the pick.
    await hover.locator('select').selectOption('synth:soft-hover');
    await page.getByRole('button', { name: /apply to the console/i }).click();
    await page.goto(`${vite.url}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction('typeof window.__artemis === "function"');
    await page.getByRole('textbox', { name: 'Web App' }).fill('example.com');
    await page.getByRole('button', { name: 'Engage', exact: true }).click();
    await page.waitForFunction('window.__artemis().engaged === true');
    await page.waitForFunction(() => document.body.dataset.lastPlayed === 'file:intro'); // engage sound, default
    const annotate = page.getByRole('button', { name: 'Annotate (A)' });
    await annotate.waitFor({ state: 'visible' });
    await annotate.hover();
    await page.waitForFunction(() => document.body.dataset.lastPlayed === 'synth:soft-hover');
    await page.keyboard.press('c');
    await page.waitForFunction(() => document.body.dataset.lastPlayed === 'file:click'); // panels-close default

    // Reset on /debug returns the console to its defaults.
    await page.goto(`${vite.url}/debug`, { waitUntil: 'networkidle' });
    expect(await page.locator('[data-action-id="hover"] select').inputValue()).toBe('synth:soft-hover'); // picks were remembered
    await page.getByRole('button', { name: /reset/i }).click();
    expect(await page.locator('[data-action-id="hover"] select').inputValue()).toBe('file:hover');
    expect(await page.evaluate(() => localStorage.getItem('artemis.sfx.overrides'))).toBeNull();
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
}, 60000);
