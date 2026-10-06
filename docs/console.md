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
bun run artemis    # open Artemis in the browser it owns (starts the dev server if needed); add a website to engage it at once
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

In the recorded cosmos (the owned browser) the landing keeps the page selected and at the centre
but frames the whole recording around it instead of the fixed x4: every node and its mirror
through the page, with a least width of 440 space units for a lone page. The fixed close-up came
from the emulated network; on a recorded back office (staging.example: fifty to eighty
calls a page) whose current page was a handler link at the edge, it showed one dot and a line, and
the cosmos looked empty although it held 486 nodes. Seen whole, labels collide, so they give way
(`HubLabels.tsx`): the selected page's first, then the core's, the sections', the rest; a label
that would overlap a shown one fades out, and zooming in brings it back.

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
| H | Hold: pin the selected node | Hold | (Highlight was here; Autopilot took the slot, see D) |
| V | View: return to Browser | View: pull back to Cosmos | View: pull back to Cosmos, onto the current page |
| F | Focus: zoom to selection; else tour sectors, then fit all | Focus | Flow: mark this page as a step in a flow |
| L | Links on / off | Links | Links: list outbound links |
| D | Disperse: repulsion pulse | Depth: 1 or 2 hops | **Autopilot** (top-right slot, a yoke with three squares for the speed): each press steps off, slow, regular, max, off |
| O | | | DOM: inspect the element tree (moved from D) |
| R | Regenerate topology (emulated); in the owned browser the slot holds **E Scope**: show or hide hosts outside the review scope | Route: path to the core (toggle) | Reload |
| X | Clear selection, holds, targeting | Clear | Clear annotations |

Also: `,` opens and closes the configuration view (below), `C` hides and shows the bottom panels in every view (the header stays, with a `PANELS ON/OFF`
switch for when C was pressed by mistake; handy for reading a page in the Browser view), `1-5` /
`Left` / `Right` lenses, `Esc` cancel, `M` mute.

Hotkeys reach the console from inside the website too: in the owned browser an isolated-world
preload in every frame of the site forwards plain keys (not while typing in a field) to the
console, so `V` works after clicking into the page; the page still receives the key. An external browser cannot hear keys inside a cross-origin frame; the
command card then says "Keyboard is in the page. Click the console to use hotkeys."

## Autopilot (D, Browser view)

