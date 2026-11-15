// Native dialog boxes (alert, confirm, prompt) of an Electron process, for the shell tests. Electron
// shows the site's dialogs as small native windows that no Electron API lists. macOS: CoreGraphics
// lists them, on or off screen (the test shells keep their windows hidden). Linux (X11, as the
// shell runs there): the X server lists the process's windows; a dialog box is a mapped window of
// type _NET_WM_WINDOW_TYPE_DIALOG.

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
  /** Linux: the window manager type (e.g. _NET_WM_WINDOW_TYPE_DIALOG) and whether it is mapped. */
  type?: string;
  mapped?: boolean;
}

const out = (cmd: string[]) => Bun.spawnSync(cmd).stdout.toString().trim();

function x11Windows(pid: number): NativeWindow[] {
  return out(['xdotool', 'search', '--pid', String(pid)])
    .split('\n')
    .filter(Boolean)
    .map((id) => {
      const info = out(['xwininfo', '-id', id]);
      const n = (k: string) => Number(new RegExp(`${k}:\\s+(\\d+)`).exec(info)?.[1] ?? 0);
      const props = out(['xprop', '-id', id, '_NET_WM_WINDOW_TYPE', 'WM_NAME']);
      return {
        name: /WM_NAME\(\w+\) = "(.*)"/.exec(props)?.[1] ?? '',
        w: n('Width'),
        h: n('Height'),
        layer: 0,
        type: /_NET_WM_WINDOW_TYPE\(ATOM\) = (\w+)/.exec(props)?.[1] ?? '',
        mapped: /IsViewable/.test(info)
      };
    });
}

/** The process's windows as the system sees them. */
export function nativeWindows(pid: number): NativeWindow[] {
  if (process.platform === 'linux') return x11Windows(pid);
  const r = Bun.spawnSync(['osascript', '-l', 'JavaScript', '-e', LIST, String(pid)]);
  const text = r.stdout.toString().trim();
  return text ? (JSON.parse(text) as NativeWindow[]) : [];
}

/** How many of the site's dialog boxes are open: small, unnamed, ordinary-level windows. */
export const nativeDialogBoxes = (pid: number) =>
  process.platform === 'linux'
    ? nativeWindows(pid).filter((w) => w.mapped && w.type === '_NET_WM_WINDOW_TYPE_DIALOG').length
    : nativeWindows(pid).filter((w) => !w.name && w.layer === 0 && w.w > 100 && w.w < 700 && w.h > 40 && w.h < 400).length;
