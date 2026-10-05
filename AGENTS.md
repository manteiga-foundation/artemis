# Working on Artemis

This file is the working contract for anyone (person or agent) changing this repository. It is
short on purpose: the README has the setup steps, `docs/console.md` the notes on what is built, and
this explains how we build it.

## What Artemis is

A product-understanding console for a Product Manager, a Product Auditor and a UX/UI expert: what
each page of a web application does and why, how pages chain into flows (registration, applying for
a job, a purchase), and where those flows live in the whole. It is not a security tool; that
framing was dropped on purpose. Interfaces come first: surfaces, hotkeys, transitions and sounds
are designed and tested against deterministic stubs, and functionality attaches later without
reshaping them. In the user's words: emulate the functionality while driving the interface to a
perfect state, then apply the functionality to the existing elements. So a new element (a
selection card, an annotation pin) ships with emulated data and a real test of its behaviour; the
backend later fills shapes that already exist, it never dictates them.

Stack: Bun, Vite, React 18, `@arwes/react` (alpha), `@cosmos.gl/graph` (WebGL graph), Playwright
(tests, and the browser Artemis owns at runtime). No framework for state: `src/store.ts`.

## Vocabulary (fixed, use these words)

- **View** - the console's mode: Browser (home after Engage) and Cosmos are shown; Page is kept
  in code but hidden (`hidden` in `src/views.ts`). `V` pulls back from the Browser to the Cosmos,
  landing on the current page (selected, zoomed in on), and returns to the Browser.
- **Lens** - a perspective inside a view: Overview, Clusters, Hubs, Routes, Anomalies (`1-5`).
- **Layer** - an independent toggle (Links, labels, annotations).
- **Command card** - the 3x3 grid; A and S keep the top row, V the middle row, in every view.
- **Owned browser** - the Electron shell `bun run artemis` launches: the website as a genuine native
  page, the console in a transparent window over it.
- **Dive** - the depth transition between views.
- **Configuration view** - the settings (`,` or the header cog), opened over the current view, not
  part of the V cycle; changes wait in a draft until Apply.

## How we work: the methodology

Every slice follows the same loop. Do not skip steps because a change looks small; the small ones
(a CSS rule, an animator without children) are the ones the tests caught.

1. **RED first.** Write the failing test before the code: a unit test for logic (`tests/*.test.ts`,
   run with the fake window/renderer in `tests/harness.ts` when the controller is involved), a
   Playwright test in real Chromium or the Electron shell for behaviour (`tests/integration.test.ts`,
   `tests/shell.test.ts`, `tests/debug-page.test.ts`). Run it and see it fail for the
   right reason.
2. **GREEN.** The smallest change that passes. Then refactor if needed with the tests still green.
3. **Gates before "done":** `bun run check` (tsc for app, server and shell), `bun run test` (all), and
   `bun run build`. A dev server answering is not verification.
4. **Look at it.** Take screenshots (`scripts/screenshots*.ts`, 1440x900 and 1280x800, mid-dive
   frames when motion is the point) and inspect them, by eye or with a vision model. Treat what
   you see as a lead and confirm with a DOM/CSS probe before changing code.
5. **Document.** `docs/console.md` (vocabulary, views, command table, test list, decisions), screenshots into
   `docs/screenshots/`, a commit per slice with a descriptive message. Never push or rewrite
   history unless asked.
6. **Report honestly:** what changed, what is verified (counts and commands), one real finding
   or trade-off, next candidates. Plain text, no emojis.

When something is uncertain (is X feasible? which colour? which sound?), do not argue it:
**spike it** in scratch with measured numbers, or **render every candidate in context** (icons in
the real button chrome, sounds on `/debug`, palettes on a contrast sheet) and let the user pick.

## Commands

