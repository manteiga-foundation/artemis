# Status and roadmap

What is built, what comes next in the maintainer's order, and the questions still open. `AGENTS.md`
is the working contract; `docs/console.md` describes the console as built. Update this file with
each slice that changes it.

## Built

- Two shown views, Browser (home after Engage) and Cosmos, with their palettes and the dive between
  them; the Page view is hidden, not removed. Pulling back from the Browser opens the Cosmos on the
  current page, selected and zoomed in on; an operator camera move cancels the first layout's
  pending auto-fit.
- The entry screen with the website field.
- The owned browser, the Electron shell (`bun run artemis`): the website as a genuine native page,
  click pass-through, hotkeys from the site, a live address strip with Back/Forward/Reload, an
  editable address (GET parameters rewritable) that doubles as the page's loading bar, right-click
  Back/Forward/Reload, a console reload that resumes on the same page, `_blank` links kept in the
  site view.
- `C` folds the panels (header switch); real resource readouts; `/debug` with sounds.
- Sessions recorded into one SQLite file each under `data/sessions/`: page views, actions with
  their actor, requests, responses, bodies. Observations only; categorisation comes later and must
  be recomputable. Written as it happens: the `.sqlite` alone is current within a second, so a
  crash or `kill -9` loses nothing committed, and other tools can read the live file.
- A live HAR written by Artemis from the database, whole and unmasked (cookies, tokens and posts as
  sent, so testing tools need no login), asset bytes left out with every request still listed;
  `scripts/har.ts` rebuilds one for any session. Measured on a long overnight session: 465 MB of
  Playwright HAR became 14.4 MB with 5,718 entries, valid per `har-validator`.
- A video of the site and of the console next to it (on by default), saved whole however the app
  is closed (window, Cmd+Q, Ctrl+C; leftovers of a crash recovered at the next launch).
- In the owned browser the Cosmos is the live recording, drawn as a computed radial tree: the core
  at the centre, sections evenly around it, sub-pages outward, every request a dot in its page's
  cloud, no line crossing another; routes in the Routes lens; Scope on `E`; V lands on the current
  page; a console reload rebuilds it from the database.
- The configuration view (`,`): search, seven categories, checkboxes, Apply. Only the sound default
  is live; the other options are interface with emulated values.
- The autopilot (D in the Browser view, a yoke with three speed squares): flies the site branch by
  branch at slow, regular or max, never repeating what the cosmos has, two or three pages of each
  kind, never signing out; its clicks are recorded as the autopilot's and the operator's hand on
  the site disengages it. The site's dialogs are the operator's (Electron's native box); while
  flying it answers them (OK, Leave, Cancel), moves on and closes the popups it caused. A glow
  breathes around the window's edges while it flies and its progress fills the header's graph box.
- The launcher (`bun run artemis [website] [--autopilot slow|regular|max]`): a large ARTEMIS
  welcome, then one notification per event (database and live HAR paths the moment they exist,
  the flight, closing, the files saved).
- A site certificate Chromium cannot trust is accepted for the site's pages, never silently (listed
  by the shell, warned in the terminal).
- App identity: `public/icon.svg` -> `shell/icon.png` (`scripts/icon.ts`) on the Dock, the window
  and the page; dark native title bar. In development the Dock tooltip and app menu still say
  Electron (the binary's bundle name).

## Emulated today

- In an ordinary browser (`bun run dev`) the Cosmos is a procedurally generated network of about
  2,000 nodes (`src/graph/data.ts`); only the owned browser draws a real recording.
- The Browser view commands Annotate, Snapshot, Flow, Links, DOM, Reload (card) and Clear answer
  as interface placeholders.
- The header's `T/S`, `N/S`, `R/S` are a simulated feed (`useTelemetry` in `src/hooks.ts`); the
  page facts panel (title, forms) waits for the live page.
- The configuration view's options other than the sound default, including the whole Autopilot
  category.

## Next, in the maintainer's order

1. Wire the configuration view's options as each feature arrives: recording defaults read by
   `bun run artemis`, Scope subdomains, export formats.
2. DOM session replay (spike first).
3. Export policies on the HAR (masking or scoping, as options; today it is whole and unmasked by
   choice).
4. Categorisation, then more autopilot. No LLMs or new dependencies for now; strong open-source
   tools are welcome. A small model for categorisation (and compliance mapping such as NIST CSF 2.0
   or PCI DSS) comes later, because hard-coded heuristics would put wrong labels in the database.

For the shell, in order: session save and restore through cookies behind one API; a snapshot of
the site riding the dive; find in page, zoom, downloads, permission prompts, popups as tabs (today
`_blank` links load in the site view and featured popups stay windows); remove the framed owned
browser (`server/owned-browser.ts` and its tests) once agreed; the slot's navy veil over the site
as a switchable Layer (kept on for now).

Interface elements being designed (node selection, annotations, and more), each built with
emulated data first; true categorisations for every page (is it authentication? part of a flow,
which step?); the final sound picks as defaults; page title and forms readouts from the site's
Playwright page; the Page view's ego layout (when it returns); annotation overlays anchored to
element rects; adaptive graph quality.

## Open questions

- The live HAR has not yet been imported into Burp, ZAP or Charles.
- Record dialogs (type, message, who answered), the autopilot's closed popups and accepted
  certificate errors as observations in the session database (and the HAR). Popups are not
  recorded yet.
- Desktop notifications for the end of a long flight.
- The cosmos geometry for a linear walk (the radial tree draws a straight line): waiting for
  reports on more sites before changing it.
- Autopilot form submission is parked until other features show how forms connect.
- The glow's colour is the accent; the palette's line colour and white are the alternatives to
  render in place. A real requests-per-second readout could be its own header element.
- The site's dialogs are Electron's native box, modal for the whole app while one waits; showing
  them in the console needs a measurement first (Electron has no hook for JS dialogs).
- Window chrome (a custom title band) was built and reverted: not wanted while it can touch the
  working shell.
