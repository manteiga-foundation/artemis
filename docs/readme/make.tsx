// The README's visuals in the console's style: hero.png, features.png, and the dive as dive.gif and
// dive.mp4. With a dev server running: `bun run docs/readme/make.tsx <port> [site] [--skip-dive]`
// (needs ffmpeg). --skip-dive keeps the recorded dive and renders only the stills.
// Stills of the console are captured at device scale 2; the dive is a CDP screencast assembled at
// 30 fps (MP4) and 12 fps, 960 px, 128 colours (GIF, kept under 10 MB by tests/readme.test.ts).
import { chromium, type Page } from 'playwright';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GiFamilyTree, GiRadarSweep, GiSave } from 'react-icons/gi';
import { YokeIcon } from '../../src/icons';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const skipDive = process.argv.includes('--skip-dive');
const port = args[0] ?? '5173';
const site = args[1] ?? 'https://en.wikipedia.org/wiki/Main_Page';
const dir = new URL('.', import.meta.url).pathname;
const nm = new URL('../../node_modules/', import.meta.url).pathname;
const docs = new URL('../screenshots/', import.meta.url).pathname;
const work = await mkdtemp(join(tmpdir(), 'artemis-readme-'));
const shots = `file://${work}/`;
const icons: Record<string, string> = Object.fromEntries(
  Object.entries({ radar: GiRadarSweep, yoke: YokeIcon, tree: GiFamilyTree, save: GiSave }).map(([k, I]) => [k, renderToStaticMarkup(createElement(I as never, { size: '1em' }))])
);
const sh = (cmd: string[]) => { const r = Bun.spawnSync(cmd, { stderr: 'pipe' }); if (r.exitCode !== 0) throw new Error(`${cmd[0]}: ${r.stderr}`); };

const C = { bg: '#02061a', bg2: '#040b26', deep: '#071441', navy: '#0b1f66', base: '#1034a6', royal: '#2a4fc4', azure: '#4c6fe0', sky: '#7b98f0', mist: '#a9bdf7', frost: '#d6e0fc', white: '#eef3ff', gold: '#e0b85c' };
const G = { base: '#005d2c', azure: '#009561', sky: '#43b48a', mist: '#8fcfb3', frost: '#cce9db', bg: '#000c04' };
const FACE = ['#f3dfa2', '#ecd088', '#e6c271', '#e0b85c', '#d6a243', '#c88000'];
const LETTERS: Record<string, string[]> = {
  A: [' █████╗ ', '██╔══██╗', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
  R: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔══██╗', '██║  ██║', '╚═╝  ╚═╝'],
  T: ['████████╗', '╚══██╔══╝', '   ██║   ', '   ██║   ', '   ██║   ', '   ╚═╝   '],
  E: ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '███████╗', '╚══════╝'],
  M: ['███╗   ███╗', '████╗ ████║', '██╔████╔██║', '██║╚██╔╝██║', '██║ ╚═╝ ██║', '╚═╝     ╚═╝'],
  I: ['██╗', '██║', '██║', '██║', '██║', '╚═╝'],
  S: ['███████╗', '██╔════╝', '███████╗', '╚════██║', '███████║', '╚══════╝']
};
const banner = () => [0, 1, 2, 3, 4, 5].map((r) => {
  const row = [...'ARTEMIS'].map((ch) => LETTERS[ch][r]).join('');
  return `<div style="color:${FACE[r]}">${[...row].map((c) => (c === '█' || c === ' ' ? c : `<span class="shadow">${c}</span>`)).join('')}</div>`;
}).join('');

const mark = (size: number, stroke = C.sky) => `<svg width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" stroke-linejoin="round" stroke-linecap="round">
  <path d="M16 2 L28 9 V23 L16 30 L4 23 V9 Z" stroke="${C.azure}" stroke-opacity=".7" stroke-width="2.4" style="filter:blur(1.2px)"/>
  <path d="M16 2 L28 9 V23 L16 30 L4 23 V9 Z" stroke="${stroke}" stroke-width="1.5"/>
  <path d="M16 2 V16 M16 16 L28 9 M16 16 L4 9 M16 16 V30" stroke="${stroke}" stroke-width=".8" opacity=".55"/>
  <circle cx="16" cy="16" r="3" fill="${stroke}"/></svg>`;

const FEATURES = [
  { icon: 'radar', key: '', title: 'Genuine browser', text: 'The site runs unmodified. Sign-in, MFA and dialogs behave as in Chrome.' },
  { icon: 'yoke', key: 'D', title: 'Autopilot', text: 'Flies the application branch by branch while you watch.' },
  { icon: 'tree', key: 'V', title: 'Live cosmos', text: 'Every page, flow and request mapped as it happens.' },
  { icon: 'save', key: '', title: 'Open sessions', text: 'SQLite, HAR and video. Reuse them in your own tools.' }
];
const REPO = 'github.com/manteiga-foundation/artemis';

