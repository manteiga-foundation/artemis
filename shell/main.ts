// Artemis's owned browser: an Electron shell.
//
// The website under review is a native, genuine Chromium page (a WebContentsView filling the
// console's slot); the console is the unchanged Artemis app in a frameless, transparent child
// window exactly over the content area. The console tells the shell where the slot is and whether
// a click is the site's (over the site, mouse events pass through to it; over the console's panels
// they stay). Nothing of Artemis runs in the site's page except shell/site-preload.ts, in an
// isolated world. Launched by server/shell.ts (Playwright's Electron mode), which also owns
// automation, video and tracing.
//
// Environment: ARTEMIS_APP_URL (the console), ARTEMIS_USER_DATA (profile: cookies, logins),
// ARTEMIS_SHELL_HIDDEN=1 (tests: windows never shown).
import { app, BaseWindow, BrowserWindow, Menu, WebContentsView, ipcMain } from 'electron';
import path from 'node:path';

const APP_URL = process.env.ARTEMIS_APP_URL ?? 'http://127.0.0.1:5173';
// Where the bundled preloads are (the bundler bakes the source folder into __dirname, so the
// launcher says where the bundle is; Electron's app path is the folder of main.cjs otherwise).
const SHELL_DIR = process.env.ARTEMIS_SHELL_DIR ?? app.getAppPath();
const HIDDEN = process.env.ARTEMIS_SHELL_HIDDEN === '1';
if (process.env.ARTEMIS_USER_DATA) app.setPath('userData', process.env.ARTEMIS_USER_DATA);
// Sites see Chrome, not Electron.
app.userAgentFallback = app.userAgentFallback.replace(/ Electron\/\S+/, '').replace(/ artemis\/\S+/i, '');

interface Layout {
  visible: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Read by tests through Playwright (`app.evaluate`). */
const state = { passThrough: false, siteVisible: false, editable: false, layout: null as Layout | null, siteUrl: '' };
(globalThis as unknown as { __artemisShell: typeof state }).__artemisShell = state;

const HOTKEY_NAMED = new Set(['Escape', 'ArrowLeft', 'ArrowRight']);

app.whenReady().then(() => {
  const win = new BaseWindow({ width: 1440, height: 900, title: 'Artemis', backgroundColor: '#02061a', show: !HIDDEN });
  const site = new WebContentsView({
    webPreferences: { preload: path.join(SHELL_DIR, 'site-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegrationInSubFrames: true }
  });
  win.contentView.addChildView(site);
  site.setVisible(false);
  // Playwright's page setup waits on a web contents that has never navigated.
  void site.webContents.loadURL('about:blank');

  const consoleWin = new BrowserWindow({
    parent: win,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    show: !HIDDEN,
    webPreferences: { preload: path.join(SHELL_DIR, 'console-preload.cjs'), contextIsolation: true }
  });
  const fit = () => consoleWin.setBounds(win.getContentBounds());
  fit();
  win.on('resize', fit);
  win.on('move', fit);
  win.on('closed', () => app.quit());
  void consoleWin.loadURL(`${APP_URL}/?owned=1`);

  const toConsole = (channel: string, ...args: unknown[]) => {
    if (!consoleWin.isDestroyed()) consoleWin.webContents.send(channel, ...args);
  };
  const reportNav = () => {
    const url = site.webContents.getURL();
    state.siteUrl = url;
    if (url && url !== 'about:blank') toConsole('site-nav', { url, title: site.webContents.getTitle() });
  };
  // A reloaded console learns where the site already is.
  consoleWin.webContents.on('did-finish-load', reportNav);
  site.webContents.on('did-navigate', reportNav);
  site.webContents.on('did-navigate-in-page', (_e, _url, isMainFrame) => isMainFrame && reportNav());
  site.webContents.on('page-title-updated', reportNav);
  // A navigation drops the old page's focus without a focusout: each page starts not editable.
  site.webContents.on('did-start-navigation', (d) => {
    if (d.isMainFrame && !d.isSameDocument) state.editable = false;
  });

  ipcMain.on('layout', (_e, l: Layout) => {
    state.layout = l;
    state.siteVisible = !!l.visible;
    if (l.visible) site.setBounds({ x: Math.round(l.x), y: Math.round(l.y), width: Math.round(l.w), height: Math.round(l.h) });
    site.setVisible(!!l.visible);
    if (!l.visible && state.passThrough) {
      state.passThrough = false;
      consoleWin.setIgnoreMouseEvents(false);
    }
  });
  ipcMain.on('navigate', (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) void site.webContents.loadURL(url);
  });
  ipcMain.on('pass-through', (_e, through: boolean) => {
    state.passThrough = !!through && state.siteVisible;
    consoleWin.setIgnoreMouseEvents(state.passThrough, { forward: true });
  });
  ipcMain.on('site-editable', (_e, editable: boolean) => {
    state.editable = !!editable;
  });
  ipcMain.on('site-hotkey', (_e, key: string) => {
    if (typeof key === 'string' && (key.length === 1 || HOTKEY_NAMED.has(key))) toConsole('site-key', key);
  });

  // The right-click menu a browser has.
  site.webContents.on('context-menu', (_e, p) => {
    const wc = site.webContents;
    Menu.buildFromTemplate([
      { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
      { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
      { label: 'Reload', click: () => wc.reload() },
      { type: 'separator' },
      { role: 'cut', enabled: p.editFlags.canCut },
      { role: 'copy', enabled: p.editFlags.canCopy },
      { role: 'paste', enabled: p.editFlags.canPaste },
      { type: 'separator' },
      { label: 'Inspect Element', click: () => wc.inspectElement(p.x, p.y) }
    ]).popup();
  });
});

app.on('window-all-closed', () => app.quit());
