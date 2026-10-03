# Artemis — Product Understanding Console (Draft UI)

Artemis helps a Product Manager, a Product Auditor and a UX/UI expert understand a web
application: what each page does and why, how pages chain into flows (registration, applying for
work, a purchase), and where those flows live in the whole. The interface is built first, with
the Arwes sci-fi UI framework and a cosmos.gl GPU graph; functionality attaches behind it later.

Working on the code? `AGENTS.md` is the working contract: methodology (test-first, real-browser
verification, screenshots, gates), vocabulary, conventions the tests depend on, standing decisions.

## Run

```bash
bun install
bun run dev        # http://127.0.0.1:5173
bun run check      # TypeScript
bun run test       # unit tests + Playwright integration tests (isolated Vite server, headless Chromium)
bun run build      # check + production bundle in dist/
bun run preview    # serve dist/ at http://127.0.0.1:4173
bun run artemis    # open Artemis in the browser it owns (starts the dev server if needed)
bun run scripts/screenshots.ts 5173        # documentation screenshots from a running dev server
bun run scripts/screenshots-entry.ts 5173  # entry screen states
```

The entry screen ("Web Application Intelligent Console") asks for the web app under review. Type
a domain or URL (`example.com`, `https://app.example.com/start`; bare domains become `https://`,
only http/https are accepted) and press **Engage** or Enter. Nothing starts without a valid address; the host then shows in the header,
the Browser view address line and the console readouts. Browsers only allow audio after a user
gesture, so the console assembles and the intro sound plays at that moment.

## Vocabulary

| Word | Meaning | Keys |
| --- | --- | --- |
| **View** | The console's mode: what fills the stage, which commands the card offers, which palette everything uses. Browser (home), Page, Cosmos. | `V` pulls back (Browser -> Page -> Cosmos) and wraps back in |
| **Lens** | A perspective within a view: same graph, different emphasis. Overview, Clusters, Hubs, Routes, Anomalies. | `1-5`, `Left/Right` |
| **Layer** | An independent toggle drawn on top: links, labels, annotations. | `L` (links) |

## Views

| View | Shows | Palette | Attention accent |
| --- | --- | --- | --- |
| **Cosmos** | The entire network | Egyptian blue, base `#1034a6` | gold `#e0b85c` (9.4:1 on panels) |
| **Page** | One page and its connections (1 or 2 hops), everything else hidden; the minimap keeps the whole cosmos as context | Orpiment amber, base `#954c00` | pale blue `#9fb6ff` (8.9:1) |
| **Browser** | The website under review, live, in a sandboxed frame filling the centre; the home view after Engage | Viridian, base `#005d2c` | gold `#e0b85c` (8.9:1) |

The green and amber ramps were derived from the blue ramp by rotating hue in OKLCH at equal
lightness and chroma (amber mid-steps lifted so they read as yellow), then rendered as mock-ups and
contrast-checked: see `docs/palette-sheet.png`. Every text token measures 6.5:1 or better on panels.

Palettes live in `src/views.ts` and are applied as CSS custom properties on `.app`; the stylesheet
uses only tokens (`var(--azure)`, `color-mix(...)`), so a view switch recolours every Arwes frame,
the canvas backgrounds and the WebGL graph.

### The dive (V)

A view switch is a move along the camera's axis (`src/components/Stage.tsx`, Web Animations API):
pulling back (Browser -> Page -> Cosmos) the outgoing view falls away into depth; wrapping back into
the Browser it rushes past the camera. The HUD folds; at the midpoint the stage swaps what it
shows and the palette changes; the incoming view arrives from the opposite side while the HUD
reassembles in the new colours. 1.2 s; a plain cross-fade under `prefers-reduced-motion`.
Frames: `docs/screenshots/dive-*.png`.

## Layout (maps to the sketches)

| Sketch element | Implementation |
| --- | --- |
| Header: `T/S  N/S  R/S  Links  Nodes  ~~~  13:11`, double rule | `src/components/Header.tsx` — brand + view badge, live counters, sparkline, sim state, mute, clock |
| Centre stage | `src/components/Stage.tsx` — `GraphCanvas` + `HubLabels` (Cosmos, Page) or `BrowserSurface` (Browser) |
| Bottom-left "map" / "scope" | `src/components/MiniMap.tsx` — second cosmos.gl instance, viewport rectangle, click/drag to pan |
| Bottom-right 3x3 grid with hotkey letters | `src/components/CommandCard.tsx`, per-view sets in `src/commands.tsx` |
| Lens tab bar (chamfered caps, active underline, dashed rail, `<< >>`) | `src/components/Console.tsx` (`TabStrip`); replaced by page readouts in the Browser view |
| Two overlapping views (second sketch) | `src/views.ts` (view model, palettes) + `Stage` (dive) |

