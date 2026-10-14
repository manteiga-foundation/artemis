// Spike 004: Artemis without Electron. One Bun process serves the built console, owns a headless
// Chromium (Playwright) for the website, records the session with the real recorder, flies it with
// the real autopilot, and feeds the console over a WebSocket where the Electron shell used IPC.
// The recorder, autopilot and dialogs code is untouched: they get a small object standing in for
// Playwright's ElectronApplication (its context, and `evaluate` run in this process, where the
// shell's `__artemisActions` queue and `__artemisAutopilot` state live).
//
//   bun run docs/spikes/004-container/serve.ts     (PORT, HOST, ARTEMIS_SESSIONS_DIR, FIXTURE_PORT)
import { chromium, type BrowserContext, type ElectronApplication, type Page } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { startRecorder } from '../../../server/recorder';
import { startAutopilot, type AutopilotEvent } from '../../../server/autopilot-driver';
import { watchSiteDialogs } from '../../../server/site-dialogs';
import { actorAt, createAutopilot, onSiteInput, setActing, setSpeed } from '../../../shell/autopilot-state';
import type { SiteEvent } from '../../../src/site-events';
import { startFixture } from './fixture';

const ROOT = new URL('../../../', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PORT ?? 5173);
const HOST = process.env.HOST ?? '0.0.0.0';
const SESSIONS = process.env.ARTEMIS_SESSIONS_DIR ?? join(ROOT, 'data', 'sessions');
const startedAt = Date.now();

// ---------------------------------------------------------------- bundles: the console shim and the site preload
const build = async (entry: string, electronShim = false) => {
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, entry)],
    target: 'browser',
    format: 'iife',
    plugins: electronShim
      ? [
          {
            name: 'electron-to-binding',
            setup(b) {
              // The preload's `ipcRenderer.send` becomes a Playwright binding (exposeBinding below).
              b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron-shim', namespace: 'shim' }));
              b.onLoad({ filter: /.*/, namespace: 'shim' }, () => ({
                contents: 'export const ipcRenderer = { send: (channel, payload) => window.__artemisIpc(channel, payload) };',
                loader: 'js'
              }));
            }
          }
        ]
      : []
  });
  if (!result.success) throw new Error(`${entry} failed to build:\n${result.logs.join('\n')}`);
  return result.outputs[0].text();
};
const [shimJs, preloadJs] = await Promise.all([build('shim.ts'), build('../../../shell/site-preload.ts', true)]);
const indexHtml = (await Bun.file(join(DIST, 'index.html')).text()).replace('<head>', '<head><script>' + shimJs + '</script>');

// ---------------------------------------------------------------- the website's browser
await mkdir(SESSIONS, { recursive: true });
const fixture = startFixture(Number(process.env.FIXTURE_PORT ?? 5180));
const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
const context: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const site: Page = await context.newPage();
await site.goto('about:blank');

// What the Electron shell's main process held (shell/main.ts), here in Bun.
const state = createAutopilot();
const actions: unknown[] = [];
(globalThis as unknown as { __artemisActions: unknown[] }).__artemisActions = actions;
(globalThis as unknown as { __artemisAutopilot: unknown }).__artemisAutopilot = {
  speed: () => state.speed,
  acting: (on: boolean) => setActing(state, on, Date.now()),
  land: () => setSpeed(state, 0),
  report: (status: unknown) => broadcast('autopilot-status', status)
};
let actionsReported = 0;
await context.exposeBinding('__artemisIpc', (_source, channel: string, payload: { t?: number } & Record<string, unknown>) => {
  if (channel === 'site-action' && payload && actions.length < 10_000) {
    actionsReported++;
    actions.push({ ...payload, actor: actorAt(state, Number(payload.t) || Date.now()) });
  }
  if (channel === 'site-input' && onSiteInput(state, Number(payload?.t) || Date.now())) broadcast('autopilot-status', { speed: 0, event: 'disengaged' });
});
await context.addInitScript(preloadJs);

const app = {
  context: () => context,
  evaluate: (fn: (electron: unknown, arg: unknown) => unknown, arg?: unknown) => Promise.resolve().then(() => fn({}, arg))
} as unknown as ElectronApplication;

