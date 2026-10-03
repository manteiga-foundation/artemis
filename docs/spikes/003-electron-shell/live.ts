// Spike 003, live: the shell on screen with a click-counting fixture, attached over CDP so its state
// can be read while real OS input is applied from outside. Runs for `seconds` then exits.
import { chromium } from 'playwright';
import { join } from 'node:path';
import electronPath from 'electron';

const appUrl = process.argv[2] ?? 'http://127.0.0.1:5179';
const seconds = Number(process.argv[3] ?? 240);
const fixture = Bun.serve({
  hostname: 'localhost', port: 0,
  fetch() {
    return new Response(`<!doctype html><meta charset=utf-8><title>Click fixture</title><body style="margin:0;font:28px sans-serif;background:#fffbe6;height:100vh"><h1 style="margin:60px">Click fixture</h1><p id=c style="margin:60px">clicks: 0</p><select id=s style="margin:60px;font:24px sans-serif"><option>Alpha</option><option>Bravo</option><option>Charlie</option></select><script>let n=0;addEventListener('click',(e)=>{c.textContent='clicks: '+(++n)+' at '+e.clientX+','+e.clientY})</script>`, { headers: { 'content-type': 'text/html' } });
  }
});
const port = 9341;
const proc = Bun.spawn([electronPath as unknown as string, join(import.meta.dir, 'main.cjs')], { cwd: import.meta.dir, env: { ...process.env, APP_URL: appUrl, CDP_PORT: String(port) }, stdout: 'ignore', stderr: 'ignore' });
for (let i = 0; i < 100 && !(await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.ok).catch(() => false)); i++) await Bun.sleep(200);
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const ctx = browser.contexts()[0];
let overlay = ctx.pages().find((p) => p.url().includes('shell=electron'));
for (let i = 0; !overlay && i < 50; i++) { await Bun.sleep(200); overlay = ctx.pages().find((p) => p.url().includes('shell=electron')); }
await overlay!.waitForFunction('typeof window.__artemis === "function"');
await overlay!.getByRole('textbox', { name: 'Web App' }).fill(`http://localhost:${fixture.port}/`);
await overlay!.getByRole('button', { name: 'Engage', exact: true }).click();
console.log(`live: engaged http://localhost:${fixture.port}/`);
let last = '';
const end = Date.now() + seconds * 1000;
while (Date.now() < end && proc.exitCode === null) {
  const site = ctx.pages().find((p) => p.url().startsWith(`http://localhost:${fixture.port}`));
  const c = site ? await site.locator('#c').textContent().catch(() => null) : null;
  const v = await overlay!.evaluate('window.__artemis().view').catch(() => '?');
  const line = `site ${c} | view ${v}`;
  if (line !== last) { console.log(new Date().toISOString().slice(11, 19), line); last = line; }
  await Bun.sleep(300);
}
await browser.close().catch(() => {});
proc.kill();
fixture.stop(true);
process.exit(0);