## Commands

A and S hold the top row and V the middle row in every view, as drawn in the sketch.

| Key | Cosmos | Page | Browser (placeholders) |
| --- | --- | --- | --- |
| A | Target: arm, click a node to lock on | Target | Annotate: pin a note to an element |
| S | Stop: halt / resume the simulation | Stop | Snapshot: capture the page |
| H | Hold: pin the selected node | Hold | Highlight: outline interactive elements |
| V | View: return to Browser | View: pull back to Cosmos | View: pull back to Page |
| F | Focus: zoom to selection; else tour sectors, then fit all | Focus | Flow: mark this page as a step in a flow |
| L | Links on / off | Links | Links: list outbound links |
| D | Disperse: repulsion pulse | Depth: 1 or 2 hops | DOM: inspect the element tree |
| R | Regenerate topology | Route: path to the core (toggle) | Reload |
| X | Clear selection, holds, targeting | Clear | Clear annotations |

Also: `C` hides and shows the bottom panels in every view (the header stays, with a `PANELS ON/OFF`
switch for when C was pressed by mistake; handy for reading a page in the Browser view), `1-5` /
`Left` / `Right` lenses, `Esc` cancel, `M` mute.

Hotkeys reach the console from inside the website too: in the owned browser an init script in
every frame forwards plain keys (not while typing in a field) to the console, so `V` works after
clicking into the page. An external browser cannot hear keys inside a cross-origin frame; the
command card then says "Keyboard is in the page. Click the console to use hotkeys."

## Debug page

`http://127.0.0.1:5173/debug` (any served path `/debug`) is a page of its own for trying things in
isolation; it does not start the console. First section: **Sounds**. It lists every sound Artemis
can make, each with Play and a page-local volume: the file sounds shipped today (the free sample
files from the Arwes repository; fine for development, not for publishing, since Arwes' real sound
set is licensed to its website) and a set of synthesized bleeps generated by Artemis itself with
Web Audio (`src/debug/synth.ts`, no files, no licence). The **Actions** table shows every place the
console makes a sound, what it plays today, a candidate selector per action with Play, and a
"Copy suggestions" button that renders the picks as `action -> sound` lines to paste back.

## Resource readouts and performance

