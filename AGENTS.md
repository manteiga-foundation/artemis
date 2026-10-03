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

- **View** - the console's mode: Browser (home after Engage), Page, Cosmos. `V` pulls back
  Browser -> Page -> Cosmos and wraps back into the Browser.
- **Lens** - a perspective inside a view: Overview, Clusters, Hubs, Routes, Anomalies (`1-5`).
- **Layer** - an independent toggle (Links, labels, annotations).
- **Command card** - the 3x3 grid; A and S keep the top row, V the middle row, in every view.
- **Owned browser** - the chromeless Chromium `bun run artemis` launches with Artemis as its page.
- **Dive** - the depth transition between views.

## How we work: the methodology

Every slice follows the same loop. Do not skip steps because a change looks small; the small ones
(a CSS rule, an animator without children) are the ones the tests caught.

1. **RED first.** Write the failing test before the code: a unit test for logic (`tests/*.test.ts`,
   run with the fake window/renderer in `tests/harness.ts` when the controller is involved), a
   Playwright test in real Chromium for behaviour (`tests/integration.test.ts`,
   `tests/owned-browser.test.ts`, `tests/debug-page.test.ts`). Run it and see it fail for the
   right reason.
2. **GREEN.** The smallest change that passes. Then refactor if needed with the tests still green.
3. **Gates before "done":** `bun run check` (tsc for app and server), `bun run test` (all), and
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
bun run check                    # tsc --noEmit for src and server
bun run test                     # bun test --timeout 60000 tests  (unit + Playwright)
bun run build                    # check + production bundle
bun run artemis                  # the owned browser (starts the dev server if needed)
bun run scripts/screenshots.ts <port> [outDir] [site]
bun run scripts/screenshots-browser.ts <port> [outDir] [site]   # live site in the owned browser
bun run scripts/screenshots-entry.ts <port> [outDir]
bun run scripts/screenshots-debug.ts <port> [outDir]
bun run scripts/measure-dive.ts <port>                          # fps idle and through the dive
```

Playwright's Chromium: `bunx playwright install chromium`. GPU in headless on macOS:
`--use-angle=metal --enable-gpu --ignore-gpu-blocklist`.

## Conventions that tests depend on

- Palettes are CSS custom properties set on `.app` from the *shown* view (`src/views.ts`). New CSS
  uses `var(--token)` and `color-mix`; never a literal hex or rgba (it leaks when the palette
  switches).
- Accessible names are the test API: textbox "Web App", button "Engage", buttons "View (V)",
  "Depth (D)", "Annotate (A)", "Panels (C)", tablist "Lenses". Change them only with the tests.
- `window.__artemis = getState` is exposed in DEV by `main.tsx`; tests and scripts read it.
  Never `import('/src/store.ts')` from a test (Vite HMR history makes a second instance).
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
src/sounds.ts, sfx.tsx  sound definitions / playing          src/debug/           /debug page, synth presets
server/owned-browser.ts the owned Chromium: unframing, cookies, frame agent, redirects
server/machine.ts       machine CPU/memory/process-tree feed
tests/harness.ts        fake window + renderer for controller tests;  tests/vite.ts  isolated Vite
```

## Standing decisions (do not re-litigate without the user)

- Streamed (CDP screencast) browser was validated and set aside; the framed approach in the owned
  browser is the design. Under review with the user since spike 002
  (`docs/spikes/002-streamed-browser.md`): the frame blanks Microsoft sign-in, the stream carries it.
  Injecting HUD panels into the site's DOM was rejected.
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

Done: three views with palettes and the dive; entry screen with the website field; Browser view
showing the real site (external and owned browser); `C` panels fold with header switch; hotkeys
reach the console from inside the framed site; real resource readouts; `/debug` with sounds.

Spike 002: a streamed top-level tab in the Browser view carries the staging site -> PingOne -> Microsoft
sign-in the frame blanks (60 fps at 2x on an idle machine; select popups and 2x decode under load
are the open costs). Whether it replaces the frame is the user's call.

Next: the user is designing more interface elements (node selection, annotations, ...), each
built with emulated data first. Also pending: apply the user's final sound picks as defaults;
Back / Forward / Reload and page title/forms readouts from the owned browser's Playwright page;
Page view ego layout; annotation overlays anchored to element rects; adaptive graph quality.
