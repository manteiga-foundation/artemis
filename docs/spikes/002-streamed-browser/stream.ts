// Spike 002 server side: the website runs as a real top-level tab in its own Chromium; its
// screencast goes to the console over a WebSocket (binary JPEG frames) and the console's mouse,
// wheel and keyboard come back, applied strictly in order.
import { chromium, type BrowserContext, type CDPSession, type Page } from 'playwright';
import type { ServerWebSocket } from 'bun';

export interface StreamOptions {
  profile: string;
  width?: number;
  height?: number;
  dpr?: number;
  quality?: number;
  headless?: boolean;
}

export interface SiteStream {
  port: number;
  wsUrl: string;
  context: BrowserContext;
  page(): Page;
  userAgent: string;
  goto(url: string): Promise<void>;
  stats: { framesOut: number; bytesOut: number; skipped: number; clients: number };
  close(): Promise<void>;
}

type Input =
  | { t: 'size'; w: number; h: number }
  | { t: 'move'; x: number; y: number }
  | { t: 'down' | 'up'; x: number; y: number; button: 'left' | 'middle' | 'right'; clickCount: number }
  | { t: 'wheel'; dx: number; dy: number }
  | { t: 'keydown' | 'keyup'; key: string; code: string }
  | { t: 'goto'; url: string }
  | { t: 'back' | 'forward' | 'reload' }
  | { t: 'text'; text: string };

export async function startSiteStream(o: StreamOptions): Promise<SiteStream> {
  const width = o.width ?? 1440;
  const height = o.height ?? 820;
  const dpr = o.dpr ?? 2;
  const quality = o.quality ?? 70;
  const context = await chromium.launchPersistentContext(o.profile, {
    headless: o.headless ?? true,
    channel: 'chromium', // the full browser in new headless mode, not the headless shell
    viewport: { width, height },
    deviceScaleFactor: dpr,
    ignoreDefaultArgs: ['--enable-automation'],
    args: [`--force-device-scale-factor=${dpr}`, '--disable-blink-features=AutomationControlled', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  });
  let page = context.pages()[0] ?? (await context.newPage());
  const rawUA = await page.evaluate(() => navigator.userAgent);
  const userAgent = rawUA.replace('HeadlessChrome', 'Chrome');

  const clients = new Set<ServerWebSocket<unknown>>();
  const stats = { framesOut: 0, bytesOut: 0, skipped: 0, clients: 0 };
  let lastFrame: Uint8Array | null = null;
  let cdp: CDPSession | null = null;
  const send = (m: object) => { const s = JSON.stringify(m); for (const c of clients) c.send(s); };

  async function attach(p: Page) {
    if (cdp) await cdp.detach().catch(() => {});
    page = p;
    cdp = await context.newCDPSession(p);
    await cdp.send('Emulation.setUserAgentOverride', { userAgent });
    cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      cdp?.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
      const jpeg = Buffer.from(data, 'base64');
      const frame = new Uint8Array(16 + jpeg.length);
      const dv = new DataView(frame.buffer);
      dv.setFloat64(0, (metadata.timestamp ?? 0) * 1000); // Chromium swap time, epoch ms
      dv.setFloat64(8, Date.now()); // server receipt, epoch ms
      frame.set(jpeg, 16);
      lastFrame = frame;
      for (const c of clients) {
        if (c.getBufferedAmount() > 4_000_000) { stats.skipped++; continue; } // a slow viewer drops frames, never queues them
        c.send(frame);
        stats.framesOut++;
        stats.bytesOut += frame.length;
      }
    });
    const vp = p.viewportSize() ?? { width, height };
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality, maxWidth: Math.round(vp.width * dpr), maxHeight: Math.round(vp.height * dpr), everyNthFrame: 1 });
    p.on('framenavigated', async (f) => { if (f === p.mainFrame()) send({ t: 'nav', url: f.url(), title: await p.title().catch(() => '') }); });
    p.on('dialog', (d) => { send({ t: 'dialog', type: d.type(), message: d.message() }); d.dismiss().catch(() => {}); });
    p.on('filechooser', () => send({ t: 'filechooser' }));
  }
  await attach(page);
  context.on('page', (p) => { send({ t: 'popup', url: p.url() }); attach(p); });

  // Input: one promise chain so down/up and key order are kept; consecutive moves collapse.
  let chain: Promise<unknown> = Promise.resolve();
  let pendingMove: { x: number; y: number } | null = null;
  const enqueue = (fn: () => Promise<unknown>) => { chain = chain.then(fn).catch((e) => console.error('input', String(e).slice(0, 160))); };
  const apply = (m: Input) => {
    switch (m.t) {
      case 'size':
        return enqueue(async () => {
          await page.setViewportSize({ width: m.w, height: m.h });
          await cdp?.send('Page.stopScreencast');
          await cdp?.send('Page.startScreencast', { format: 'jpeg', quality, maxWidth: Math.round(m.w * dpr), maxHeight: Math.round(m.h * dpr), everyNthFrame: 1 });
        });
      case 'move':
        if (pendingMove) { pendingMove = { x: m.x, y: m.y }; return; }
        pendingMove = { x: m.x, y: m.y };
        return enqueue(async () => { const p = pendingMove!; pendingMove = null; await page.mouse.move(p.x, p.y); });
      case 'down':
        return enqueue(async () => { await page.mouse.move(m.x, m.y); await page.mouse.down({ button: m.button, clickCount: m.clickCount }); });
      case 'up':
        return enqueue(async () => { await page.mouse.move(m.x, m.y); await page.mouse.up({ button: m.button, clickCount: m.clickCount }); });
      case 'wheel':
        return enqueue(() => page.mouse.wheel(m.dx, m.dy));
      case 'keydown':
        return enqueue(async () => {
          try { await page.keyboard.down(m.key); } catch { if (m.key.length === 1) await page.keyboard.insertText(m.key); }
        });
      case 'keyup':
        return enqueue(async () => { try { await page.keyboard.up(m.key); } catch {} });
      case 'goto':
        return enqueue(() => page.goto(m.url).catch(() => {}));
      case 'back':
        return enqueue(() => page.goBack().catch(() => {}));
      case 'forward':
        return enqueue(() => page.goForward().catch(() => {}));
      case 'reload':
        return enqueue(() => page.reload().catch(() => {}));
      case 'text':
        return enqueue(() => page.keyboard.insertText(m.text));
    }
  };

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req, srv) { return srv.upgrade(req) ? undefined : new Response('stream'); },
    websocket: {
      open(ws) {
        clients.add(ws); stats.clients = clients.size;
        // The screencast only emits on change: a reconnecting console gets the last frame at once.
        if (lastFrame) ws.send(lastFrame);
        ws.send(JSON.stringify({ t: 'nav', url: page.url(), title: '' }));
      },
      message(_ws, msg) { try { apply(JSON.parse(String(msg)) as Input); } catch {} },
      close(ws) { clients.delete(ws); stats.clients = clients.size; }
    }
  });

  return {
    port: server.port!,
    wsUrl: `ws://127.0.0.1:${server.port}`,
    context,
    page: () => page,
    userAgent,
    goto: async (url) => { await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {}); },
    stats,
    close: async () => { server.stop(true); await context.close(); }
  };
}

