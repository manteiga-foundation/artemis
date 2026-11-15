# 005: the owned browser on a Linux desktop

Question: does the owned browser (the Electron shell: the site as a native view, the transparent
console window over it, clicks passing through over the site) work on a Linux desktop as it does on
macOS, under X11 and under Wayland (Ubuntu's default), with the sandbox a genuine browser has? And
does the one-command install give a working `artemis` there?

## Approach

Two Linux machines, both arm64 on this Mac:

- A container (`Dockerfile`, `desktop.sh`): the Playwright image plus what Electron needs, Bun,
  and two sessions to choose from: X11 (Xvfb, openbox as the window manager, picom as the
  compositor) and Wayland (Weston headless with Xwayland, `XDG_SESSION_TYPE=wayland`). The
  repository comes in read-only at run time, so iterating needs no rebuild.
  `docker build -f docs/spikes/005-linux-desktop/Dockerfile -t artemis-linux .`, then
  `docker run --rm --ipc=host [-e DESKTOP=wayland] -v "$PWD":/src:ro -v <out>:/out artemis-linux <command>`.
- A Lima VM with Ubuntu 24.04.5 (`limactl start --name=ubuntu template:ubuntu-24.04`): a real
  kernel with Ubuntu's AppArmor policy, which a container cannot stand in for (Docker's seccomp
  profile denies user namespaces whatever the host allows). `vm-desktop.sh` gives it the same X11
  session.

`probe.ts` drives the real shell with real input: `xdotool` through the X server, not Playwright's
synthetic events (which go straight to Blink and cannot tell whether the operating system lets a
click through the transparent console). It reads both windows' geometry from the X server, moves
the pointer over the site and clicks a button in it (the site counts the click), moves back over the
header and clicks View (V) (the console must take the click), then moves and resizes the window
through the window manager and does it again. `sandbox.cjs`, `sandbox-shell.ts`: which sandbox
Electron starts with. `ignore.cjs`: a minimal transparent child window toggling
`setIgnoreMouseEvents` (the Xwayland crash hunt).

## Results