From the user's sketch, a pilot's control: a yoke with three squares under it for the speed, hotkey
D, in the Browser view's top-right slot (Highlight, the bulb, was removed; DOM moved from D to O).
Only in the Browser view for now; in the Cosmos D is still Disperse. Each press steps the speed:
off, slow (about 10 s a page, scrolling down it, for a person to glance at), regular (about 3 s, no
scrolling), max (the next page as soon as one has loaded, to cover the whole site), off. The
squares fill up to the speed, the button lights in flight, the console's readout says `MODE
AUTOPILOT SLOW` (or REGULAR, MAX) instead of REVIEW, and each step says what it does. Game-icons
has no yoke (a car's steering wheel, a ship's wheel), so it is drawn in `src/icons.tsx` on the
same 512 grid; the first drawing (tall arms) read as a slingshot, the wide shallow one with grips
reads as a yoke.

It flies in the owned browser: the console sends the speed over the bridge (`autopilot`) and the
shell reports the flight back (`autopilot-status`: progress with pages visited, pages to go and
time left; the site covered; the operator taking the controls, which disengages it like a real
autopilot). In an ordinary browser only the controls answer, and it says so. The user's rules for
the flight: respect routes so the cosmos is not a single long line (branch by branch: open each
link of a page and come back to it before the next), never repeat what is already in the cosmos,
never get stuck.

The flight plan (`server/autopilot.ts`, pure logic over a driver, no language model): from the
page the site is on, open each in-scope link in turn and come back (Back, or the page's address
when Back lands elsewhere) before the next; then expand the pages found, in the order found (the
core's sections, then theirs). Each new page is reached from the page that links to it, so the
cosmos, which hangs a page under the page it was first reached from, grows as a tree around the
core. Pages already in the cosmos are never visited again, though recorded pages' links are
explored; a page's links are read while it is visited, so a page with nothing new is never gone
back to. Two or three pages of each kind, by address template (numbers, uuids, long hex in the
path stand for any). Links only, never forms; never sign-out, log-out, delete, unsubscribe,
deactivate; never mail, phone, script or file links, other hosts, or anchors on the same page;
subdomains are in scope. A link that goes nowhere, a redirect out of the scope, a Back that does
not return and loops are passed and noted; 25 failures in a row end the flight as stuck. Progress
counts pages visited and pages found but not yet visited, and the time left is that count times the
flight's measured pace (a per-speed estimate before the first page). The page key is shared with
the cosmos (`pageKeyOf` in `src/scope.ts`), so "already in the cosmos" means the same thing on
both sides. These choices steer navigation only; nothing is stored as a category.

Flying the owned browser (`server/autopilot-driver.ts`, started by `server/shell.ts` beside the
recorder): it polls the speed the shell keeps (`shell/autopilot-state.ts`, set by the console over
the bridge) every 200 ms and flies while it is not off, starting from the page the site is on with
everything already recorded counted as known. Clicks are real input through Playwright on the
site's page (a link it cannot click, hidden or covered, is reached by its address, still from the
page that links to it), and the shell marks the moments the autopilot acts, so its clicks land in
the session database with `actor = 'autopilot'`; everything else is the operator's. Slow stays
about 10 s on a page and scrolls it down in about 32 smooth steps; regular stays about 3 s; max
goes on once the page has loaded; a change of speed applies mid-page and off stops it within a
quarter second. The operator's click, wheel, scrolling keys or typing in the site while it flies
disengage it, like a pilot taking the yoke: the console says "Autopilot disengaged: you took the
controls." and the site stays exactly where it was (the first version still went Back after the
page's dwell; the end-to-end test caught it). Scripted scrolling fires no wheel event, so the
autopilot's own scrolling never counts as a hand on the controls. Progress goes to the console as
"Autopilot: max · 4 pages visited, 6 to go, about 1 min left · <address>"; at the end, "the site is
covered. N pages visited, nothing left to open." and the speed returns to off; too many dead links
in a row, or a site that stops answering, stop it with the reason. A report still on its way when
the flight was turned off is ignored. While it flies the operator can pull back to the Cosmos (V)
and watch the tree grow; D there is still Disperse, so the speed is changed from the Browser view.

While it flies, a soft glow in the palette's accent runs around the edges of the whole window, over
the header and the panels (`AutopilotGlow.tsx`, the user's idea: something is going on, besides the
button). It fades in and out with the flight, breathes faster with the speed (about 4.2 s a breath
at slow, 2.6 s at regular, 1.4 s at max), holds steady under reduced motion, stays on in the Cosmos,
and takes no click (`pointer-events: none`, so the owned browser's pass-through, which hit-tests
with `elementFromPoint`, never sees it). The first strength was measured too faint over a light
site (edge pixels moved by about 20 levels, a vision model saw nothing); it is now a 2 px rim with
two softer layers inside. Frame: `docs/screenshots/autopilot-glow.png`.

Its progress is in the top bar (the user's pick from four candidates rendered in place: the top
bar, the address strip's bottom edge, the glow's bottom edge, the console panel; sheet in
`docs/screenshots/autopilot-progress-candidates.png`). While it flies, the frame-rate graph's box
dims its graph and becomes the flight bar (`Header.tsx` FlightBar, `flightBar` in
`src/autopilot.ts`): pages visited of the pages known so far, filled in the accent, labelled
`AP 12/40 · 3 MIN`, `AP · STARTING` before the first report; a progressbar named "Autopilot
progress" whose value text and tooltip say it in words. It can step back when the site turns out
bigger than it knew. The header has about 10 px to spare at 1280 wide (holding the box at the
label's width overflowed it by 86 px), so a container query on the box shows only the count
(`12/40`) when it is narrower than 140 px. It is there in both views and with the panels folded,
and goes with the flight. The graph is the console's frame rate (the user took it for requests per
second; a requests readout could be its own idea). Frames: `docs/screenshots/flight-bar.png`,
`flight-bar-1280.png`.

Dialogs and popups (`server/site-dialogs.ts`, found by the user: an alert or a popup broke the
flight and left Artemis taking no click or key). Electron shows each alert, confirm or prompt as
its own native box and closes it only when the page navigates; Playwright, attached for the
recorder and the autopilot, answered every dialog by itself (Cancel, invisibly), so the site got an
answer no one gave and the box stayed up as an app-wide modal. Now Artemis listens for the site's
dialogs, which stops Playwright answering: the operator's are theirs (the native box, the site
waits for a person, as in any browser); while the autopilot flies it answers by its rule (OK to an
alert, Leave to a leave-this-page question, Cancel to a confirm or a prompt: it never deletes),
says so on the console ("Autopilot: the site's confirm "Delete this record?" answered Cancel"),
and does not stay on that page: the navigation on is what closes Electron's box. If it lands right
after a page talked back, with no navigation since, it loads that page again, so whatever the site
says then is asked of the operator in a live box. Measured on the way: a no-op same-document
navigation (`history.replaceState` to the same address, in an isolated world, invisible to the
site) closes the box of a dialog raised after the page loaded but not of one raised while it
loads; a hash change closes both but the site would see it; focusing or hiding the view closes
neither. Popups the site opens while it flies are its doing: it closes them and says so; the
operator's popups (a sign-in window) are never touched.

## Configuration view (`,`)

From the user's sketch: Settings with a search field and the categories on the left, the chosen
category's description and options as checkboxes on the right, Apply at the bottom right; the
side panel of the sketch is the command card and the rounded square the scope map, both where they
always are. It is not a third view in the V cycle: the header's cog button (`Settings (,)`) or the
`,` key opens it over whichever view is shown, and `,`, `Esc` or V closes it back to that view. The
header badge and the command card's title read SETTINGS while it is open. In the owned browser the
native website steps aside while it is open (`slotLayout`) and comes back on close.

The window covers the stage from under the header to just above the bottom panels. Its bottom edge
is measured from the panels (the command card is the tallest), not set per screen size: the first
version used fixed offsets and the Apply button sat under the command card, which the integration
test caught; with the panels folded away (C) it takes the whole height.

Categories, in the sketch's order: Scope (include subdomains, ...), Export (HAR, JSON, CSV, masking),
LLM connections (one per role: Categorization, Intelligence, Security), Sound, Autopilot (logic
based), Copilot (LLM), Defaults (site video, console video, HAR, asset bodies). Only Sound works
for real in this slice ("Sound on when Artemis starts": Artemis starts muted when it is off, and
Apply sets it at once); every other category is interface with emulated options and says
"Interface only for now". Search matches category names and descriptions (all of the category) or
option labels and hints (only those options), shows a count per category, and says when nothing
matches.

Changes wait in a draft: the footer counts them ("1 change not applied"), the card's A lights while
one waits, Apply saves them to the browser's storage (`artemis.settings`, merged with the defaults on
load so options added later get their default) and closing discards what was not applied, saying
so. Settings live in `src/settings.ts` (categories, defaults, load, save, search) and
`src/settings-session.ts` (the draft over the store, shared by the surface and the card).

| Key | Settings command |
| --- | --- |
| A | Apply the changes (lit while one waits) |
| S | Search: focus the search field |
| N | Next category (only those a search found) |
| V | Close and return to the view it was opened over |
| E | Export the settings in effect as `artemis-settings.json` |
| I | Import: interface only for now |
| D | Defaults: every setting back to its default (Apply to keep) |
| R | Reset: this category back to its defaults (Apply to keep) |
| X | Discard the changes not applied |

Hotkeys now skip only text fields: a focused checkbox or button no longer swallows them (`,` closes
the settings with a checkbox focused).

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

## Recording sessions (owned browser)

`bun run artemis` records every browsing session into its own SQLite file under `data/sessions/`
(`20261004T194512-shop.example.sqlite`): the session file is the database, and importing a session
later means opening it. The recorder (`server/recorder.ts`) runs on the Bun side next to the
machine feed. Traffic comes from Playwright, which owns the shell, so nothing is added to the
site's page. The operator's actions come from the isolated site preload through the shell's main
process (a queue drained every 100 ms). The page reports later than the network, so actions are
matched to page views and requests by time, not by arrival order.

What is stored (`server/session-store.ts`; observations only, nothing guessed about what a page is):

| Table | Holds |
| --- | --- |
| `sessions` | target, the scope host (target host without `www.`), start and end |
| `visits` | each page view: address, `document` or `same-document` (history API), status, title, and the action that led to it (an action at most 5 s earlier, while the previous page was open) |
| `actions` | click, input (once per field, when typing pauses), submit; who did it (`actor`: `user` now, `autopilot` later); the element as a person or Playwright finds it (role, accessible name, tag, selector, href, field name and type); the value as typed, password-like fields marked `sensitive` |
| `requests` | every request of the site: method, URL, host, resource type, navigation or not, frame, redirect chain, request headers and body, status, response headers and body, timing; the page view and the latest earlier action in it (late-reported actions re-credit later requests) |
| `bodies` | request and response bodies by SHA-256, stored once |

Policy: response bodies are kept for documents and API calls (`fetch`, `xhr`) up to 5 MB; images,
scripts, styles, fonts and media keep metadata only. Cookies, `Authorization`, API keys and
anti-forgery tokens are stored and marked sensitive in the header lists, so each export decides.
Typed values are stored as typed while testing; exports will mask what is marked sensitive.

A missing body always says why (`res_body_note`): `too large`, or `unavailable`. Chromium only keeps
the bytes of a response the page actually reads; a response the page ignores (fire-and-forget
`fetch`, beacons) can be discarded before it can be read, so it is recorded with its headers and
the note. Bodies are requested the moment a response arrives, because a navigation discards them.

Measured on Wikipedia (main page, one article link, a search typed): 2 page views, 70 requests in
5 s, a 600 KB file; 8 bodies (262 KB) for the documents and API calls, metadata only for 37 images,
20 scripts, 4 stylesheets and 4 beacons; 17 requests credited to the search typing.

**Written as it happens, readable by other tools.** Every page view, action, request and response
is committed the moment it is seen; nothing waits for the session to close. SQLite in WAL mode puts
each commit in the `-wal` side file first, which another program opening the database reads at
once, but which left the `.sqlite` itself at 4 KB for the whole session (measured: 18 requests and
860 KB in the side file, nothing in the file; a copy of the file alone had no tables). So the
recorder runs a passive checkpoint each second when something was written
(`SessionStore.checkpoint()`): the `.sqlite` alone is current within a second, for a tool, backup
or sync folder that takes only that file. A passive checkpoint never waits for readers or blocks
them; a tool holding a long read only delays it to the next second. Measured: 5 to 8 ms per
checkpoint whatever the traffic (30 to 400 requests a second; the writes themselves cost 5 to
186 ms of that second). It also bounds what a power cut can take: SQLite here runs WAL with
`synchronous = NORMAL`, which keeps the database consistent but may drop commits not yet
checkpointed; now that is at most the last second. A crash or `kill -9` loses nothing committed.
Other tools: open the live file (read-only is fine while Artemis runs, the side files are there);
a copy taken mid-checkpoint can be torn, so copy with SQLite's backup (`sqlite3 <file> ".backup
<copy>"`) rather than `cp` when it matters. `ended_at` stays empty while recording, and after a
crash.

