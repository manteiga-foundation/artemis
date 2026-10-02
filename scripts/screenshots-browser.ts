// Screenshot the Browser view with a real website inside the owned (headless) browser.
// bun run scripts/screenshots-browser.ts <devServerPort> <outDir> [targetUrl]
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ownBrowser } from '../server/owned-browser';

const port = process.argv[2] ?? '5173';
const out = process.argv[3] ?? 'docs/screenshots';
const target = process.argv[4] ?? 'https://en.wikipedia.org/wiki/Main_Page';
const profile = await mkdtemp(join(tmpdir(), 'artemis-shot-'));
const owned = await ownBrowser({ appUrl: `http://127.0.0.1:${port}`, userDataDir: profile, headless: true, width: 1440, height: 900 });
try {
  const { page } = owned;
  await page.waitForLoadState('networkidle');
  await page.getByRole('textbox', { name: 'Website' }).fill(target);
  await page.getByRole('button', { name: 'Engage', exact: true }).click();
  const frame = page.frameLocator('.browser-surface iframe');
  await frame.locator('body').waitFor({ timeout: 20000 });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${out}/browser-live.png` });
  console.log('state:', await page.locator('.browser-state').textContent());
} finally {
  await owned.close();
  await rm(profile, { recursive: true, force: true });
}
