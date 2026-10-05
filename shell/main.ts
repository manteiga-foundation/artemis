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
// ARTEMIS_SHELL_HIDDEN=1 (tests: windows never shown), ARTEMIS_GRACEFUL_QUIT=1 (a session is
// recorded: quitting goes through Artemis so the recording is saved whole).
import { app, BaseWindow, BrowserWindow, Menu, WebContentsView, ipcMain } from 'electron';
import path from 'node:path';
import { actorAt, createAutopilot, onSiteInput, setActing, setSpeed } from './autopilot-state';

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
const state = {
  passThrough: false,
  siteVisible: false,
  editable: false,
  layout: null as Layout | null,
  siteUrl: '',
  /** The operator closed the window or quit; Artemis saves the session, then lets the shell go. */
  quitRequested: false,
  /** The autopilot: the speed the console set and when it is acting (server/autopilot-driver.ts flies). */
  autopilot: createAutopilot()
};
(globalThis as unknown as { __artemisShell: typeof state }).__artemisShell = state;

// While a session is recorded (ARTEMIS_GRACEFUL_QUIT=1) the shell never quits by itself: closing
// the window or Cmd+Q hides it and asks Artemis (server/shell.ts) to close it, because only that
// close writes the HAR and finishes the videos. If no one answers, it quits on its own anyway.
const GRACEFUL_QUIT = process.env.ARTEMIS_GRACEFUL_QUIT === '1';
const QUIT_FALLBACK_MS = 15_000;
let quitApproved = !GRACEFUL_QUIT;
(globalThis as unknown as { __artemisApproveQuit: () => void }).__artemisApproveQuit = () => {
  quitApproved = true;
};
const requestQuit = () => {
  for (const w of BaseWindow.getAllWindows()) w.hide();
  if (state.quitRequested) return;
  state.quitRequested = true;
  setTimeout(() => {
    quitApproved = true;
    app.quit();
  }, QUIT_FALLBACK_MS).unref();
};
app.on('before-quit', (e) => {
  if (quitApproved) return;
  e.preventDefault();
  requestQuit();
});