```
bun run dev                      # Vite on 5173 (tests spawn their own isolated server)
bun run check                    # tsc --noEmit for src, server and shell
bun run test                     # bun test --timeout 60000 tests  (unit + Playwright)
bun run build                    # check + production bundle
bun run artemis [website]        # the owned browser, Electron shell (starts the dev server if needed)
bun run scripts/screenshots.ts <port> [outDir] [site]
bun run scripts/screenshots-shell.ts <port> [outDir] [site]     # the owned browser (Electron shell)
bun run scripts/screenshots-recorded.ts <port> [outDir] [site]  # the live cosmos after browsing a real site
bun run scripts/screenshots-entry.ts <port> [outDir]
bun run scripts/screenshots-debug.ts <port> [outDir]
bun run scripts/measure-dive.ts <port>                          # fps idle and through the dive
```

Playwright's Chromium: `bunx playwright install chromium`. GPU in headless on macOS:
`--use-angle=metal --enable-gpu --ignore-gpu-blocklist`. Electron installs with `bun install`
(binary fetched on first use); shell tests keep its windows hidden (`ARTEMIS_SHELL_HIDDEN`).

## Conventions that tests depend on

- Palettes are CSS custom properties set on `.app` from the *shown* view (`src/views.ts`). New CSS
  uses `var(--token)` and `color-mix`; never a literal hex or rgba (it leaks when the palette
  switches).
- Accessible names are the test API: textbox "Web App", button "Engage", buttons "View (V)",
  "Depth (D)", "Annotate (A)", "Panels (C)", tablist "Lenses". Change them only with the tests.
- `window.__artemis = getState` is exposed in DEV by `main.tsx`; tests and scripts read it.
  Never `import('/src/store.ts')` from a test (Vite HMR history makes a second instance).
- The shell bridge is `window.artemisShell` (shell/console-preload.ts, typed in `src/shell.ts`);
  the shell's state for tests is `globalThis.__artemisShell` in the main process (`shell.state()`).
  Clicks stay with the console only over `PANEL_SELECTOR`; new floating panels must match it.
- Arwes hides entering elements (`visibility: hidden`): wait for `visible`, use
  `includeHidden` for absence checks. Integration tests collect `pageerror` and assert none.
- Commit in a separate step after reading the test counts; never chain `bun test | grep && git
  commit` (grep exits 0 on printed failures).

## Map

```
src/views.ts            ViewSpec, order, palettes            src/store.ts         UIState
src/commands.tsx        per-view command sets                src/graph/controller.ts  graph + commands
src/components/Stage.tsx  the dive                           src/components/BrowserSurface.tsx  the website frame
src/metrics.ts          FPS sampler (header readouts)        src/quality.ts       graph pixel-ratio budget
src/settings.ts         settings: categories, defaults, search  src/settings-session.ts  the draft, Apply, close
src/autopilot.ts        the D control, reports from the shell  server/autopilot.ts  flight plan (pure)
server/autopilot-driver.ts  flies the site (Playwright)     shell/autopilot-state.ts  speed, actor, disengage
src/sounds.ts, sfx.tsx  sound definitions / playing          src/debug/           /debug page, synth presets
shell/main.ts           the owned browser: Electron shell     shell/*-preload.ts   console bridge, site hotkeys
server/shell.ts         build + launch the shell (Playwright) src/shell.ts, src/resume.ts  console side, reload memory
server/recorder.ts      session recorder (Playwright traffic, preload actions)  server/session-store.ts  SQLite schema + policy
server/site-feed.ts     recorder events -> console, snapshot on reload    src/site-events.ts   the event contract
src/site-model.ts       events -> live cosmos (pages, endpoints, services) src/scope.ts         review scope (shared)
server/owned-browser.ts the earlier framed owned Chromium (no longer launched)
server/machine.ts       machine CPU/memory/process-tree feed
tests/harness.ts        fake window + renderer for controller tests;  tests/vite.ts  isolated Vite
```

## Standing decisions (do not re-litigate without the user)

- The owned browser must be a genuine browser: a bug a reviewer finds must be the site's, never
  Artemis's. It is the Electron shell (spike 003, confirmed by the user with a real MFA sign-in):
  the site is an unmodified native page; nothing rewrites its headers or cookies; only an
  isolated-world preload runs in it. The framed owned browser (blanks Microsoft sign-in) and the
  streamed tab (imitates input and widgets, spike 002) were set aside; injecting HUD panels into
  the site's DOM was rejected. "Sign in with Google" blocked in embedded browsers is accepted.