// Injected into the console page: replaces the iframe in the Browser view's slot with a canvas that
// shows the stream and forwards input. Records frame and input timings on window.__stream.
export const VIEWER = `(wsUrl) => {
  const slot = document.querySelector('.browser-slot');
  const frame = slot.querySelector('iframe');
  if (frame) frame.style.display = 'none';
  const canvas = document.createElement('canvas');
  canvas.className = 'stream-canvas';
  canvas.tabIndex = 0;
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', outline: 'none', background: 'transparent' });
  slot.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const st = window.__stream = { frames: 0, bytes: 0, arrivals: [], chromeToViewer: [], serverToViewer: [], decode: [], drawn: 0, keyLat: [], nav: null, events: [] };
  const ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';
  const send = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
  ws.onopen = () => { const r = slot.getBoundingClientRect(); send({ t: 'size', w: Math.round(r.width), h: Math.round(r.height) }); };
  let pending = null, busy = false, keyAt = null;
  ws.onmessage = async (e) => {
    if (typeof e.data === 'string') {
      const m = JSON.parse(e.data); st.events.push(m);
      if (m.t === 'nav') { st.nav = m.url; const u = document.querySelector('.browser-url'); if (u) u.textContent = m.url; }
      return;
    }
    const dv = new DataView(e.data); const now = Date.now();
    st.frames++; st.bytes += e.data.byteLength; st.arrivals.push(performance.now());
    if (dv.getFloat64(0) > 0) st.chromeToViewer.push(now - dv.getFloat64(0));
    st.serverToViewer.push(now - dv.getFloat64(8));
    if (keyAt !== null) { st.keyLat.push(performance.now() - keyAt); keyAt = null; }
    pending = e.data; if (busy) return; busy = true;
    while (pending) {
      const buf = pending; pending = null; const t0 = performance.now();
      const bmp = await createImageBitmap(new Blob([new Uint8Array(buf, 16)], { type: 'image/jpeg' }));
      if (canvas.width !== bmp.width || canvas.height !== bmp.height) { canvas.width = bmp.width; canvas.height = bmp.height; }
      ctx.drawImage(bmp, 0, 0); bmp.close();
      st.decode.push(performance.now() - t0); st.drawn++;
    }
    busy = false;
  };
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const btn = (b) => ['left', 'middle', 'right'][b] || 'left';
  canvas.addEventListener('mousemove', (e) => send({ t: 'move', ...pos(e) }));
  canvas.addEventListener('mousedown', (e) => { canvas.focus(); send({ t: 'down', ...pos(e), button: btn(e.button), clickCount: e.detail || 1 }); e.preventDefault(); });
  canvas.addEventListener('mouseup', (e) => send({ t: 'up', ...pos(e), button: btn(e.button), clickCount: e.detail || 1 }));
  canvas.addEventListener('wheel', (e) => { send({ t: 'wheel', dx: e.deltaX, dy: e.deltaY }); e.preventDefault(); }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('keydown', (e) => {
    e.stopPropagation();
    // Browser shortcuts act on the site tab: Cmd+[ back, Cmd+] forward, Cmd+R reload. Cmd+V is left
    // to the browser so the paste event below carries the system clipboard into the site.
    if (e.metaKey && (e.key === '[' || e.key === ']' || e.key === 'r')) { e.preventDefault(); send({ t: e.key === '[' ? 'back' : e.key === ']' ? 'forward' : 'reload' }); return; }
    if (e.metaKey && e.key === 'v') return;
    keyAt = performance.now(); send({ t: 'keydown', key: e.key, code: e.code }); e.preventDefault();
  });
  canvas.addEventListener('paste', (e) => { const text = e.clipboardData && e.clipboardData.getData('text/plain'); if (text) send({ t: 'text', text }); e.preventDefault(); });
  canvas.addEventListener('keyup', (e) => { send({ t: 'keyup', key: e.key, code: e.code }); e.preventDefault(); e.stopPropagation(); });
  window.__streamSend = send;
  return true;
}`;
