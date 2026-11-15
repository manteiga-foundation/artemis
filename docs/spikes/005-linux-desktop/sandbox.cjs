// Spike 005, sandbox: does Electron start with Chromium's sandbox on (no --no-sandbox), and are
// the site's renderers sandboxed? Prints one line and quits.
const { app, BrowserWindow } = require('electron');
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  await w.loadURL('data:text/html,<p>sandbox</p>');
  const metrics = app.getAppMetrics().map((m) => ({ type: m.type, sandboxed: m.sandboxed, integrity: m.integrityLevel }));
  console.log('SANDBOX ' + JSON.stringify({ noSandboxSwitch: app.commandLine.hasSwitch('no-sandbox'), metrics }));
  app.quit();
});
