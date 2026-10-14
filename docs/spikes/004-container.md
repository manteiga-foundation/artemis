# 004: container

Question: can Artemis run without Electron, as one Linux container that is the same artifact
locally (Docker on macOS, Windows, Linux) and in the cloud? Three parts: (1) the recorder and the
autopilot flying a site headless on Linux, feeding the console over a WebSocket, the radial tree
building live and surviving a console reload; (3) the existing browser test suite inside the same
image, so `bun run test` could become the CI gate. Part (2), the streamed preview of the site and a
hand on it for sign-in, is the next spike.

## Approach

- `Dockerfile`: `mcr.microsoft.com/playwright:v1.63.0-noble` (Chromium, its libraries, fonts and
  ffmpeg at the version package.json pins) plus Bun 1.4.2; `bun install` with
  `ELECTRON_SKIP_BINARY_DOWNLOAD`; `bun run build`; `VOLUME /data` for sessions, HARs and videos.
  The repository's `.dockerignore` keeps `data/` (5.7 GB here) and every `node_modules` out of the
  context: the first build sent 7 GB; with it, 337 MB (a spike's node_modules), then 16 KB.
- `serve.ts`: one Bun process. Serves `dist/`, owns a headless Chromium through Playwright, runs
  the real `server/recorder.ts`, `server/autopilot-driver.ts` and `server/site-dialogs.ts`
  untouched behind a 10-line stand-in for Playwright's `ElectronApplication` (`context()`, and
  `evaluate(fn, arg)` run in-process, where the shell's `__artemisActions` queue and
  `__artemisAutopilot` state now live). `shell/site-preload.ts` is bundled with `electron` aliased
  to a Playwright binding (`exposeBinding`) and injected with `addInitScript`, so the operator's
  and the autopilot's actions reach the recorder as they do in the shell, with the actor decided by
  the same `shell/autopilot-state.ts`. Site events go to every connected console in 150 ms batches,
  a reset plus the session so far to a console that (re)connects, as `server/site-feed.ts` does.
- `shim.ts`: `window.artemisShell` (the `ShellBridge` of `src/shell.ts`) over the WebSocket,
  injected into `index.html` before the app module. The console runs its shell code path as is:
  the Browser view's address strip, D for the autopilot, V onto the current page, the live cosmos.
  `layout` and `passThrough` are no-ops: there is no native page behind the console.
- `fixture.ts`: a small shop (sections, products, an API call per page, a sign-in with a session
  cookie, Sign out) in neutral words.
- `probe.ts`: a Chromium on the host opens the console, engages the fixture, presses D to max,
  waits for the flight to end, reads the cosmos, reloads the console and reads it again, and
  measures the round trip.

Run: `docker build -f docs/spikes/004-container/Dockerfile -t artemis-spike .` then
`docker run --rm --ipc=host -p 5173:5173 -v artemis-data:/data artemis-spike` and
`bun run docs/spikes/004-container/probe.ts http://127.0.0.1:5173`. On the host without Docker:
`PORT=5199 FIXTURE_PORT=5198 ARTEMIS_SESSIONS_DIR=... bun run docs/spikes/004-container/serve.ts`.

## Results (Bun 1.4.2; Colima 4 CPU / 6 GB on an arm64 Mac; image linux/arm64, 4.39 GB)

Part 1, the same probe on the host (darwin/arm64) and in the container (linux/arm64):

| Check | Host | Container |
| --- | --- | --- |
| Engage to the address strip showing the site | 4.5 s (first run), 2.4 s | 1.4-2.4 s |
| Flight at max: pages visited / pending | 15 / 0 in 21.1 s | 15 / 0 in 22.1 s |
| Autopilot clicks recorded, actor | 22, all `autopilot` | 22, all `autopilot` |
| Cosmos labels after the flight (core + pages) | 16 | 16 |
| V lands on the current page | `/pricing?plan=solo` selected | same |
| Header NODES / LINKS | 32 / 36 | 32 / 36 |
| Feed batches / events during the flight | 37 / 266 | 35 / 266 |
| Console reload, then V: labels / NODES | 16 / 32 (one batch of 222 events, one reset) | 16 / 32 |
| Session database in `/data/sessions` | 44 visits, 88 requests all answered, 22 actions | same |
| Live HAR next to it | 88 entries, 44 pages, creator Artemis | same |
| Console `pageerror` | none | none |
| HTTP round trip host -> container (20 samples) | - | 0.6 ms median, 1.1-1.4 ms p95 |

The WebSocket's one-way latency could not be read: the Colima VM's clock runs 22-26 ms behind the
host, and on the host itself the median was 0 ms (p95 9 ms). The round trip above bounds it.