The header's stats are real: `FPS` is the frame rate Artemis itself renders (tooltip: worst frame
and main-thread busy time; the sparkline is the last 60 s), `CPU` is the machine's CPU over the
last 2 s, `ARTEMIS` is the share of the machine's CPU used by Artemis' own browser processes, and
`MEM` is machine memory in use the way Activity Monitor counts it (tooltip adds Artemis' JS heap).
Values turn the alert colour when FPS drops below 30, CPU reaches 85% or memory 90%. CPU, ARTEMIS
and MEM need the owned browser (`bun run artemis`), which samples them on the Bun side
(`server/machine.ts`); an ordinary browser cannot see the machine and shows `--`.

Reading it: a low `FPS` with a high `CPU` and a low `ARTEMIS` means the machine is the
bottleneck, not Artemis. The console is tuned for 60 fps through the view dive at 1440x900 and
in full screen on a 2x display; the WebGL graph renders at the device pixel ratio up to 16 Mpx
(`src/quality.ts`), coming down only on 5K-class stages. `bun run scripts/measure-dive.ts [port]`
measures idle and dive frame rates at several sizes with and without the blur effects, and
`?gpr=<n>` on the URL forces the graph pixel ratio for comparisons. Measure on a quiet machine:
load from other software (or the measuring browsers themselves) swamps everything.

## Tests

- `tests/target.test.ts` — website normalisation (bare domains, rejected schemes) and engaging the console with and without a valid address.
- `tests/views.test.ts` — view order, dive direction, palettes carry the approved values and the same tokens.
- `tests/controller.test.ts` — view/lens state, transition lifecycle, Focus absorbing Vision (real controller, fake GPU boundary).
- `tests/commands.test.ts` — nine commands per view with A/S/V fixed, Depth and Route, Page subgraph (BFS) and framing, minimap context.
- `tests/integration.test.ts` — real Chromium against an isolated Vite server: the header shows a live FPS readout and `--` for machine figures outside the owned browser; C folds the panels away and back in every view, the header switch does the same, and a view change leaves them as they were; the entry screen refuses to start without a website and carries the address into the console; Engage lands in the Browser view; V walks Browser -> Page -> Cosmos -> Browser, palette variables change, command card and tab strip swap, the stage shows the old view until the midpoint, reduced motion still completes, lenses keep working.
- `tests/metrics.test.ts`, `tests/quality.test.ts` — frame statistics, machine CPU/memory/process-tree parsing, graph pixel-ratio budget.
- `tests/debug.test.ts`, `tests/debug-page.test.ts` — sound catalogue integrity and action mapping; `/debug` in real Chromium: plays a synthesized and a file sound without errors, assigns a candidate to an action, copies the suggestions.
- `tests/owned-browser.test.ts` — CSP/cookie rewriting; machine readouts (CPU, ARTEMIS, MEM) arrive from the Bun side; a framable site goes live in an ordinary browser and fills the stage edge to edge; clicking into the page shows the keyboard hint there; a site refusing framing stays blank in an ordinary browser and works, with its session, in the owned browser, where `V` still switches views with the keyboard inside the page. Links aimed at the top window or a new tab, and redirects, stay inside the frame and land on the final address with no extra window.

## Browser view: the real website

The website under review loads in a sandboxed `<iframe>` (no `allow-top-navigation`, so a
frame-busting site cannot take over the console) that fills the stage edge to edge, from a glass
address strip under the header down to the bottom of the screen; the bottom panels float over the
page, each on its own glass, so the page stays visible and usable around them. The strip shows the
address and the state: `EXTERNAL` or `OWNED`, then `CONNECTING` / `LIVE`.

- **External browser** (`bun run dev`, your own Chrome): works for sites that allow framing;
  sites sending `X-Frame-Options` or CSP `frame-ancestors` stay blank, and a footnote says so.
- **Owned browser** (`bun run artemis`): Artemis runs as the top-level page inside a chromeless
  Chromium that Playwright launches (`server/owned-browser.ts`, profile in `data/browser-profile`).
  For documents loaded into sub-frames Playwright removes `X-Frame-Options` and `frame-ancestors`
  and rewrites `Set-Cookie` to `SameSite=None; Secure`, so any site can be framed and keeps its
  session while you click through it. Artemis's own requests are untouched. A small agent runs in
  every frame of the site: links and forms aimed at the top window or a new tab (`target="_top"`,
  `_parent`, `_blank`, `<base target>`, `window.open(url, '_top')`), which sites use once they
  notice they are framed, are retargeted at the frame itself; redirects are replayed as frame
  navigations so each hop is rewritten and the frame ends on the final address. The same
  Playwright page will provide the DOM, element rectangles, forms and network activity for
  annotations and flows.

Proof (`tests/owned-browser.test.ts`): a fixture site that refuses framing and sets a
`SameSite=Lax` session cookie stays blank in an ordinary browser, and in the owned browser is
framed, navigates on a click inside the frame, and still has its cookie on the second page.
`docs/screenshots/browser-live.png` shows Wikipedia live inside the console. Validation of the
streamed alternative is kept in `docs/spikes/001-live-browser-view.md`.

## Arwes usage

- `AnimatorGeneralProvider`, `Animator`, `Animated` — staggered assemble/disassemble of every panel
- `FrameOctagon`, `FrameCorners`, `FrameKranox`, `FrameLines` — panel and button frames (colours via CSS custom properties)
- `Text` (decipher) — header labels, console messages, entry screen
- `BleepsProvider`, `useBleeps`, `BleepsOnAnimator` — UI sounds
- `GridLines`, `Dots` (cross), `MovingLines` — background, recoloured per view
- `createEffectIlluminator` — pointer glow on panels, in the view's hue

## Notes and placeholders

- `T/S`, `N/S`, `R/S` are a simulated feed (`useTelemetry` in `src/hooks.ts`).
- The network is procedurally generated (`src/graph/data.ts`, about 2,000 nodes); the "current page" defaults to the first relay until a browser is attached.
- Pinned to `@arwes/react@1.0.0-alpha.23`, React 18, mounted without `StrictMode` as Arwes requires.
- Playwright's Chromium is required for the integration tests and the owned browser: `bunx playwright install chromium`.
- In development the app exposes its store as `window.__artemis` for tests and scripts (importing `/src/store.ts` from outside creates a second instance once Vite has HMR history).

## Credits

- Sounds: Arwes project UI sounds (MIT), from `github.com/arwes/arwes/static/assets/sounds`.
- Icons: Game-icons.net (CC BY 3.0) via `react-icons/gi`; the View glyph (stacked layers) is Font Awesome Free (CC BY 4.0) via `react-icons/fa6`. Attribution is required if distributed.
- Fonts: Titillium Web and JetBrains Mono (SIL OFL) via Fontsource.