const css = `
@font-face { font-family: T; font-weight: 300; src: url(file://${nm}@fontsource/titillium-web/files/titillium-web-latin-300-normal.woff2); }
@font-face { font-family: T; font-weight: 400; src: url(file://${nm}@fontsource/titillium-web/files/titillium-web-latin-400-normal.woff2); }
@font-face { font-family: T; font-weight: 600; src: url(file://${nm}@fontsource/titillium-web/files/titillium-web-latin-600-normal.woff2); }
@font-face { font-family: T; font-weight: 700; src: url(file://${nm}@fontsource/titillium-web/files/titillium-web-latin-700-normal.woff2); }
@font-face { font-family: M; font-weight: 400; src: url(file://${nm}@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2); }
@font-face { font-family: M; font-weight: 700; src: url(file://${nm}@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2); }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: var(--w); height: var(--h); overflow: hidden; background: ${C.bg}; }
body { font-family: T, sans-serif; color: ${C.frost}; -webkit-font-smoothing: antialiased; position: relative; }
.space { position: absolute; inset: 0;
  background:
    radial-gradient(ellipse at 60% 45%, color-mix(in srgb, ${C.base} 22%, transparent), transparent 62%),
    linear-gradient(${C.bg2}, ${C.bg}); }
.grid { position: absolute; inset: 0; opacity: .5;
  background-image:
    linear-gradient(color-mix(in srgb, ${C.azure} 9%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, ${C.azure} 9%, transparent) 1px, transparent 1px),
    radial-gradient(circle, color-mix(in srgb, ${C.sky} 45%, transparent) 1px, transparent 1.6px);
  background-size: 48px 48px, 48px 48px, 48px 48px; background-position: -1px -1px, -1px -1px, -24px -24px; }
.mono { font-family: M, monospace; }
.label { font-family: M, monospace; text-transform: uppercase; letter-spacing: .2em; font-size: 12px; color: ${C.mist}; }
.gold { color: ${C.gold}; }
.chip { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px 6px 10px; font-family: M, monospace; font-size: 11px; letter-spacing: .22em; text-transform: uppercase;
  color: ${C.gold}; background: color-mix(in srgb, ${C.gold} 10%, transparent); border: 1px solid color-mix(in srgb, ${C.gold} 45%, transparent);
  clip-path: polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px); }
.chip::before { content: ''; width: 6px; height: 6px; background: ${C.gold}; box-shadow: 0 0 8px ${C.gold}; }
.brand { display: flex; align-items: center; gap: 12px; font-weight: 700; letter-spacing: .34em; color: ${C.white}; text-transform: uppercase; }
h1 { font-weight: 600; color: ${C.white}; line-height: 1.08; letter-spacing: -.005em; }
h1 em { font-style: normal; color: ${C.gold}; }
.panel { position: relative; background: color-mix(in srgb, ${C.deep} 72%, transparent); backdrop-filter: blur(6px);
  border: 1px solid color-mix(in srgb, ${C.azure} 40%, transparent);
  clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px); }
.brackets { position: absolute; inset: 0; pointer-events: none;
  background:
    linear-gradient(${C.sky}, ${C.sky}) top left / 18px 1.5px no-repeat, linear-gradient(${C.sky}, ${C.sky}) top left / 1.5px 18px no-repeat,
    linear-gradient(${C.sky}, ${C.sky}) top right / 18px 1.5px no-repeat, linear-gradient(${C.sky}, ${C.sky}) top right / 1.5px 18px no-repeat,
    linear-gradient(${C.sky}, ${C.sky}) bottom left / 18px 1.5px no-repeat, linear-gradient(${C.sky}, ${C.sky}) bottom left / 1.5px 18px no-repeat,
    linear-gradient(${C.sky}, ${C.sky}) bottom right / 18px 1.5px no-repeat, linear-gradient(${C.sky}, ${C.sky}) bottom right / 1.5px 18px no-repeat; }
.feat { display: grid; grid-template-columns: 40px 1fr; gap: 14px; align-items: start; }
.ico { width: 40px; height: 40px; display: grid; place-items: center; font-size: 22px; color: ${C.gold}; position: relative;
  background: color-mix(in srgb, ${C.navy} 70%, transparent); border: 1px solid color-mix(in srgb, ${C.azure} 45%, transparent);
  clip-path: polygon(5px 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%, 0 5px); }
.ico .k { position: absolute; right: 3px; bottom: 1px; font-family: M, monospace; font-size: 8px; color: ${C.mist}; }
.feat b { display: block; font-family: M, monospace; font-weight: 700; font-size: 12.5px; letter-spacing: .18em; text-transform: uppercase; color: ${C.white}; margin-bottom: 3px; }
.feat span { font-size: 15px; line-height: 1.35; color: ${C.frost}; }
.foot { font-family: M, monospace; font-size: 13px; letter-spacing: .12em; color: ${C.frost}; display: flex; gap: 14px; align-items: center; }
.foot i { width: 4px; height: 4px; background: ${C.azure}; display: inline-block; }
.shot { position: absolute; background-repeat: no-repeat; }
.banner { font-family: M, monospace; white-space: pre; line-height: 1; font-weight: 400; }
.banner .shadow { color: ${C.royal}; }
.key { display: grid; place-items: center; font-family: M, monospace; font-weight: 700; color: ${C.bg};
  background: linear-gradient(${FACE[0]}, ${C.gold} 60%, ${FACE[5]}); box-shadow: 0 0 36px color-mix(in srgb, ${C.gold} 55%, transparent), inset 0 -4px 0 color-mix(in srgb, ${FACE[5]} 80%, black);
  clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px); }
`;

