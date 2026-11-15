// Spike 005, the Xwayland crash: a transparent frameless child window over a base window, as the
// shell has them, then setIgnoreMouseEvents(true) after load. Prints what happened and quits.
const { app, BaseWindow, BrowserWindow } = require('electron');
const step = (s) => console.log('STEP ' + s);
app.whenReady().then(async () => {
  const base = new BaseWindow({ width: 800, height: 600, backgroundColor: '#02061a' });
  const top = new BrowserWindow({ parent: base, frame: false, transparent: process.env.T !== '0', hasShadow: false, resizable: false });
  top.setBounds(base.getContentBounds());
  await top.loadURL('data:text/html,<body style="background:transparent"><h1 style="color:white">console</h1></body>');
  step('loaded');
  await new Promise((r) => setTimeout(r, 1000));
  top.setIgnoreMouseEvents(true, { forward: process.env.F === '1' });
  step('ignoring');
  await new Promise((r) => setTimeout(r, 2000));
  top.setIgnoreMouseEvents(false);
  step('taking clicks back');
  await new Promise((r) => setTimeout(r, 1500));
  step('alive');
  app.quit();
});
app.on('child-process-gone', (_e, d) => step('child gone ' + JSON.stringify(d)));