| Check | X11 (container) | Ubuntu 24.04 X11 (VM) | Wayland, native (container) | Wayland via Xwayland (container) |
| --- | --- | --- | --- | --- |
| Shell launches | yes | yes | yes | yes |
| Console over the content, before (dx, dy, dw, dh) | 0, 0, 0, 0 after the fix (see 1) | 0, 0, 0, 0 | no: placed by the compositor, a black band between | 1, 7, 0, 0 (Weston's window manager) |
| Real click over the site reaches it | yes (1 of 1) | yes | - | not measurable (see 3) |
| Over the header the console takes the click (V to Cosmos) | yes | yes | - | - |
| After the window manager moves and resizes the window | 0, 0, 0, 0; click through still works | 0, 0, 0, 0; works | - | - |
| `tests/shell.test.ts` (15, plus this slice's two) | 17/17 | - | - | - |
| Electron test files: shell, recorder, autopilot-flight, artemis-cli | 30/30 | - | - | - |
| Plain headless Chromium files: integration, owned-browser | 10 of 29 pass (see 8) | - | - | - |

Findings, each one fixed or decided in the product:

1. **Electron's default menu bar sits inside the window on Linux** (File, Edit, View, Window,
   24 px). The console was fitted to the content bounds below it, but the first fit ran before the
   bar was laid out, so the console covered the bar and sat 24 px off the site; after a resize it
   moved under the bar. Fix: `win.removeMenu()` off macOS (a browser has no menu bar there either).
   Test: the console covers exactly the content, before and after a resize (RED on Linux: a menu
   bar was visible).
2. **Wayland: a native Wayland client cannot place its windows.** Electron 38 and later run as a
   Wayland app in a Wayland session; `setBounds` positions are ignored, so the console lands
   wherever the compositor puts it (the screenshot shows the header at the window's top edge, a
   black band, the site lower). Electron's own answer is `--ozone-platform=x11` (Xwayland): the
   shell is launched with it on Linux (`server/platform.ts`, unit-tested).
3. **Weston's headless Xwayland segfaults on any XTEST input** (`xdotool mousemove` alone, with no
   client at all; it has no seat). So under Wayland only the geometry was measured; input through
   Xwayland needs a compositor with a seat (GNOME's Mutter is the one that matters: next).
4. **Chromium's sandbox.** Playwright launches Electron with `--no-sandbox` on Linux unless asked
   (`chromiumSandbox`): on macOS the site's pages are sandboxed, on Linux they were not. Asking is
   not enough on Ubuntu 23.10 and later, where AppArmor restricts user namespaces: measured on the
   VM, Electron as installed aborts at launch ("The SUID sandbox helper binary was found, but is
   not configured correctly"); with an AppArmor profile naming the binary (`userns,`) it starts
   sandboxed; with chrome-sandbox root-owned and 4755 it starts sandboxed too. Decision in the
   product: launch with the sandbox whenever the system allows it (user namespaces unrestricted, or
   Artemis's profile present, or the setuid helper), otherwise launch without it and say so at
   every launch with the one command that turns it on, `sudo sh ~/.artemis/app/scripts/linux-sandbox.sh`
   (the profile on Ubuntu, which survives `artemis update`; the setuid helper elsewhere). Verified
   on the VM: `sandbox: off, --no-sandbox` before the script, `sandbox: userns`, no
   `--no-sandbox` after it, and the probe passes with the sandbox on.
5. **Memory readout.** On Linux `os.freemem()` is MemFree, so the page cache counted as used; the
   header now reads `/proc/meminfo` (total minus MemAvailable).
6. **The installer on a machine without Bun**: Bun's installer drew curl's download bar on stderr,
   past the quiet install. Its output now goes to the install log like every other tool's.
7. `ps -axo pid=,ppid=,%cpu=,rss=,command=` (the process-tree readout) works as is with procps.
8. Not Artemis's: the test suite reads the live database with the `sqlite3` CLI (installed in the
   image). The plain headless Chromium files (the console in an ordinary browser, not the owned
   browser) ran 20-38 s per test on software WebGL in the 4-CPU VM, with the macOS GPU flags
   (`--use-angle=metal`) the suite passes; one dive test missed its midpoint, then Chromium failed
   to create a browser context and every later test in the file failed in milliseconds (the same
   cascade seen on the Mac under load). Not chased here: spike 004 ran these 24/24 in its image.

9. **No GPU, no WebGL.** On Xvfb (or any machine without a working GPU driver) Chromium gives no
   WebGL (`webgl: disabled_off`), and the cosmos is WebGL: the header counted 485 nodes over an
   empty stage. Measured on the VM: `--ignore-gpu-blocklist` gives WebGL on Mesa's llvmpipe but
   also overrides the blocklist on real GPUs; `--enable-unsafe-swiftshader` falls back to
   SwiftShader only where there is no GPU. The shell passes the latter on Linux, and the terminal
   says when WebGL runs on the CPU (the site gets it too, where Chrome would give none).
10. **The sandbox step at install.** The installer asks on `/dev/tty` (the script itself is curl's
   pipe) and runs `scripts/linux-sandbox.sh` with sudo; verified on the VM through a pseudo-terminal
   (`script`): asked, answered, the profile written, no question on the next install.

The installed `artemis` on the VM's virtual display (`run-artemis.sh`): books.toscrape.com flown at
max, 20 pages, the cosmos and the Scope map drawn at 3 to 8 FPS on four virtual CPUs, V into the
Cosmos, Ctrl+C saving the database, HAR and both videos (`docs/screenshots/linux-*.png`).

## Verdict: PARTIAL

Validated on X11, including a real Ubuntu 24.04 with its AppArmor policy: the shell, real click
pass-through both ways, the console following the window manager's moves and resizes, the
sandbox on once allowed. Wayland: the shell now runs through Xwayland, which positions windows, but
input through Xwayland was not measured (Weston's headless Xwayland crashes on synthetic input).
Next: GNOME Mutter (Ubuntu's own compositor) headless with a virtual pointer, and the operator's
own test on a Linux desktop.