Not yet: popups, Back/Forward/Reload as actions, DOM session replay (spike first), a policy-aware
HAR export from the database (masking what is marked sensitive), the cosmos built from the recording.

### Video and HAR alongside the session

On by default for now (a configuration view will decide later; `launchShell({ record: { video,
har } })` turns them off). Next to `<session>.sqlite`:

- `<session>.site.webm` — Playwright's video of the website, 1440x900, about 25 fps.
- `<session>.console.webm` — the console window. The website is drawn under the transparent
  console, not in it, so the site area is black here; the two files together are what the
  operator saw.
- `<session>.har` — Playwright's HAR of the site's traffic, with response content embedded, for
  tools that import HAR. The console runs in the same Electron app, so Playwright would also
  record Artemis's own interface loading from the local dev server (its scripts, fonts, sounds);
  those requests are filtered out, so the HAR holds only the website and the third parties it
  calls.

They are written while the app runs and completed when it closes, so they start in a hidden
`.recording-<time>` folder, move next to the database once the app has closed, and are listed in
the session's `artifacts` table with the time recording started (videos start with the window,
before the session; use it to line the video up with recorded events).
Measured: Artemis's share of the machine 5% without video, 6% with both videos (median over 13 s
of scrolling Wikipedia); about 1 to 1.5 MB per window per 16 s.