const feature = (f: (typeof FEATURES)[number]) => `<div class="feat"><div class="ico">${icons[f.icon]}<span class="k">${f.key}</span></div><div><b>${f.title}</b><span>${f.text}</span></div></div>`;
const foot = (extra = '') => `<div class="foot"><span class="gold">MIT</span><i></i><span>${REPO}</span>${extra}</div>`;
const page = (w: number, h: number, body: string) => `<!doctype html><meta charset="utf-8"><style>:root{--w:${w}px;--h:${h}px}${css}</style><body><div class="space"></div><div class="grid"></div>${body}</body>`;

// The console screenshots are 2880x1800 (1440x900 at 2x); the header is the top 52 px (104 at 2x).
const crop = (file: string, x: number, y: number, w: number, h: number, scale: number, ox: number, oy: number, extra = '') =>
  `<div class="shot" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;background-image:url(${shots}${file});background-size:${1440 * scale}px ${900 * scale}px;background-position:${-ox * scale}px ${-oy * scale}px;${extra}"></div>`;

const img = (url: string, natW: number, natH: number, x: number, y: number, w: number, h: number, scale: number, ox: number, oy: number) =>
  `<div class="shot" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;background-image:url(${url});background-size:${natW * scale}px ${natH * scale}px;background-position:${-ox * scale}px ${-oy * scale}px"></div>`;

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
async function engaged(scale: number): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: scale });
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
  await page.waitForFunction('typeof window.__artemis === "function"');
  await page.getByRole('textbox', { name: 'Web App' }).fill(site);
  await page.getByRole('button', { name: 'Engage', exact: true }).click();
  await page.waitForFunction('window.__artemis().engaged === true');
  await page.waitForTimeout(6000);
  return page;
}
const settled = (page: Page) => page.waitForFunction('window.__artemis().viewTransition === null', { timeout: 5000 });
const tour = async (page: Page) => { await page.keyboard.press('x'); for (let i = 0; i < 7; i++) { await page.keyboard.press('f'); await page.waitForTimeout(110); } };
// 1. The dive, recorded first, on a fresh browser: Browser -> Cosmos on the current page -> the whole network -> Browser.
if (!skipDive) {
  const page = await engaged(1);
  const cdp = await page.context().newCDPSession(page);
  const frames: { file: string; t: number }[] = [];
  await mkdir(`${work}/frames`);
  cdp.on('Page.screencastFrame', async (f: { data: string; sessionId: number; metadata: { timestamp: number } }) => {
    const file = `f${String(frames.length).padStart(5, '0')}.jpg`;
    frames.push({ file, t: f.metadata.timestamp });
    await writeFile(`${work}/frames/${file}`, Buffer.from(f.data, 'base64'));
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1440, maxHeight: 900, everyNthFrame: 1 });
  await page.waitForTimeout(1200);
  await page.keyboard.press('v');
  await settled(page);
  await page.waitForTimeout(1600);
  await tour(page);
  await page.waitForTimeout(2600);
  await page.keyboard.press('v');
  await settled(page);
  await page.waitForTimeout(1300);
  await cdp.send('Page.stopScreencast');
  await page.waitForTimeout(300);
  const list = ['ffconcat version 1.0'];
  frames.forEach((f, i) => list.push(`file ${f.file}`, `duration ${((frames[i + 1]?.t ?? f.t + 0.1) - f.t).toFixed(4)}`));
  list.push(`file ${frames.at(-1)!.file}`);
  await writeFile(`${work}/frames/list.ffconcat`, list.join('\n'));
  sh(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', `${work}/frames/list.ffconcat`, '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', `${dir}dive.mp4`]);
  sh(['ffmpeg', '-y', '-loglevel', 'error', '-i', `${dir}dive.mp4`, '-vf', 'fps=12,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle', '-loop', '0', `${dir}dive.gif`]);
  const fps = frames.length / (frames.at(-1)!.t - frames[0].t);
  console.log(`dive: ${frames.length} frames, ${fps.toFixed(0)} fps captured`);
  if (fps < 40) console.warn('The machine is busy (captured under 40 fps, so the dive is choppy): run again when it is idle.');
  await page.close();
}

// 2. Stills of the console (device scale 2): the Browser view, the Cosmos whole with the panels folded.
{
  const page = await engaged(2);
  await page.screenshot({ path: `${work}/browser.png` });
  await page.keyboard.press('v');
  await settled(page);
  await page.waitForTimeout(2000);
  await tour(page);
  await page.waitForTimeout(2500);
  await page.keyboard.press('c');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${work}/cosmos-clean.png` });
  await page.close();
}

// 3. The hero and the features band.
const tile = (title: string, icon: string, key: string, text: string, visual: string) => `
  <div style="position:relative;display:flex;flex-direction:column;gap:16px">
    <div class="panel" style="position:relative;height:178px">${visual}<div class="brackets"></div></div>
    ${feature({ icon, key, title, text } as (typeof FEATURES)[number])}
  </div>`;
const notices = [['SESSION', 'Written as it happens'], ['HAR', 'Live and signed in'], ['VIDEO', 'Site and console']];
const sessionsVisual = `<div style="position:absolute;inset:0;padding:18px 18px 0;display:flex;flex-direction:column;gap:12px">
  <div class="banner" style="font-size:5.6px">${banner()}</div>
  ${notices.map(([t, m]) => `<div class="mono" style="font-size:11px;display:grid;grid-template-columns:14px 64px 1fr;color:${C.frost}"><span class="gold">◆</span><span style="color:${C.sky};font-weight:700">${t}</span><span style="font-family:T,sans-serif;font-size:12.5px">${m}</span></div>`).join('')}</div>`;

const pages: Record<string, { w: number; h: number; body: string }> = {
  hero: { w: 1280, h: 640, body: `
    ${crop('cosmos-clean.png', 440, 0, 840, 640, 1.0, 300, 70)}
    <div style="position:absolute;inset:0;background:linear-gradient(90deg, ${C.bg} 30%, color-mix(in srgb, ${C.bg} 70%, transparent) 47%, transparent 72%)"></div>
    <div style="position:absolute;left:64px;top:70px;width:600px;display:flex;flex-direction:column;gap:24px">
      <div style="display:flex;gap:14px;align-items:center"><div class="brand" style="font-size:20px">${mark(34)}Artemis</div><span class="chip">Open-source alpha</span></div>
      <div class="label" style="font-size:13px">Web intelligence console</div>
      <h1 style="font-size:54px">Understand the <em>depths</em> of a web application by using it.</h1>
      <p style="font-size:19px;line-height:1.45;color:${C.frost};max-width:540px">A genuine browser, an autopilot that flies the application, a live map of every page and flow, and sessions you can take to any tool.</p>
    </div>
    <div style="position:absolute;left:64px;bottom:44px">${foot('<i></i><span>macOS · Bun · Electron · Playwright</span>')}</div>
    <div class="label" style="position:absolute;right:32px;bottom:34px;font-size:10px;color:${C.sky}">Cosmos · emulated network</div>` },
  features: { w: 1280, h: 420, body: `
    <div style="position:absolute;left:48px;top:36px;right:48px;display:grid;grid-template-columns:repeat(4,1fr);gap:26px">
      ${tile('Genuine browser', 'radar', '', 'The site runs unmodified. Sign-in, MFA and dialogs behave as in Chrome.', crop('browser.png', 0, 0, 1000, 178, 0.36, 0, 40))}
      ${tile('Autopilot', 'yoke', 'D', 'Flies the application branch by branch while you watch.', img(`file://${docs}card-autopilot.png`, 532, 638, 0, 0, 400, 178, 0.95, 293, 116))}
      ${tile('Live cosmos', 'tree', 'V', 'Every page, flow and request mapped as it happens.', img(`file://${docs}cosmos-recorded.png`, 1440, 900, 0, 0, 400, 178, 0.62, 520, 230))}
      ${tile('Open sessions', 'save', '', 'SQLite, HAR and video. Reuse them in your own tools.', sessionsVisual)}
    </div>` }
};
for (const [name, v] of Object.entries(pages)) {
  const file = `${work}/${name}.html`;
  await Bun.write(file, page(v.w, v.h, v.body));
  const p = await browser.newPage({ viewport: { width: v.w, height: v.h }, deviceScaleFactor: 1.5 });
  await p.goto(`file://${file}`);
  await p.evaluate('document.fonts.ready');
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${dir}${name}.png` });
  await p.close();
  console.log(name);
}
await browser.close();
await rm(work, { recursive: true, force: true });
