# Artemis console notes (draft UI)

Working notes on the console as built so far: vocabulary, views, layout, commands, tests,
browser approach, decisions. Setup steps live in the repository README; the working contract in
`AGENTS.md`.

Artemis helps a Product Manager, a Product Auditor and a UX/UI expert understand a web
application: what each page does and why, how pages chain into flows (registration, applying for
work, a purchase), and where those flows live in the whole. The interface is built first, with
the Arwes sci-fi UI framework and a cosmos.gl GPU graph; functionality attaches behind it later.

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
| **View** | The console's mode: what fills the stage, which commands the card offers, which palette everything uses. Browser (home) and Cosmos are shown; Page is kept in code but hidden. | `V` pulls back from the Browser to the Cosmos, onto the current page, and returns |
| **Lens** | A perspective within a view: same graph, different emphasis. Overview, Clusters, Hubs, Routes, Anomalies. | `1-5`, `Left/Right` |
| **Layer** | An independent toggle drawn on top: links, labels, annotations. | `L` (links) |

## Views

| View | Shows | Palette | Attention accent |
| --- | --- | --- | --- |
| **Cosmos** | The entire network; arriving from the Browser it opens on the current page, selected and zoomed in on | Egyptian blue, base `#1034a6` | gold `#e0b85c` (9.4:1 on panels) |
| **Page** (hidden) | One page and its connections (1 or 2 hops), everything else hidden; the minimap keeps the whole cosmos as context | Orpiment amber, base `#954c00` | pale blue `#9fb6ff` (8.9:1) |
| **Browser** | The website under review, live, filling the stage; the home view after Engage | Viridian, base `#005d2c` | gold `#e0b85c` (8.9:1) |

Two views are shown for the prototype. The Page view is hidden, not removed: its palette,
command set, controller behaviour (subgraph, Depth, Route) and unit tests stay, and clearing
`hidden` on its entry in `src/views.ts` puts it back into the V cycle between the two others.

### Landing on the current page

Pulling back from the Browser (V) opens the Cosmos on the page the browser is on: the node is
selected (focus ring, neighbours highlighted, the rest dimmed, its label tracked), the camera
closes in to x4 with the node at the centre of the stage, the console readout names it (SEL,
TIER, SECTOR, DEG) and the status line says `View: Cosmos. Current page RL-1A selected.`. A
selection made earlier in the Cosmos gives way to the current page on the next pull-back. The
current page is emulated for now (the first relay, `currentPage` in the store) until the browser's
address maps to a node. Frames: `docs/screenshots/cosmos-current-page.png` and `-1280.png`.

The first layout frames itself as it unfolds (fits at ticks 90 and 240, then once settled). Any
camera move the operator causes (this landing, Focus, a target lock, the minimap, a wheel or drag
on the graph) cancels those pending fits, so the camera is never taken off the page by the layout
settling behind it.

The green and amber ramps were derived from the blue ramp by rotating hue in OKLCH at equal
lightness and chroma (amber mid-steps lifted so they read as yellow), then rendered as mock-ups and
contrast-checked: see `docs/palette-sheet.png`. Every text token measures 6.5:1 or better on panels.

Palettes live in `src/views.ts` and are applied as CSS custom properties on `.app`; the stylesheet
uses only tokens (`var(--azure)`, `color-mix(...)`), so a view switch recolours every Arwes frame,
the canvas backgrounds and the WebGL graph.

### The dive (V)

A view switch is a move along the camera's axis (`src/components/Stage.tsx`, Web Animations API):
pulling back (Browser -> Cosmos) the outgoing view falls away into depth; returning to the Browser
it rushes past the camera. The HUD folds; at the midpoint the stage swaps what it
shows and the palette changes; the incoming view arrives from the opposite side while the HUD
reassembles in the new colours. 1.2 s; a plain cross-fade under `prefers-reduced-motion`.
Frames: `docs/screenshots/dive-*.png`.

## Layout (maps to the sketches)

| Sketch element | Implementation |
| --- | --- |
| Header: `T/S  N/S  R/S  Links  Nodes  ~~~  13:11`, double rule | `src/components/Header.tsx` — brand + view badge, live counters, sparkline, sim state, mute, clock |
| Centre stage | `src/components/Stage.tsx` — `GraphCanvas` + `HubLabels` (Cosmos) or `BrowserSurface` (Browser) |
| Bottom-left "map" / "scope" | `src/components/MiniMap.tsx` — second cosmos.gl instance, viewport rectangle, click/drag to pan |
| Bottom-right 3x3 grid with hotkey letters | `src/components/CommandCard.tsx`, per-view sets in `src/commands.tsx` |
| Lens tab bar (chamfered caps, active underline, dashed rail, `<< >>`) | `src/components/Console.tsx` (`TabStrip`); replaced by page readouts in the Browser view |
| Two overlapping views (second sketch) | `src/views.ts` (view model, palettes) + `Stage` (dive) |