- Browser view: the website fills the stage edge to edge from a glass address strip under the header
  to the bottom; panels float over it on their own glass; no full-width scrim (it hid the part of
  the page people need).
- Visuals and animations are not traded for speed without a measurement that points at them. Read
  the machine first (`uptime`, `vm_stat` wired memory); measure with interleaved A/B rounds.
- Shipped sound files are Arwes free samples: development only. The console plays by action
  (`src/sounds.ts`); `/debug` applies per-action picks live via localStorage; final picks become
  `DEFAULT_ACTION_SOUNDS`. The target voice is the `soft` family: StarCraft-spirit, gentle.
- Icons: Game-icons via `react-icons/gi`; the View glyph is Font Awesome `FaLayerGroup`. Credits
  in the README.

## Where things stand (update when it changes)

Done: two shown views (Browser, Cosmos; the Page view hidden, not removed) with palettes and the
dive; pulling back from the Browser opens the Cosmos on the current page, selected and zoomed in
on, and an operator camera move cancels the first layout's pending auto-fit; entry screen with the
website field; Browser view
showing the real site; the owned browser is the Electron shell (`bun run artemis`): genuine site,
click pass-through, hotkeys from the site, live address strip with Back/Forward/Reload buttons and an
editable address (GET parameters rewritable), right-click Back/Forward/Reload,
console reload resumes on the same page; `C` panels fold with header switch; real resource
readouts; `/debug` with sounds; `_blank` links stay in the site view; sessions recorded into one
SQLite file each under `data/sessions/` (page views, actions with actor, requests, responses,
bodies; observations only, categorisation later and recomputable), with a video of the site and of
the console and a HAR next to it (on by default), saved whole however
the app is closed (window, Cmd+Q, Ctrl+C; leftovers of a crash recovered at the next launch); in
the owned browser the Cosmos is the live recording, drawn as a computed radial tree like the
emulated sketch (core at the centre, sections evenly around it, sub-pages outward, every request a
dot in its page's cloud, no line crossing another, routes in the Routes lens; Scope `E`; V lands on
the current page; a console reload rebuilds it from the database); the configuration view from the
user's sketch (`,`: search, seven categories, checkboxes, Apply; the command card and scope map
stay; only the sound default is live, the rest interface with emulated options); the autopilot
(D in the Browser view, a yoke with three speed squares; Highlight removed, DOM on O): in the owned
browser it flies the site branch by branch at slow, regular or max, never repeating what the cosmos
has, two or three pages of each kind, never signing out, its clicks recorded as the autopilot's,
disengaged by the operator's hand on the site.

Next (user's order): wire the configuration view's options as each feature arrives (recording
defaults read by `bun run artemis`, Scope subdomains, export formats); DOM session replay (spike first), a policy-aware HAR export from the database,
then categorisation and autopilot. No LLMs or new dependencies for now;
strong open-source tools are welcome; a small model for categorisation (and compliance mapping
such as NIST CSF 2.0 or PCI) comes later, because hard-coded heuristics would put wrong labels in
the database.

Next for the shell (in order): session save/restore through cookies behind one API; a snapshot of
the site riding the dive; find in page, zoom, downloads, permission prompts, popups as tabs
(today `_blank` links load in the site view and featured popups stay windows);
remove the framed owned browser (`server/owned-browser.ts`, its tests) once the user agrees; the
slot's navy veil over the site as a switchable Layer (kept on for now by the user's choice).

Next: the user is designing more interface elements (node selection, annotations, ...), each
built with emulated data first. From the user's notes: true categorisations for every page (authentication? part of a flow, which step?). Also
pending: apply the user's final sound picks as defaults;
page title/forms readouts from the site's Playwright page;
Page view ego layout (when it returns); annotation overlays anchored to element rects; adaptive graph quality.
