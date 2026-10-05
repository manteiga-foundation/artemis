// The console's bridge to the shell, exposed as `window.artemisShell` (see src/shell.ts).
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

type Listener<T> = (value: T) => void;
const listen = <T>(channel: string, fn: Listener<T>) => {
  const handler = (_e: IpcRendererEvent, value: T) => fn(value);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
};

// The shell reports the site's address as soon as the console has loaded, which can be before the
// app subscribes: keep the latest and hand it to each new subscriber.
type Nav = { url: string; title?: string; canGoBack?: boolean; canGoForward?: boolean };
let lastNav: Nav | null = null;
ipcRenderer.on('site-nav', (_e, nav: Nav) => {
  lastNav = nav;
});

contextBridge.exposeInMainWorld('artemisShell', {
  layout: (l: unknown) => ipcRenderer.send('layout', l),
  navigate: (url: string) => ipcRenderer.send('navigate', url),
  back: () => ipcRenderer.send('site-go', 'back'),
  forward: () => ipcRenderer.send('site-go', 'forward'),
  reload: () => ipcRenderer.send('site-go', 'reload'),
  passThrough: (through: boolean) => ipcRenderer.send('pass-through', through),
  onSiteNav: (fn: Listener<Nav>) => {
    if (lastNav) fn(lastNav);
    return listen('site-nav', fn);
  },
  onKey: (fn: Listener<string>) => listen('site-key', fn),
  onSitePointer: (fn: Listener<unknown>) => listen('site-pointer', fn),
  onSiteLoad: (fn: Listener<string>) => listen('site-load', fn),
  // The autopilot: the console sets the speed; the shell reports the flight.
  autopilot: (speed: number) => ipcRenderer.send('autopilot', speed),
  onAutopilot: (fn: Listener<unknown>) => listen('autopilot-status', fn)
});