**Closing saves the session whole, however it ends.** Playwright writes the HAR only when Artemis
closes the app itself (`context.close()` exports it); an Electron that quits on its own, or a
process killed by Ctrl+C, leaves no HAR and the videos stranded in the hidden folder (found in
real use: no session had a HAR, and the interrupted ones had no videos beside them). So, while a
session is recorded (`ARTEMIS_GRACEFUL_QUIT=1`):

- Closing the window (or the console with Cmd+W) and Cmd+Q hide the windows at once and ask
  Artemis to close (`quitRequested`, watched every 200 ms); Artemis drains the recorder, approves
  the quit, closes through Playwright (HAR, videos), then moves the files. If nobody answers in
  15 s the shell quits on its own.
- Ctrl+C, closing the terminal and `kill` (SIGINT, SIGHUP, SIGTERM) go through the same close;
  `scripts/artemis.ts` replaces Playwright's handlers, which would close the browser at once and
  exit 130. A second Ctrl+C quits without waiting. One press can arrive twice (the terminal
  signals the whole job and `bun run artemis`'s wrapper passes it on): repeats within a second are
  the same press (found in real use: one Ctrl+C printed both messages and lost the session).
- A crash, `kill -9` or a power cut cannot be saved at the time. Each recording folder keeps a
  `manifest.json` (which video is the site's, which the console's, and the session's database once
  a website is opened); the next launch moves what survived next to its database, lists it, and
  says so (`server/recordings.ts`). The HAR cannot be recovered that way (Playwright holds it in
  memory until close); the database, written as the session happens and current in the `.sqlite`
  itself within a second, is the complete record (a HAR export from it is planned).

`bun run artemis <website>` engages the website at once (`ARTEMIS_PROFILE_DIR` and
`ARTEMIS_SESSIONS_DIR` override `data/shell-profile` and `data/sessions`; the test uses both).

## The live cosmos (owned browser)

In the owned browser the Cosmos is the recording, never the emulated network: it starts empty and
grows as the operator (later the autopilot) browses. The recorder emits small events as it writes
(`src/site-events.ts`: page view, commit, request, response); `server/site-feed.ts` delivers them
to the console every 150 ms over the machine feed's path, only once the console listens; and on
every console load it first sends a reset and the whole session from the database, so a reload
rebuilds the same cosmos. In an ordinary browser the first such event switches the cosmos over
(the integration test feeds it that way).

`src/site-model.ts` turns events into the drawing (observations only, nothing guessed):

| Node | What | Look |
| --- | --- | --- |
| Page | an address without query or fragment (the database keeps full URLs), hanging under the page it was first reached from; the first page is the core | the core a white hexagon; pages reached from it are sections (large), deeper pages relays; labelled; sign-in pages on other hosts are pages too, in amber |
| API call | a dot of its page: a first-party `fetch`, XHR, beacon or stream, one per method and path: `GET /api/map` | small, light blue |
| File | a dot of its page: a script, style, image or font from the scope host or its subdomains | small, in the cloud's blues |
| Outside request | a dot of its page: anything from a host outside the review scope, named by host and path | small, amber (the view's attention accent) |

Every request is a dot of the page that made it, so two pages calling the same endpoint get a dot
each and no line runs from one page's cloud to another's (the earlier shared endpoint and service
nodes drew lines across the whole cosmos). A node that answered with an error status or failed is
an anomaly (lens 5). Clusters (lens 2) colour each section's branch. Scope (`E`, where Regenerate
sits in the emulated cosmos) hides and shows everything outside the scope host and its
subdomains; selection follows its node.

The model only grows and ignores events it has seen, so live events and a replayed snapshot
cannot double anything.

### Geometry: a computed radial tree, like the sketch

The recorded cosmos takes the emulated cosmos's shape, but every node is an observation: the core
at the centre, the pages reached from it evenly around it (the first straight up, then clockwise;
six make a hexagon), deeper pages further out along their branch, and each page wearing its
requests as a sunflower cloud. Each node hangs on exactly one line, to its parent.

- Pages sit on rings by depth from the core, far enough apart for the widest clouds on either
  side. The core's pages always get equal slices of the circle (the rings are pushed out until
  the largest section fits its share), so sections sit evenly around the core however unequal
  they are. Deeper, each branch takes a slice sized to what it holds on every ring, spare angle
  shared out evenly; sub-pages share at most 120 degrees of their parent's slice, centred on it.
- A site too big for cosmos.gl's space (4,096 units) is drawn smaller, all of it alike: the same
  shape, so still nothing crosses; only the clouds grow denser.
- So no drawn line can cross another: children stay inside their parent's slice on the next ring
  out, and no fan is wide enough to swing a line across. A walk from page to page is a straight
  line out from the core: a flow reads as a line.
- Navigation that the tree does not draw (back to an earlier page, across sections) is kept as
  routes: cross links, invisible in the overview and lit by the Routes lens (4).
- Places are computed from the whole model (outside the scope too), so Scope only hides; the same
  model always gives the same places.
- The drawing is computed, not simulated: every node is pinned, the simulation stays off
  (`render(0, ...)`), and growth glides every node to its new place (cosmos.gl's own position
  transition, 450 ms; Scope snaps, because it renumbers nodes). Until the operator aims the camera,
  it frames where the nodes are going (`fitViewByPointPositions`), not where they are mid-glide.
- The geometry is written screen-minded (y down) and flipped once into cosmos.gl's space, whose y
  points up. The honeycomb before it was drawn upside down: its "top first" ring started at the
  bottom. Unit tests could not see it (they read space coordinates); the integration test now
  compares where the labels land on screen.

