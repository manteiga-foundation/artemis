// Native dialog boxes (alert, confirm, prompt) of an Electron process, for the shell tests. Electron
// shows the site's dialogs as small unnamed native windows that no Electron API lists; CoreGraphics
// does, on or off screen (the test shells keep their windows hidden). macOS only, like the suite.

const LIST = `function run(argv) {
  ObjC.import('CoreGraphics');
  const pid = Number(argv[0]);
  const list = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionAll, 0))) || [];
  return JSON.stringify(list.filter((w) => w.kCGWindowOwnerPID === pid).map((w) => ({ name: w.kCGWindowName || '', w: w.kCGWindowBounds.Width, h: w.kCGWindowBounds.Height, layer: w.kCGWindowLayer })));
}`;

interface NativeWindow {
  name: string;
  w: number;
  h: number;
  layer: number;
}

/** The process's windows as macOS sees them. */
export function nativeWindows(pid: number): NativeWindow[] {
  const r = Bun.spawnSync(['osascript', '-l', 'JavaScript', '-e', LIST, String(pid)]);
  const out = r.stdout.toString().trim();
  return out ? (JSON.parse(out) as NativeWindow[]) : [];
}

/** How many of the site's dialog boxes are open: small, unnamed, ordinary-level windows. */
export const nativeDialogBoxes = (pid: number) => nativeWindows(pid).filter((w) => !w.name && w.layer === 0 && w.w > 100 && w.w < 700 && w.h > 40 && w.h < 400).length;
