// The console's bridge to the shell (layout of the slot, navigation, click pass-through, site events).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('artemisShell', {
  layout: (l) => ipcRenderer.send('layout', l),
  navigate: (url) => ipcRenderer.send('navigate', url),
  passThrough: (v) => ipcRenderer.send('pass', v),
  onSiteNav: (fn) => ipcRenderer.on('site-nav', (_e, url) => fn(url)),
  onKey: (fn) => ipcRenderer.on('site-key', (_e, key) => fn(key))
});