Rejected on the way: free force layout (the core wandered; a dozen nodes knotted into one dot);
the honeycomb with floating, shared endpoints and services (lines from every page to every shared
node crossed the whole picture: the user's report); and "balloon" circles per branch (a long flow
claimed a circle as wide as itself and pushed every section out to 5,600 units, beyond cosmos.gl's
4,096 space; the ring layout keeps the same site within 900).

cosmos.gl cannot measure a graph with no points (reading positions or fitting the view throws),
and the owned browser now starts with one: `fitAll()` and the position reads do nothing on an
empty graph. Found by the end-to-end shell test (Engage framed the empty graph); pinned by a unit
test that fails without the guards.

Screenshots (`scripts/screenshots-recorded.ts`: Wikipedia, branches two pages deep from the main
page, never the same page twice): `cosmos-recorded-landing.png` (V lands on the current page),
`cosmos-recorded.png` (the whole site, Focus toured to its end: the core, its sections evenly
around it, sub-pages outward, a cloud on every page), `cosmos-recorded-scope.png` (Scope: only
en.wikipedia.org; nothing moved).

Not yet: actions between a page and the requests they caused (the event contract carries no
actions yet), a pulse when a node is added, page titles and full-URL lists in a node panel.

## Tests

- `tests/target.test.ts` — website normalisation (bare domains, rejected schemes) and engaging the console with and without a valid address.
- `tests/views.test.ts` — view order and depth, the Page view kept but hidden (V cycles Browser <-> Cosmos), palettes carry the approved values and the same tokens.
- `tests/controller.test.ts` — view/lens state, transition lifecycle, landing on the current page when pulling back from the Browser (selected, focused, zoomed in on, labelled, announced; an earlier selection gives way), the first layout's auto-fit and its cancellation by any operator camera move (landing, Focus, wheel/drag), Focus absorbing Vision (real controller, fake GPU boundary).
- `tests/commands.test.ts` — nine commands per view with A/S/V fixed, V hints for the two shown views, Depth and Route, Page subgraph (BFS) and framing, minimap context (the Page view's behaviour stays tested while hidden).
- `tests/autopilot.test.ts` — the autopilot's control: D steps off, slow, regular, max, off, each step said and sent to the shell; outside the owned browser it says where it flies; the shell's reports (progress with time left, the site covered, the operator taking the controls); time left in plain words; the command flies the yoke, shows the speed as three squares and lights in flight; D stays Disperse in the Cosmos. What it did for the site (a dialog answered, a popup closed) shows on the console as a note, unless the flight was turned off. The flight bar's words: `AP 12/40 · 3 MIN` and its percent from pages visited of pages known, `12/40` when narrow, `AP · STARTING` with no fill until the first report or with nothing known, `<1 MIN`, hours past an hour.
- `tests/autopilot-plan.test.ts` — the flight plan over a fake site with a browser's history, every navigation fed to the real cosmos model: branch by branch with a return to the page between its links, sections first (the exact sequence of follows, backs and trips to a page), and the cosmos a tree around the core (fails when the return is removed); recorded pages never visited again while their links are explored; nine products, three visited; sign-out, log-out, delete, mail, phone, script, file, other-host and same-page links never followed, a subdomain followed; a dead link, a redirect out of the scope, a Back that lands elsewhere and a loop all passed; the stop flag; stopped during a page's dwell, the site stays where it is (no Back); progress with time left from the measured pace; templates and link verdicts. The answer to a site's dialog while it flies: OK to an alert, Leave to leave-this-page, Cancel to a confirm, a prompt or anything new.
- `tests/page-load.test.ts` — the loading bar's progress: none without a load; a load starts low and creeps without reaching what the commit brings, never decreasing; each later phase raises it from where it was and never goes back (fails when a backwards signal is accepted); done fills the field for a moment then the bar is gone; a failure ends it the same way; late signals of a finished load, or with no load, change nothing; a new page starts the bar again from the bottom, even mid-load.
- `tests/autopilot-state.test.ts` — the shell's autopilot state: speeds 0 to 3, anything else off; an action during the autopilot's own click, or reported just after it, is the autopilot's, others the operator's; the operator's input while it flies disengages it once, its own input or input while off does not; old acting windows are forgotten.
- `tests/autopilot-flight.test.ts` — the autopilot in the Electron shell against a fixture site (a nav bar on every page, five products, a Sign out link that counts its hits, a mail link): pressing D three times flies at max until the console says the site is covered with ten pages visited, never Sign out and never more than three products, the cosmos from the recording is a tree around the core (sections under the core, their pages under them), and every recorded action is an autopilot click (fails when the shell records every action as the operator's); the top bar's flight bar showed real figures (`AP n/m` with a value) during the flight and was gone after it (fails when the bar ignores the reports); the slow speed scrolls a long page down and stays on it; a click in the site during a slow flight disengages it, the console says so and the site stays where it was (fails without the preload's pointer report). A site that talks back (an alert, a confirm whose answer it reports, a popup, each on load): at max it covers the site, the confirm gets Cancel, the popup is closed, the console says each, and no native box is left (fails when the autopilot leaves dialogs alone: the flight never ends; fails when popups are left open); at regular, right after it answers an alert it has moved on and no box is left (fails when it stays its 3 s); landing right after a page talked back loads that page again and no box is left (fails without the reload). Native boxes are counted with `tests/native-dialogs.ts` (CoreGraphics window list, on or off screen).
- `tests/settings.test.ts` — the configuration view's settings: the sketch's seven categories in order, one LLM connection per role, only Sound live; defaults (sound on, subdomains in scope, video and HAR kept); saved settings come back, missing options take their default, unknown ones are dropped, a broken store gives the defaults; search by option words or category name; change counting; the sound default decides muting at start. The session: ticking changes only the draft, Apply saves it and the sound default applies at once; closing discards and says so; Reset, Defaults and Discard; Next walks only the categories a search found. The settings card keeps A and S on top and V in the middle with the right hints; the native site steps aside while the settings are open.
- `tests/integration.test.ts` — real Chromium against an isolated Vite server: the header shows a live FPS readout and `--` for machine figures outside the owned browser; C folds the panels away and back in both views, the header switch does the same, and a view change leaves them as they were; the entry screen refuses to start without a website and carries the address into the console; Engage lands in the Browser view; V pulls back to the Cosmos and returns, palette variables change, command card and tab strip swap, no Page view on the way; the Cosmos opens on the current page (selected, label at the stage centre, zoom readout x4, named in the readout) and stays there while the first layout settles; the stage shows the old view until the midpoint, reduced motion still completes, lenses keep working; fed recorder events, the cosmos becomes the recording and grows live with labelled pages, V lands on the current recorded page, the camera stays put as it grows (the zoom it landed at), the core stays exactly at the centre of the space, the first page reached from it sits straight up with the next one further out on the same line, and on screen (by where the labels land) the first section is above the core, Scope (where Regenerate was) hides the outside host and brings it back, with no page errors; a big recording (nineteen pages of fifty calls) whose current page is a handler leaf at its edge: V centres that leaf with the core's label on the stage too, the selected label shows and no two shown labels overlap (fails with the fixed x4 landing; fails without labels giving way). The address strip: small Back, Forward and Reload right after LIVE PAGE, in order; Back and Forward off in an ordinary browser; the address editable (new GET parameters load in the frame, a typed key is not a hotkey, Escape restores, a non-address goes nowhere and says so); Reload gives a fresh load of the same address. While a slow page (held by the test) loads, a progressbar "Page loading" covers exactly the address field and rises, the field is busy and the state reads LOADING; once the page answers it reaches 100, goes, and the state reads LIVE; Reload shows it again. The autopilot's progress lives in the top bar: off before D; with D the frame-rate graph's box becomes a progressbar "Autopilot progress" exactly over it, starting (no value) with the graph dimmed; still there with the panels folded and in the Cosmos; gone with the graph back when the flight stops; at 1280 wide the longest figures still fit (the short label) and the header does not overflow. While the autopilot is on, a glow covers the window's edges (the whole viewport, taking no click: a click at the edge never lands on it), with an inset shadow that breathes, faster at each speed; it stays in the Cosmos and goes when D turns the flight off; under reduced motion it holds steady. Autopilot: D in the top-right slot with three squares under the yoke and inside the button, Highlight gone, DOM on O; each press fills one more square, lights the button and changes the MODE readout (SLOW, REGULAR, MAX, then REVIEW), saying where it flies outside the owned browser; in the Cosmos D is still Disperse. The console page is titled `Artemis` and its favicon is `/icon.svg`, the header's mark (the hexagon path and core).
- `tests/metrics.test.ts`, `tests/quality.test.ts` — frame statistics, machine CPU/memory/process-tree parsing, graph pixel-ratio budget.
- `tests/sounds.test.ts`, `tests/debug.test.ts`, `tests/debug-page.test.ts` — action routing and override persistence; catalogue integrity; the soft family's rules; `/debug` in real Chromium: every synthesized preset plays without errors, a pick applied on `/debug` is what the real console's hover plays, Reset restores the defaults.
- `tests/session-store.test.ts` — the session database: target and scope; actions belong to the page view open at the time and credit the next page view (also when reported late, never long after); requests credited to the latest earlier action in their page view, re-credited when an action arrives late; the actor column; typed values kept with password fields marked; responses with status, headers (credentials marked sensitive), body and timing; request bodies; bodies stored once by hash; missing bodies noted (too large, unavailable); the file opens in another process; a checkpoint puts everything written into the file itself, so a copy of the `.sqlite` alone holds the page view, the request and its body (fails without it: the copy has no tables); body, sensitive-header and scope policies.
- `tests/recorder.test.ts` — the recorder in the Electron shell against a fixture site with a third party: Home, Contact, Load map, a form with email and password, Send. The session file holds the three page views with the actions that led to them, the six actions in order with role, name, value and sensitivity, the page-load API call and the button's API call with their JSON bodies, documents with bodies, styles and images without, the third-party pixel outside the scope, the form post with its body, and the cookie headers marked sensitive; nothing of the console's own traffic. Written as it happens: while the session is still open, `sqlite3 -readonly` in another process sees the three page views and the map call with its body, and within a second a copy of the `.sqlite` alone holds them too (failed before: all of it sat in the `-wal` side file, the copy had no tables). Next to the database: a WebM video of the website and of the console and a HAR holding the site's API call with its body and none of the console's requests, all listed in the `artifacts` table, with no temporary folder left behind. Meanwhile the console's cosmos became the recording, live (the two pages, the shared config endpoint, the map endpoint, the outside host); V lands on `/contact`; a console reload rebuilds the same cosmos from the database. The fixture page reads its config before the test moves on (clicking away mid-call cuts it off, and Electron then reports it neither finished nor failed: recorded as open, which made the assertion flaky). Closing the way a person does keeps the recording whole: closing the window, and Cmd+Q, each still produce the HAR, both videos, an ended session and no hidden folder (both failed before: no HAR).
- `tests/recordings.test.ts` — recovering an interrupted session from its folder's manifest: the videos move next to the database and are listed in it; a launch that never opened a website is removed; the recording in progress and folders without a manifest are left alone.
- `tests/artemis-cli.test.ts` — `bun run artemis <site>` (the package script, its `bun run` wrapper included) in its own process group, given one SIGINT to the whole group as a terminal Ctrl+C does (the wrapper passes it on, so the launcher receives it twice): read as one press, exit 0, "session saved", the database, both videos and the HAR, no hidden folder (without the signal handling it exits 130, the reported symptom). Killed outright instead (`kill -9` to the launcher and its Electron) while a fixture site browses itself (Home reads its config, moves on to Next, which reads its own): another process read both page views and both config bodies live, and after the kill a copy of the `.sqlite` alone still holds them, with the session marked never ended (fails without the recorder's checkpoint: the file alone has no tables).
- `tests/site-model.test.ts` — events to drawing: pages keyed without the query, linked in commit order, each under the page it was first reached from, the last one current; a page appears at its final address once its navigation commits, with the requests made meanwhile; every request a dot of its page, one per method and address (two pages calling the same endpoint get a dot each): API calls, the page's own files (subdomains in scope), outside requests marked external; errors and failures on the node that answered; replays change nothing, reset starts over; outside sign-in pages are external pages. The network: the core, sections, relays and dots, one line each; navigation outside the tree as cross links (routes); Scope drops external nodes and lines; anomalies; an empty recording. The geometry: the core at the centre and its pages evenly around it, the first straight up, then clockwise, even when one section holds far more than the others; no drawn line crosses another on a site with sections, sub-pages, a chain through a sign-in provider and back-and-forth navigation (checked segment by segment, with and without Scope; fails when sub-pages may spread around the full circle); every node on exactly one line, to its parent; each page's dots nearer their page than any other, none on top of another; sub-pages farther out than their parent, within 113 degrees of straight on; a walk is a straight line out from the core; Scope and recomputation move nothing; a site too big for the space (a 60-page flow) is drawn smaller, inside it, the core still at the centre; every node fixed.
- `tests/recorded-cosmos.test.ts` — the controller with the recording: the first events replace the emulated network; growth keeps every node; V lands on the current recorded page, selected and centred with every node in the frame (no fixed close-up), a lone page at a sensible width, or says nothing is recorded yet; Scope hides and restores outside hosts with the selection kept on its node; Scope replaces Regenerate, which refuses; drawn, not simulated (every node pinned, no simulation start, the first nodes arrive in place, growth glides, Scope snaps, Hold and Clear never release a node); routes hidden in the overview and lit by the Routes lens; whole-site framing with room for labels; the core a hexagon in both cosmos; an empty graph is never measured; the camera frames where the growing site is going until the operator aims.
- `tests/shell-logic.test.ts` — where the native site view goes (shown only engaged, in the Browser view, not diving), which clicks pass through to the site (everywhere but the panels), resuming the engaged website after a console reload (garbage, non-web addresses and refusing storage resume nothing).
- `tests/shell.test.ts` — the owned browser as an Electron shell under Playwright, windows hidden: launching without a console server fails fast and says why; a fixture site that refuses framing and hides its body unless it is the top window (the Microsoft sign-in defense) runs top-level and visible under the console, with no iframe, sits exactly in the slot, and is followed through a redirect by the address strip; `V` typed in the site dives (the site view steps aside and returns on the same page), `v` typed in a site field stays in the field; clicks pass through over the site and stay over the header; a page that calls `window.close()` stays (the address strip still drives it) while a popup the site opened closes itself (fails without the Blink setting: the site view is destroyed); with the site's page gone from the shell's side, navigating, Back, Forward and Reload leave the shell answering (fails without the guards: Electron's error box stalls it); the site's dialogs are the operator's: a confirm waits for a person in Electron's native box instead of being cancelled at once by Playwright (fails without Artemis's dialog listener); when the console stops hearing the pointer, the site's own pointer reports hand the clicks back under the command card and when the pointer leaves the site view upward, and keep them with the site over the open page (fails without the reports); a `target="_blank"` link loads in the site view (no bare window) while a sign-in popup opened with window features still opens; a console reload comes back engaged on the same site page without sending the site back to the start; machine readouts arrive; the shell carries Artemis's icon (1024x1024, reported in its state); the native title bar is dark (`nativeTheme` source dark, dark colours in use); the site's developer console holds the site's own message and no "Electron Security Warning" (fails without `ELECTRON_DISABLE_SECURITY_WARNINGS`). The address strip drives the site: Back and Forward dimmed after Engage (the blank start page is not history), an edited address with new GET parameters loads in the site, Back and Forward walk its history, Reload loads it again from the site, keys typed in the address are not hotkeys. A slow fixture page (answer held 1.2 s, document in two parts, a slow image) gives the console exactly started, committed, DOM ready, done, with the bar shown, at Engage and again for a link clicked in the site.
- `tests/owned-browser.test.ts` — the earlier framed owned browser (still in the tree, no longer launched): CSP/cookie rewriting; machine readouts (CPU, ARTEMIS, MEM) arrive from the Bun side; a framable site goes live in an ordinary browser and fills the stage edge to edge; clicking into the page shows the keyboard hint there; a site refusing framing stays blank in an ordinary browser and works, with its session, in the owned browser, where `V` still switches views with the keyboard inside the page. Links aimed at the top window or a new tab, and redirects, stay inside the frame and land on the final address with no extra window.

## Browser view: the real website

The website fills the stage edge to edge, from a glass address strip under the header down to the
bottom of the screen; the bottom panels float over the page, each on its own glass, so the page
stays visible and usable around them. The strip reads like a browser's: `LIVE PAGE`, three small
buttons (Back, Forward, Reload), the address the browser is on, and the state (`EXTERNAL` or
`OWNED`, then `CONNECTING` / `LIVE`). The address is editable: rewrite it (its GET parameters
too) and press Enter to go there; Escape puts back the address of the page shown; something that
is not a web address goes nowhere and the console says so; keys typed there are text, not
hotkeys. In the owned browser the buttons drive the site's own history (`site-go` over the
bridge); Back and Forward are dimmed when there is nowhere to go, and the blank page the site
view starts on before Engage never counts as somewhere (the right-click Back had that flaw too;
fixed). In an ordinary browser Back and Forward stay off (a cross-origin frame's history is out
of reach, and the top window's history would take the console with it); Reload and the address
reload or re-aim the frame. These navigations are recorded as page views like any other; the
buttons themselves are not recorded as actions yet (Back/Forward/Reload actions were left for
later).

While a page loads, the address field itself is the progress bar (the user's idea): a soft fill
sweeps under the address from the left, fills the field when the page has loaded and fades; the
state readout says `LOADING` meanwhile and the field is `aria-busy`; the bar is a progressbar
named "Page loading" for tests and assistive technology. No browser knows a real percentage of a
page load, Electron exposes none, so the bar eases toward a cap for each phase it has seen
(`src/page-load.ts`: started 8 to 45 %, document committed 35 to 80 %, DOM ready 70 to 95 %),
never goes back, and jumps to full when loading stops. In the owned browser the shell sends the
site's own signals (`site-load`: `did-start-navigation` of the main frame, `did-navigate`,
`dom-ready`, `did-stop-loading`, `did-fail-load` except a load cut short by a newer one); in an
ordinary browser the frame only says when it has loaded, so the bar creeps between Enter (or
Reload) and the frame's load. Same-page route changes are not loads and show no bar. The
autopilot's pages show it too. Frames: `docs/screenshots/address-loading.png` and `-1280.png`.

- **Owned browser** (`bun run artemis`): an Electron shell (`shell/main.ts`, launched under
  Playwright by `server/shell.ts`, profile in `data/shell-profile`). The website is a genuine,
  unmodified Chromium page, top-level, in a native view placed exactly where the console's slot
  is; the unchanged console sits over it in a transparent window. Over the site, clicks pass
  through to it (`setIgnoreMouseEvents` with forwarding); over the header, address strip and
  bottom panels they stay with the console. While clicks pass through, the console hears the
  pointer only through macOS forwarding, which can stop after a click in the site; then nothing
  took the clicks back and the header's buttons did nothing until V, V. The site's preload (top
  page only) therefore reports the pointer too, at most every 40 ms, and the moment it leaves the
  site view; the shell hands these to the console only while clicks pass through, and the console,
  the one place that decides, takes the clicks back under a panel or out of the site view. The
  shell remembers what the console asked for and applies it whenever the site shows, so the order
  of the two messages no longer matters.
  A page cannot close the site view (found by the user: a link handler on a back office opened its
  app in a popup and called `window.close()`; the autopilot stopped and the next navigation threw
  "Cannot read properties of undefined (reading 'loadURL')" in the shell). Electron lets any page
  close itself, which destroys its web contents (`close`, then `destroyed`; `preventDefault` on
  `close` does not stop it). Chrome lets a script close only a window a script opened, or one with
  a single history entry; the shell restores that rule with Chromium's own Blink setting
  (`--blink-settings=allowScriptsToCloseWindows=false`), so the page gets Chrome's console message
  "Scripts may close only the windows that were opened by them." and stays, while a sign-in popup
  still closes itself. And should the site's page ever be gone, the shell's handlers (navigate,
  Back, Forward, Reload, the right-click menu, the address report) do nothing instead of throwing:
  an uncaught exception put up Electron's modal error box and stalled the shell. The site's
  developer console shows only the site's own messages: Electron's development build prints
  "Electron Security Warning (Insecure Content-Security-Policy)" into every page without a CSP,
  which a reviewer would take for the site's; the launcher sets `ELECTRON_DISABLE_SECURITY_WARNINGS`
  (the warning is for app authors, and nothing of Artemis runs in the site's page). Artemis's own
  icon: the header's hexagon mark on a night tile (`public/icon.svg`, the Cosmos palette's sky
  mark and azure glow, picked by the user from six palette variants rendered on one sheet) is the
  console page's favicon and, rendered to `shell/icon.png` by `bun run scripts/icon.ts`, goes on
  the Dock (macOS, `app.dock.setIcon`) or the window elsewhere at launch (`ARTEMIS_ICON`); the
  console page's title is `Artemis`. The window's native title bar follows the dark appearance
  (`nativeTheme.themeSource = 'dark'`, one line): it sat white over the dark console. The user
  chose to keep the bar native: a band of Artemis's own above the console (hidden title bar, the
  traffic lights on a night strip, a drag region, gone in full screen) was built, worked, and was
  reverted the same evening as bugs for a feature that is not a big deal (`557bfdd`, reverted in
  `8095306`). Sites are not affected by the dark appearance: Playwright, which owns the shell,
  emulates `prefers-color-scheme: light` on every page by default (measured: the site reports
  light with the appearance dark), as it did before. Nothing rewrites the site's headers or cookies, so
  sign-in flows that refuse frames (Microsoft, PingOne, MFA) work as in any browser. The only code
  of Artemis in the site's renderer is `shell/site-preload.ts`, in an isolated world: it reports
  whether focus is in a field and forwards plain keys as hotkeys. The site view steps aside during
  a dive and outside the Browser view, keeping its page; a console reload (right-click Reload,
  Cmd+R) comes back engaged on the same page (`src/resume.ts`). Links aimed at a new tab
  (`target="_blank"`, `window.open` without window features) load in the site view until the shell
  has tabs; windows opened with features stay popups, so sign-in popups keep working. The right-click menu on the site
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