/** The operator's actions reported by the site preload, drained by the recorder (server/recorder.ts). */
const actions: unknown[] = [];
(globalThis as unknown as { __artemisActions: unknown[] }).__artemisActions = actions;
const MAX_QUEUED_ACTIONS = 10_000;

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
  win.on('close', (e) => {
    if (quitApproved) return;
    e.preventDefault();
    requestQuit();
  });
  // Cmd+W lands on the console, the frontmost window: closing it is closing Artemis.
  consoleWin.on('close', (e) => {
    if (quitApproved) return;
    e.preventDefault();
    requestQuit();
  });
  win.on('closed', () => app.quit());
  void consoleWin.loadURL(`${APP_URL}/?owned=1`);

  const toConsole = (channel: string, ...args: unknown[]) => {
    if (!consoleWin.isDestroyed()) consoleWin.webContents.send(channel, ...args);
  };
  // The site view starts on about:blank before Engage: that entry is not somewhere to go back to.
  const canGoBack = () => {
    const h = site.webContents.navigationHistory;
    return h.canGoBack() && h.getEntryAtIndex(h.getActiveIndex() - 1)?.url !== 'about:blank';
  };
  const reportNav = () => {
    const url = site.webContents.getURL();
    state.siteUrl = url;
    if (url && url !== 'about:blank')
      toConsole('site-nav', { url, title: site.webContents.getTitle(), canGoBack: canGoBack(), canGoForward: site.webContents.navigationHistory.canGoForward() });
  };
  // A reloaded console learns where the site already is.
  consoleWin.webContents.on('did-finish-load', reportNav);
  site.webContents.on('did-navigate', reportNav);
  site.webContents.on('did-navigate-in-page', (_e, _url, isMainFrame) => isMainFrame && reportNav());
  site.webContents.on('page-title-updated', reportNav);
  // Links aimed at a new tab (target="_blank", window.open without features) load in the site view
  // until the shell has tabs; a bare window would leave the console behind. Windows asked for with
  // features stay popups: that is how sign-in popups (Microsoft, Google) work.
  site.webContents.setWindowOpenHandler(({ url, disposition }) => {
    if (disposition === 'new-window') return { action: 'allow' };
    if (/^https?:\/\//i.test(url)) void site.webContents.loadURL(url);
    return { action: 'deny' };
  });
  // A navigation drops the old page's focus without a focusout: each page starts not editable.
  // Page loading, for the address field's progress bar (src/page-load.ts): a new page starts,
  // its document commits, its DOM is ready, loading stops. A load cut short by a newer one
  // (ERR_ABORTED) is not a failure: the newer one has already started its bar.
  site.webContents.on('did-start-navigation', (d) => {
    if (!d.isMainFrame || d.isSameDocument) return;
    state.editable = false;
    toConsole('site-load', 'start');
  });
  site.webContents.on('did-navigate', () => toConsole('site-load', 'commit'));
  site.webContents.on('dom-ready', () => toConsole('site-load', 'dom'));
  site.webContents.on('did-stop-loading', () => toConsole('site-load', 'done'));
  site.webContents.on('did-fail-load', (_e, code, _text, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) toConsole('site-load', 'fail');
  });

  // Click pass-through: the console says whether it wants clicks to go to the site; they do only
  // while the site is visible. Remembering the wish makes the order of 'layout' and
  // 'pass-through' irrelevant (asked before the site showed, it used to be refused while the
  // console believed it on).
  let passThroughWanted = false;
  const applyPassThrough = () => {
    const on = passThroughWanted && state.siteVisible;
    if (on === state.passThrough) return;
    state.passThrough = on;
    consoleWin.setIgnoreMouseEvents(on, { forward: true });
  };
  ipcMain.on('layout', (_e, l: Layout) => {
    state.layout = l;
    state.siteVisible = !!l.visible;
    if (l.visible) site.setBounds({ x: Math.round(l.x), y: Math.round(l.y), width: Math.round(l.w), height: Math.round(l.h) });
    site.setVisible(!!l.visible);
    applyPassThrough();
  });
  ipcMain.on('navigate', (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) void site.webContents.loadURL(url);
  });
  // The console's Back, Forward and Reload buttons (the right-click menu does the same).
  ipcMain.on('site-go', (_e, where: string) => {
    const wc = site.webContents;
    if (where === 'back' && canGoBack()) wc.navigationHistory.goBack();
    else if (where === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    else if (where === 'reload') wc.reload();
  });
  ipcMain.on('pass-through', (_e, through: boolean) => {
    passThroughWanted = !!through;
    applyPassThrough();
  });
  // While clicks pass through, the console hears the pointer only through macOS forwarding, which
  // can stop (after a click in the site). The site's own pointer reports go to the console then,
  // so it can take the clicks back under a panel or when the pointer leaves the site view.
  ipcMain.on('site-pointer', (e, p: unknown) => {
    if (e.sender === site.webContents && state.passThrough) toConsole('site-pointer', p);
  });
  ipcMain.on('site-editable', (_e, editable: boolean) => {
    state.editable = !!editable;
  });
  ipcMain.on('site-hotkey', (_e, key: string) => {
    if (typeof key === 'string' && (key.length === 1 || HOTKEY_NAMED.has(key))) toConsole('site-key', key);
  });
  ipcMain.on('site-action', (e, action: { t?: number } | null) => {
    if (e.sender !== site.webContents || !action || actions.length >= MAX_QUEUED_ACTIONS) return;
    // The autopilot's own clicks are its own; everything else is the operator's.
    actions.push({ ...action, actor: actorAt(state.autopilot, Number(action.t) || Date.now()) });
  });

  // The autopilot. The console sets the speed; the driver on the Bun side reads it, marks when it
  // acts, and reports the flight, which goes on to the console.
  ipcMain.on('autopilot', (_e, speed: number) => setSpeed(state.autopilot, Number(speed)));
  // The operator touching the site while it flies takes the controls back.
  ipcMain.on('site-input', (e, input: { t?: number } | null) => {
    if (e.sender !== site.webContents) return;
    if (onSiteInput(state.autopilot, Number(input?.t) || Date.now())) toConsole('autopilot-status', { speed: 0, event: 'disengaged' });
  });
  (globalThis as unknown as { __artemisAutopilot: unknown }).__artemisAutopilot = {
    speed: () => state.autopilot.speed,
    acting: (on: boolean) => setActing(state.autopilot, on, Date.now()),
    /** The flight ended (the site covered, stuck): off. */
    land: () => setSpeed(state.autopilot, 0),
    report: (status: unknown) => toConsole('autopilot-status', status)
  };

  // The right-click menu a browser has.
  site.webContents.on('context-menu', (_e, p) => {
    const wc = site.webContents;
    Menu.buildFromTemplate([
      { label: 'Back', enabled: canGoBack(), click: () => canGoBack() && wc.navigationHistory.goBack() },
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
