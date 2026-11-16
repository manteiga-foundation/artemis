// Native dialog boxes (alert, confirm, prompt) of an Electron process, for the shell tests. Electron
// shows the site's dialogs as small native windows that no Electron API lists. Windows: EnumWindows
// (a dialog is class #32770). macOS: CoreGraphics
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

// Windows: the top-level windows of the process and its descendants, by EnumWindows; a dialog box
// is a visible window of the standard dialog class #32770 (what Electron's message box is).
const WIN32_LIST = `
Add-Type @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class ArtemisWindows {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public static string List(uint[] want) {
    var rows = new List<string>();
    var pids = new HashSet<uint>(want);
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (!pids.Contains(pid)) return true;
      var c = new StringBuilder(256); GetClassName(h, c, 256);
      var t = new StringBuilder(256); GetWindowText(h, t, 256);
      rows.Add((IsWindowVisible(h) ? "1" : "0") + "\\t" + c + "\\t" + t);
      return true;
    }, IntPtr.Zero);
    return string.Join("\\n", rows);
  }
}
'@
# On Windows Playwright starts Electron through a shell: the windows belong to its descendants.
$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId
$tree = @([uint32]$args[0]); $i = 0
while ($i -lt $tree.Count) { $tree += @($all | Where-Object ParentProcessId -eq $tree[$i] | ForEach-Object { [uint32]$_.ProcessId }); $i++ }
[ArtemisWindows]::List([uint32[]]$tree)`;

function win32Windows(pid: number): NativeWindow[] {
  const r = Bun.spawnSync(['powershell', '-NoProfile', '-Command', `& { ${WIN32_LIST} } ${pid}`]);
  return r.stdout
    .toString()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [visible, type, name] = line.split('\t');
      return { name: name ?? '', w: 0, h: 0, layer: 0, type, mapped: visible === '1' };
    });
}

/** The process's windows as the system sees them. */
export function nativeWindows(pid: number): NativeWindow[] {
  if (process.platform === 'linux') return x11Windows(pid);
  if (process.platform === 'win32') return win32Windows(pid);
  const r = Bun.spawnSync(['osascript', '-l', 'JavaScript', '-e', LIST, String(pid)]);
  const text = r.stdout.toString().trim();
  return text ? (JSON.parse(text) as NativeWindow[]) : [];
}

/** How many of the site's dialog boxes are open: small, unnamed, ordinary-level windows. */
export const nativeDialogBoxes = (pid: number) =>
  process.platform === 'linux'
    ? nativeWindows(pid).filter((w) => w.mapped && w.type === '_NET_WM_WINDOW_TYPE_DIALOG').length
    : process.platform === 'win32'
    ? nativeWindows(pid).filter((w) => w.mapped && w.type === '#32770').length
    : nativeWindows(pid).filter((w) => !w.name && w.layer === 0 && w.w > 100 && w.w < 700 && w.h > 40 && w.h < 400).length;
