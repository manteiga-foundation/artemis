# 001: live-browser-view

Question: can a Playwright-driven Chromium running on the Artemis server be shown inside the
web app as an interactive view (an "online browser"), so the browser view in the sketch can be live?

Given a server-side Chromium page, when its screencast is streamed over a WebSocket to an `<img>`
and the operator's mouse / wheel / keyboard are forwarded back, then the operator can browse the
remote page from inside the app.

## Approach

- `playwright` 1.63 (already a dependency of an earlier prototype) launches headless Chromium.
- `context.newCDPSession(page)` -> `Page.startScreencast({ format: 'jpeg', quality: 60, maxWidth: 1280, maxHeight: 800 })`.
  Each `Page.screencastFrame` is forwarded to all WebSocket clients as base64 JPEG and acked.
- Viewer page: `<img>` receives frames; `mousemove/down/up/wheel/keydown/keyup` are sent back.
- Server applies input in arrival order through a promise queue using `page.mouse.*` / `page.keyboard.*`.
- Verification: a second headless Chromium (`verify.ts`) drives the viewer like an operator and the
  remote page state is read through `/stats`.

Run: `bun run server.ts` then open http://127.0.0.1:3100/ (or `bun run verify.ts`).

## Results (Bun 1.4.2, macOS arm64, Playwright 1.63, Chromium 1243)

| Check | Result |
| --- | --- |
| Frames reach the viewer while the remote page animates | 60 fps |
| Frames while the remote page is static | 0 in 2 s (screencast emits only on change) |
| Click in the viewer navigates the remote page | yes (`/target` -> `/target2`) |
| Typing in the viewer lands in a remote input | `hello artemis`, no dropped keys |
| Wheel in the viewer scrolls the remote page | scrollY 600 |
| Public site (en.wikipedia.org) streamed and scrolled | yes, legible in `viewer.png` |
| Average JPEG frame at 1280x800 q60 | 14-24 KB |
| Chromium frame timestamp -> server receipt | ~3-5 ms |

## Verdict: VALIDATED

### What worked
- Everything in the table; the whole chain runs under Bun with the dependencies Artemis already has.
- Change-driven frames mean an idle browser view costs nothing on the wire.

### What didn't (first run)
- Click did not navigate and the first typed key was lost. Cause: Bun runs each async WebSocket
  `message` handler concurrently, so `up` could complete before `down`, and the first `keydown`
  before the focusing click finished. Fix: serialize input through a single promise chain. After the
  fix all checks pass. The real build must keep input strictly ordered.

### Surprises
- Base64-over-JSON was fine on localhost; for the real build send binary frames (ArrayBuffer) to
  avoid the 33% base64 overhead and the JSON parse per frame.
- `viewerFramesSeen` < `totalFrames` only because frames were emitted before the viewer connected.

### Recommendation for the real build
- One Chromium page per "browser view" tab on the server, screencast started when the view is
  visible and stopped (`Page.stopScreencast`) when the cosmos view is in front, to save CPU.
- Binary WebSocket frames; `<canvas>` or `<img>` with `createImageBitmap`; scale frames to the
  panel size with `maxWidth/maxHeight` instead of client-side scaling.
- Forward input via CDP `Input.dispatch*` or `page.mouse/keyboard`, strictly serialized. Map
  viewer coordinates to the remote viewport using the frame's `deviceWidth/deviceHeight`.
- Known limits to design around: native dialogs (file pickers, `alert`), popups / `target=_blank`
  (route `context.on('page')` into new tabs), DRM video, clipboard, IME. None block the interface work.
- Beyond pixels, the same `page` gives the DOM, accessibility tree, forms, links and network
  requests, which is what the product-understanding features (what does this page do, which flow is
  it part of) will be built from.