## Commands

A and S hold the top row and V the middle row in every view, as drawn in the sketch.

| Key | Cosmos | Page (hidden) | Browser (placeholders) |
| --- | --- | --- | --- |
| A | Target: arm, click a node to lock on | Target | Annotate: pin a note to an element |
| S | Stop: halt / resume the simulation | Stop | Snapshot: capture the page |
| H | Hold: pin the selected node | Hold | Highlight: outline interactive elements |
| V | View: return to Browser | View: pull back to Cosmos | View: pull back to Cosmos, onto the current page |
| F | Focus: zoom to selection; else tour sectors, then fit all | Focus | Flow: mark this page as a step in a flow |
| L | Links on / off | Links | Links: list outbound links |
| D | Disperse: repulsion pulse | Depth: 1 or 2 hops | DOM: inspect the element tree |
| R | Regenerate topology | Route: path to the core (toggle) | Reload |
| X | Clear selection, holds, targeting | Clear | Clear annotations |

Also: `C` hides and shows the bottom panels in every view (the header stays, with a `PANELS ON/OFF`
switch for when C was pressed by mistake; handy for reading a page in the Browser view), `1-5` /
`Left` / `Right` lenses, `Esc` cancel, `M` mute.

Hotkeys reach the console from inside the website too: in the owned browser an isolated-world
preload in every frame of the site forwards plain keys (not while typing in a field) to the
console, so `V` works after clicking into the page; the page still receives the key. An external browser cannot hear keys inside a cross-origin frame; the
command card then says "Keyboard is in the page. Click the console to use hotkeys."

## Debug page and sounds