const recorder = startRecorder({ app, site, sessionsDir: SESSIONS, har: process.env.ARTEMIS_HAR !== '0' });
const flight: (AutopilotEvent & { at: number })[] = [];
const autopilot = startAutopilot({ app, site, recorder, onEvent: (e) => flight.push({ ...e, at: Date.now() }) });
watchSiteDialogs({ app, flying: () => autopilot.flying(), onAnswered: (text) => autopilot.answered(text) });

// ---------------------------------------------------------------- the console's feed
type Socket = { send(data: string): void; readyState: number };
const clients = new Set<Socket>();
const broadcast = (type: string, value: unknown) => {
  const text = JSON.stringify({ type, value });
  for (const c of clients) if (c.readyState === 1) c.send(text);
};
let nav = { url: 'about:blank', title: '' };
const reportNav = async () => {
  nav = { url: site.url(), title: await site.title().catch(() => '') };
  broadcast('site-nav', nav);
};
site.on('framenavigated', (f) => f === site.mainFrame() && (broadcast('site-load', 'commit'), void reportNav()));
site.on('request', (r) => r.isNavigationRequest() && r.frame() === site.mainFrame() && broadcast('site-load', 'start'));
site.on('domcontentloaded', () => broadcast('site-load', 'dom'));
site.on('load', () => (broadcast('site-load', 'done'), void reportNav()));

let buffer: SiteEvent[] = [];
recorder.onEvent((e) => buffer.push(e));
const sendSite = (c: Socket, events: SiteEvent[]) => c.readyState === 1 && c.send(JSON.stringify({ type: 'site', events, sentAt: Date.now() }));
setInterval(() => {
  if (!buffer.length) return;
  const batch = buffer;
  buffer = [];
  for (const c of clients) sendSite(c, batch);
}, 150);

// ---------------------------------------------------------------- HTTP + WebSocket
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.mp3': 'audio/mpeg', '.webm': 'video/webm' };

const server = Bun.serve<{ id: number }>({
  hostname: HOST,
  port: PORT,
  async fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === '/feed') return srv.upgrade(req, { data: { id: Date.now() } }) ? undefined : new Response('upgrade failed', { status: 400 });
    if (url.pathname === '/api/state')
      return Response.json({
        startedAt,
        uptimeMs: Date.now() - startedAt,
        site: nav,
        speed: state.speed,
        database: recorder.path(),
        har: recorder.harPath(),
        actions: actionsReported,
        flight,
        clients: clients.size,
        fixture: fixture.url,
        platform: process.platform,
        arch: process.arch,
        bun: Bun.version
      });
    if (url.pathname === '/api/snapshot') return Response.json(recorder.snapshot());
    const ext = extname(url.pathname);
    if (!ext || url.pathname === '/index.html') return new Response(indexHtml, { headers: { 'content-type': 'text/html' } });
    const file = Bun.file(join(DIST, url.pathname));
    if (!(await file.exists())) return new Response('not found', { status: 404 });
    return new Response(file, { headers: { 'content-type': TYPES[ext] ?? 'application/octet-stream' } });
  },
  websocket: {
    open(ws) {
      clients.add(ws);
    },
    close(ws) {
      clients.delete(ws);
    },
    async message(ws, raw) {
      const msg = JSON.parse(String(raw)) as { type: string; url?: string; speed?: number };
      switch (msg.type) {
        case 'hello':
          // A console that (re)loads: the whole session so far, then the live events (server/site-feed.ts).
          sendSite(ws, [{ type: 'reset' }, ...recorder.snapshot()]);
          ws.send(JSON.stringify({ type: 'site-nav', value: nav }));
          break;
        case 'navigate':
          if (msg.url) await site.goto(msg.url).catch(() => {});
          break;
        case 'back':
          await site.goBack().catch(() => {});
          break;
        case 'forward':
          await site.goForward().catch(() => {});
          break;
        case 'reload':
          await site.reload().catch(() => {});
          break;
        case 'autopilot':
          setSpeed(state, Number(msg.speed));
          break;
      }
    }
  }
});

console.log(`ARTEMIS  console http://${HOST}:${server.port}  fixture ${fixture.url}  sessions ${SESSIONS}  (${process.platform}/${process.arch}, Bun ${Bun.version})`);

const quit = async () => {
  await autopilot.stop();
  await recorder.stop();
  await browser.close().catch(() => {});
  server.stop(true);
  fixture.stop();
  process.exit(0);
};
process.on('SIGINT', () => void quit());
process.on('SIGTERM', () => void quit());
