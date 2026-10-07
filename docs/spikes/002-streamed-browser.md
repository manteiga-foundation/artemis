# 002: streamed-browser

Question: the framed browser blanks a real enterprise flow (a staging site -> PingOne ->
Microsoft sign-in). Can the Browser view instead show a real top-level tab, streamed into the same
stage, with full authority to navigate, without changing the console's interface?

Why the frame failed: after the username, PingOne hands off to login.microsoftonline.com, whose page
ships `<body style="display: none">` and an inline script that reveals it only when
`window.self === window.top`; in a frame it attempts `top.location = ...` (blocked by the sandbox)
and stays invisible, so the console's dark stage shows through. `window.top` cannot be faked, and
enterprise sign-in, banks and payment pages are the ones that react to it; storage partitioning and
SameSite cookie rules in frames add more of the same class.

## Approach

- `stream.ts`: the site runs in its own headless Chromium (`channel: 'chromium'`, the full browser in
  new headless mode, persistent profile, `--force-device-scale-factor=2`, user agent without
  "Headless"). CDP `Page.startScreencast` (JPEG) frames go to the console as binary WebSocket
  messages with a 16-byte header (Chromium swap time, server receipt). Input from the console is
  applied in strict order through one promise chain; consecutive mouse moves collapse. The last frame
  is replayed to a console that (re)connects, since the screencast only emits on change.
- `VIEWER` (same file): injected into the real console, it hides the slot's iframe and draws the
  stream on a canvas filling `.browser-slot`, so the glass address strip, header and bottom panels
  keep floating over the site exactly as today. Mouse, wheel and keys are forwarded; Cmd+[ / Cmd+] /
  Cmd+R act on the site tab; paste carries the system clipboard; the address strip follows the
  tab's real URL.
- `measure.ts [appUrl] [dpr] [quality]`: drives the console like an operator in a second Chromium
  (1440x900 at 2x): engages the real site, clicks and types the username through the canvas, submits,
  waits for Microsoft, reloads the console, presses Cmd+[, then measures frame rate on an animated
  fixture, key-to-frame latency on a text field, and a `<select>`.
- `dsf-check.ts`: frame resolution per scale-factor setup.
- `try.ts [appUrl]`: the same, by hand, in the owned browser window. Profiles and outputs go under
  `data/spike-002/` (ignored).

Run: `cd docs/spikes/002-streamed-browser && bun try.ts` (dev server on 5179, or pass the URL).

## Results (Bun 1.4.2, macOS arm64, 8 cores, Playwright 1.63, Chromium 153)

Function (every run):

| Check | Result |
| --- | --- |
| Username typed through the console lands in the site's field | `artemis.probe.nonexistent`, intact |
| Microsoft sign-in after the username | renders; `top === self`, body `display: block`, legible at 2x |
| Address strip | follows the tab through every redirect (PingOne, Microsoft) |
| Console reload | stream back within 1.5 s on the same Microsoft page (the tab lives on the server) |
| Cmd+[ from the console | site goes back to PingOne |
| What sites see | `Chrome/153.0.0.0`, no "HeadlessChrome" |
| Console page errors | none |
| `<select>` | popup does not appear in the stream; ArrowDown+Enter did not change the value |

Frame resolution: `deviceScaleFactor: 2` alone gives 1x frames (1440x828) with `devicePixelRatio`
2 in the page; `--force-device-scale-factor=2` gives true 2x frames (2880x1656).

Performance at 2x (animated fixture, 5 s; interleaved pairs; the second pair overlapped with the
user's own `bun run artemis` starting, so two consoles with WebGL graphs were running):

| Run | load avg | frames recv / drawn | avg frame | Chromium -> console | decode | console FPS | key -> frame (med / p95) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| q70 | ~3 | 60 / 58 fps | 53 KB (3.1 MB/s) | 18 ms | 14.5 ms | 60 | 26 / 62 ms |
| q85 | ~5.9 | 55 / 17 fps | 70 KB | 66 ms | 61.5 ms | 44 | 38 / 76 ms |
| q70 | ~6.2 | 25 / 15 fps | 53 KB | 119 ms | 71.5 ms | 50 | 41 / 100 ms |
| q85 | ~6.2 | 10 / 8 fps | 70 KB | 294 ms | 109 ms | 41 | 69 / 143 ms |

At 1x frames (first runs, before the scale-factor fix): 60 fps, 21 KB, 4 ms Chromium -> console,
2 ms decode, key -> frame 14 ms median.

## Verdict: VALIDATED for authority; two costs to design

### What worked
- The flow the frame blanks works with no site-specific code: the site is a real top-level page, so
  frame-busting, `X-Frame-Options`, CSP and cookie rewriting no longer exist as problems.
- The interface is unchanged: the stream is a canvas in the slot, panels keep their glass over it.
- The site's place survives a console reload for free.

### What did not
- Browser-drawn widgets are not in the stream: `<select>` popups (confirmed), and by the same
  mechanism the right-click menu, date pickers, `alert`/`confirm` and the file picker. Each needs an
  Artemis-drawn counterpart fed by Playwright (`<select>` options from the DOM, `page.on('dialog')`,
  `page.on('filechooser')` -> a real file input in the console -> `setFiles`).
- At 2x, JPEG decode in the console (4.7 Mpx per frame) is the cost that grows under load: 14.5 ms
  idle, 70-110 ms with the machine busy, and then frames are dropped. q85 costs more than q70.

### Recommendation for the real build
- Decode in a Worker with an OffscreenCanvas so the console's main thread stays free; measure.
- Adaptive resolution: stream at 1x while the page moves (scroll, animation) and send a 2x frame once
  it settles (~150 ms without frames); measure against constant 2x with interleaved rounds.
- Artemis-drawn select, dialogs, file chooser, context menu (Back / Forward / Reload / Copy), cursor
  shape (element under the pointer), copy out of the site, IME composition.
- Hotkeys: the tab reports whether focus is in an editable field; plain keys go to the console
  otherwise, as the frame agent does today. In the spike every key goes to the site while the canvas
  has focus; clicking the console chrome gives hotkeys back.
- Popups (`context.on('page')`) become tabs of the Browser view.
- Decide with the user whether the framed iframe stays as the external-browser fallback.