`http://127.0.0.1:5173/debug` is a page of its own for trying things in isolation; it does not
start the console. **Sounds** lists every sound Artemis can make, each with Play and a page-local
volume, in three groups: the file sounds shipped today (free sample files from the Arwes
repository; development only, since Arwes' real sound set is licensed to its website), the
`bright` synthesized set (square and sawtooth, instant attacks) and the `soft` set, designed in
the spirit of StarCraft's interface sounds: sine and triangle only, everything low-passed under
about 3 kHz, a few milliseconds of attack on every step, shaped noise for the hiss of a panel
sliding, long gentle sweeps for the view dive (`src/synth.ts`; the tests hold the family to those
rules). **Actions** lists every moment the console makes a sound, what it plays today, and a
candidate selector per action with Play.

The console plays by action (`src/sounds.ts`: hover, click, command-ok, command-error, notice,
text, engage, view-dive, panels-open, panels-close), each mapped to a sound by default. **Apply
to the console** stores the picks in `localStorage` (`artemis.sfx.overrides`) and the real
console plays them immediately, in context; **Reset** returns to the defaults; **Copy
suggestions** renders the picks as `action -> sound` lines to paste back so they become the
defaults in code. Text deciphering is driven by Arwes' own bleep hook and takes file sounds only
for now.

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
- `tests/views.test.ts` — view order and depth, the Page view kept but hidden (V cycles Browser <-> Cosmos), palettes carry the approved values and the same tokens.
- `tests/controller.test.ts` — view/lens state, transition lifecycle, landing on the current page when pulling back from the Browser (selected, focused, zoomed in on, labelled, announced; an earlier selection gives way), the first layout's auto-fit and its cancellation by any operator camera move (landing, Focus, wheel/drag), Focus absorbing Vision (real controller, fake GPU boundary).
- `tests/commands.test.ts` — nine commands per view with A/S/V fixed, V hints for the two shown views, Depth and Route, Page subgraph (BFS) and framing, minimap context (the Page view's behaviour stays tested while hidden).
- `tests/integration.test.ts` — real Chromium against an isolated Vite server: the header shows a live FPS readout and `--` for machine figures outside the owned browser; C folds the panels away and back in both views, the header switch does the same, and a view change leaves them as they were; the entry screen refuses to start without a website and carries the address into the console; Engage lands in the Browser view; V pulls back to the Cosmos and returns, palette variables change, command card and tab strip swap, no Page view on the way; the Cosmos opens on the current page (selected, label at the stage centre, zoom readout x4, named in the readout) and stays there while the first layout settles; the stage shows the old view until the midpoint, reduced motion still completes, lenses keep working.
- `tests/metrics.test.ts`, `tests/quality.test.ts` — frame statistics, machine CPU/memory/process-tree parsing, graph pixel-ratio budget.
- `tests/sounds.test.ts`, `tests/debug.test.ts`, `tests/debug-page.test.ts` — action routing and override persistence; catalogue integrity; the soft family's rules; `/debug` in real Chromium: every synthesized preset plays without errors, a pick applied on `/debug` is what the real console's hover plays, Reset restores the defaults.
- `tests/shell-logic.test.ts` — where the native site view goes (shown only engaged, in the Browser view, not diving), which clicks pass through to the site (everywhere but the panels), resuming the engaged website after a console reload (garbage, non-web addresses and refusing storage resume nothing).
- `tests/shell.test.ts` — the owned browser as an Electron shell under Playwright, windows hidden: launching without a console server fails fast and says why; a fixture site that refuses framing and hides its body unless it is the top window (the Microsoft sign-in defense) runs top-level and visible under the console, with no iframe, sits exactly in the slot, and is followed through a redirect by the address strip; `V` typed in the site dives (the site view steps aside and returns on the same page), `v` typed in a site field stays in the field; clicks pass through over the site and stay over the header; a console reload comes back engaged on the same site page without sending the site back to the start; machine readouts arrive.
- `tests/owned-browser.test.ts` — the earlier framed owned browser (still in the tree, no longer launched): CSP/cookie rewriting; machine readouts (CPU, ARTEMIS, MEM) arrive from the Bun side; a framable site goes live in an ordinary browser and fills the stage edge to edge; clicking into the page shows the keyboard hint there; a site refusing framing stays blank in an ordinary browser and works, with its session, in the owned browser, where `V` still switches views with the keyboard inside the page. Links aimed at the top window or a new tab, and redirects, stay inside the frame and land on the final address with no extra window.

## Browser view: the real website

The website fills the stage edge to edge, from a glass address strip under the header down to the
bottom of the screen; the bottom panels float over the page, each on its own glass, so the page
stays visible and usable around them. The strip shows the address the browser is on and the state:
`EXTERNAL` or `OWNED`, then `CONNECTING` / `LIVE`.

- **Owned browser** (`bun run artemis`): an Electron shell (`shell/main.ts`, launched under
  Playwright by `server/shell.ts`, profile in `data/shell-profile`). The website is a genuine,
  unmodified Chromium page, top-level, in a native view placed exactly where the console's slot
  is; the unchanged console sits over it in a transparent window. Over the site, clicks pass
  through to it (`setIgnoreMouseEvents` with forwarding); over the header, address strip and
  bottom panels they stay with the console. Nothing rewrites the site's headers or cookies, so
  sign-in flows that refuse frames (Microsoft, PingOne, MFA) work as in any browser. The only code
  of Artemis in the site's renderer is `shell/site-preload.ts`, in an isolated world: it reports
  whether focus is in a field and forwards plain keys as hotkeys. The site view steps aside during
  a dive and outside the Browser view, keeping its page; a console reload (right-click Reload,
  Cmd+R) comes back engaged on the same page (`src/resume.ts`). The right-click menu on the site
  has Back, Forward, Reload, Cut/Copy/Paste and Inspect Element. Sites see Chrome, not Electron;
  Google blocks "Sign in with Google" in embedded browsers, an accepted limitation. Playwright owns
  the shell: the site is an ordinary Playwright page for automation, video and tracing.
  `context.storageState()` is refused by Electron; cookies save and restore through
  `context.cookies()` / `addCookies()` (spike 003).
- **External browser** (`bun run dev`, your own Chrome): the site loads in a sandboxed `<iframe>`
  (no `allow-top-navigation`); sites sending `X-Frame-Options` or CSP `frame-ancestors` stay
  blank, and a footnote says so.
- **Earlier framed owned browser** (`server/owned-browser.ts`, kept in the tree, no longer
  launched): Artemis ran as the top-level page inside a chromeless
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
`docs/screenshots/browser-live.png` shows Wikipedia live inside the console. Why the frame was
replaced: `docs/spikes/002-streamed-browser.md` (streamed tab: works, but imitates input and
browser-drawn widgets) and `docs/spikes/003-electron-shell.md` (the chosen design, with its
Playwright findings). `docs/screenshots/shell-browser-1440.png` and `-1280.png` show the shell,
composed from its own captures (`scripts/screenshots-shell.ts`). The darker cast over the site
comes from the slot's navy backing showing through the console (`.browser-slot`); kept for now,
a candidate Layer to switch off for colour and contrast reviews.

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