Screenshots (`data/spike-004/`, ignored): the container's cosmos after the reload is the same
radial tree as the host's, 16 labels around the core, `/pricing?plan=solo` selected, no defect.

Part 3, the test suite inside the image (`docker run --rm --ipc=host artemis-spike ...`):

| Run | Result | Time |
| --- | --- | --- |
| `bun run test:unit` (22 files) | 189 pass, 1 fail: `tests/readme.test.ts` looks for `docs/readme/*.png`, which `.dockerignore` keeps out of the image | 1.3 s |
| `bun test tests/integration.test.ts tests/debug-page.test.ts tests/owned-browser.test.ts` | 24 pass, 0 fail, 224 expect() calls | 134.6 s |

The 24 Chromium tests ran as written: each spawns its own Vite, launches Chromium with the macOS
flags (`--use-angle=metal --enable-gpu --ignore-gpu-blocklist`, ignored on Linux) and the cosmos
drew with software WebGL; the FPS readout test passed. Not run: the four files bound to the
Electron shell (`autopilot-flight`, `recorder`, `shell`, `artemis-cli`, 33 tests), which have no
Electron in the image. The log is in `data/spike-004/tests-in-container.log`.

## Verdict

VALIDATED for parts 1 and 3.

- Artemis runs without Electron: the recorder, the autopilot, the live HAR, the session database
  and the live cosmos all work from one Bun process on Linux, with the server code unchanged and
  the console unchanged. The whole shell layer the container replaces is a 10-line host stand-in
  on the server side and a 90-line bridge over a WebSocket on the console side.
- The container is the same artifact locally and in the cloud: built once, it ran here under
  Colima on an arm64 Mac with the console in a host browser, which is the macOS and Windows story,
  and it is a Linux image, which is the cloud story.
- The browser test suite runs in the image without a GPU or a desktop session, so a Linux CI job
  can run it: 24 of 24 Chromium tests, 134 s. The Electron-bound tests would be rewritten against
  the Bun host (the recorder and autopilot flight tests are about the recorder and the autopilot,
  not about Electron) and the shell's own tests retire with the shell.
- For the product: a root `Dockerfile` and `server/host.ts` (the `Host` interface, the WebSocket
  feed, static serving), `src/shell-socket.ts` as the console's bridge when no Electron preload is
  present, the site preload in an isolated world, `tests/readme.test.ts` given its images or the
  image given `docs/readme`. Then spike 005, the preview and the hand.

Measured costs: image 4.39 GB on disk (the Playwright base is 3.5 GB of it); `bun install` in
the build 140 s on this VM; the container after a flight, at rest: 177 MiB by `docker stats`
(Bun 142 MB RSS, the four headless Chromium processes 66-120 MB each, shared pages counted once),
CPU 0.4%.

## Findings

- The Electron coupling in `server/` is two things: `app.context()` and `app.evaluate` against two
  globals of the shell's main process. A typed `Host` interface with those two members, implemented
  by the shell today and by the Bun process tomorrow, makes the recorder, autopilot and dialogs
  code run in both without a change of substance. The console side is the `ShellBridge`
  interface already; the shim is its WebSocket implementation, 90 lines.
- The shim must hold the snapshot until the console listens (`SITE_FEED_READY`), exactly as
  `server/site-feed.ts` does. Dispatching on connect lost the whole snapshot once (the WebSocket
  opens before React mounts) and the cosmos after a reload showed only the live tail: 6 nodes in a
  line. Found by the probe's reload step, not by eye.
- The site preload runs in the page's main world when injected with `addInitScript` (Electron ran
  it in an isolated world). The page can see `window.__artemisIpc` and the listeners. Acceptable for
  a spike; the product should use a CDP isolated world (`Page.addScriptToEvaluateOnNewDocument`
  with `worldName`) to keep the promise that nothing of Artemis is visible to the site.
- `playwright` resolved from Bun's global cache (1.64.1, no browsers) when a probe was run from
  outside the repository: probes live in the repository.
- Docker's legacy builder ignores `Dockerfile.dockerignore`; `.dockerignore` at the context root
  is the one that works everywhere, and it belongs to the repository anyway.
- A `rm -rf` chained into a longer command needs an approval that can time out and takes the
  whole command with it; write into a fresh folder instead.

## Not covered here

- The streamed preview and the operator's hand (sign-in): spike 005.
- Video of the site (`recordVideo`) inside the container: ffmpeg is in the image, not measured.
- Linux/amd64: built and run on arm64 only (the Playwright image is multi-arch).
- The console's `__artemis` state hook is DEV-only; probes against the production build read the
  DOM (`.hub-label`, the header's NODES) instead.
