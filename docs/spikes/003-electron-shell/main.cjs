// Spike 003: Artemis as an Electron shell. The website is a native, genuine Chromium page (a
// WebContentsView in the app window); the unchanged Artemis console is a transparent window on top
// of it. The console passes clicks through wherever the pointer is over the site and keeps them
// over its panels. Nothing of ours runs in the site's page except an isolated-world preload that
// reports whether focus is in an editable field (for hotkeys).
const { app, BaseWindow, BrowserWindow, WebContentsView, ipcMain, Menu, session } = require('electron');
const path = require('node:path');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5179';
if (process.env.CDP_PORT) app.commandLine.appendSwitch('remote-debugging-port', process.env.CDP_PORT);
// Sites see Chrome, not Electron.
app.userAgentFallback = app.userAgentFallback.replace(/ Electron\/\S+/, '').replace(/ artemis-spike-003\S*/i, '');

const state = (global.__shell = { passThrough: false, siteVisible: false, editable: false, layout: null, keysForwarded: 0, inputEvents: 0 });

// The console stays as it is; only its backdrop opens where the site shows through.
const OVERLAY_CSS = `
  html, body, #root { background: transparent !important; }
  .app[data-shown='browser'] .bg-layer { visibility: hidden; }
  .browser-slot iframe { display: none !important; }
`;

// Runs in the console page: report the slot rect and the engaged address, and decide per mouse
// move whether the pointer is over a panel (keep clicks) or over the site (let them through).
const SHELL_AGENT = `(() => {
  if (window.__shellAgent) return; window.__shellAgent = true;
  const PANELS = '.hud-header, .browser-bar, .hud-bottom > *, .boot, [role="dialog"]';
  let last = '', lastUrl = null, siteVisible = false, pass = null;
  const tick = () => {
    const s = window.__artemis ? window.__artemis() : null;
    const slot = document.querySelector('.browser-slot');
    siteVisible = !!(s && s.engaged && s.stageView === 'browser' && !s.viewTransition && slot);
    const r = slot ? slot.getBoundingClientRect() : { x: 0, y: 0, width: 0, height: 0 };
    const key = [siteVisible, Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(',');
    if (key !== last) { last = key; window.artemisShell.layout({ visible: siteVisible, x: r.x, y: r.y, w: r.width, h: r.height }); }
    if (s && s.engaged && s.targetUrl && s.targetUrl !== lastUrl) { lastUrl = s.targetUrl; window.artemisShell.navigate(s.targetUrl); }
    if (!siteVisible && pass) { pass = false; window.artemisShell.passThrough(false); }
  };
  setInterval(tick, 50); tick();
  document.addEventListener('mousemove', (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const over = siteVisible && !(el && el.closest(PANELS));
    if (over !== pass) { pass = over; window.artemisShell.passThrough(over); }
  }, true);
  window.artemisShell.onSiteNav((url) => { const u = document.querySelector('.browser-url'); if (u) u.textContent = url; });
  window.artemisShell.onKey((key) => window.postMessage({ type: 'artemis:key', key }, '*'));
})();`;

app.whenReady().then(() => {
  const win = new BaseWindow({ width: 1440, height: 900, title: 'Artemis', backgroundColor: '#02061a', show: true });
  const site = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'site-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegrationInSubFrames: true }
  });
  win.contentView.addChildView(site);
  site.setVisible(false);
  site.webContents.loadURL('about:blank');

  const overlay = new BrowserWindow({
    parent: win, frame: false, transparent: true, hasShadow: false, resizable: false,
    webPreferences: { preload: path.join(__dirname, 'overlay-preload.cjs'), contextIsolation: true }
  });
  const fit = () => overlay.setBounds(win.getContentBounds());
  fit();
  win.on('resize', fit);
  win.on('move', fit);
  win.on('closed', () => app.quit());

  // The console's own iframe never loads the site; the native view shows it instead.
  overlay.webContents.session.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (d, cb) => cb({ cancel: d.resourceType === 'subFrame' && d.webContentsId === overlay.webContents.id }));
  overlay.webContents.on('did-finish-load', async () => {
    await overlay.webContents.insertCSS(OVERLAY_CSS);
    await overlay.webContents.executeJavaScript(SHELL_AGENT).catch((e) => console.error('agent', e));
  });
  overlay.loadURL(`${APP_URL}/?owned=1&shell=electron`);

  ipcMain.on('layout', (_e, l) => {
    state.layout = l;
    state.siteVisible = !!l.visible;
    if (l.visible) site.setBounds({ x: Math.round(l.x), y: Math.round(l.y), width: Math.round(l.w), height: Math.round(l.h) });
    site.setVisible(!!l.visible);
  });
  ipcMain.on('navigate', (_e, url) => site.webContents.loadURL(url));
  ipcMain.on('pass', (_e, pass) => { state.passThrough = !!pass; overlay.setIgnoreMouseEvents(!!pass, { forward: true }); });
  ipcMain.on('site-editable', (_e, v) => { state.editable = !!v; });
  ipcMain.on('site-hotkey', (_e, key) => { state.keysForwarded++; overlay.webContents.send('site-key', key); });

  const sendNav = (url) => overlay.webContents.send('site-nav', url);
  site.webContents.on('did-navigate', (_e, url) => sendNav(url));
  site.webContents.on('did-navigate-in-page', (_e, url, isMain) => isMain && sendNav(url));

  // Hotkeys typed in the site reach the console unless focus is in a field (site-preload.cjs).
  // A navigation drops the old page's focus without a focusout: start each page as not editable.
  site.webContents.on('did-start-navigation', (d) => { if (d.isMainFrame && !d.isSameDocument) state.editable = false; });
  site.webContents.on('before-input-event', (_e, input) => {
    state.inputEvents++; // native keyboard only; hotkeys are forwarded by the preload (native and automated)
  });

  // The native right-click menu a browser has.
  site.webContents.on('context-menu', (_e, p) => {
    const wc = site.webContents;
    Menu.buildFromTemplate([
      { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
      { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
      { label: 'Reload', click: () => wc.reload() },
      { type: 'separator' },
      { role: 'cut', enabled: p.editFlags.canCut }, { role: 'copy', enabled: p.editFlags.canCopy }, { role: 'paste', enabled: p.editFlags.canPaste },
      { type: 'separator' },
      { label: 'Inspect Element', click: () => wc.inspectElement(p.x, p.y) }
    ]).popup();
  });
});

app.on('window-all-closed', () => app.quit());
