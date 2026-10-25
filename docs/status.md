# Status and roadmap

What is built, what comes next in the maintainer's order, and the questions still open. `AGENTS.md`
is the working contract; `docs/console.md` describes the console as built. Update this file with
each slice that changes it.

## Built

- Two shown views, Browser (home after Engage) and Cosmos, with their palettes and the dive between
  them; the Page view is hidden, not removed. Pulling back from the Browser opens the Cosmos on the
  current page, selected and zoomed in on; an operator camera move cancels the first layout's
  pending auto-fit.
- The Interceptor (key 1), the console's own instrument in every view: a traffic inspector and proxy
  panel over the stage. Every request and response between the browser and the site, http and
  websocket, whole (method, host, path, status, size, time, headers, bodies); history with a filter
  and counts; the proxy armed and disarmed, every request held; a held request edited in place
  (method, address, headers, body), forwarded as edited, or dropped; websockets listed and read like
  anything else. A strip of its own on the command card keeps A, S and V where they are. The
  positioning is deliberate: it is a direct alternative to Burp Suite's proxy history and
  interception, and its form is the claim — see "Now" below.
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
  cloud, no line crossing another; a page is its address with its query (tracking parameters
  aside), so a one-address application's screens are pages of their own; routes in the Routes lens; Scope on `E`; V lands on the current
  page; a console reload rebuilds it from the database.
- The configuration view (`,`): search, seven categories, checkboxes, Apply. Only the sound default
  is live; the other options are interface with emulated values.
- The autopilot (D in the Browser view, a yoke with three speed squares): flies the site branch by
  branch at slow, regular or max, never repeating what the cosmos has, two or three pages of each
  kind, never signing out; menus built on demand (in-page links, expand buttons, three levels) are
  unfolded once per flight and their screens opened by clicking the path; its clicks are recorded as the autopilot's and the operator's hand on
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
- The Interceptor's proxy does not listen on a port yet. The panel, its history, its counts, its
  filter and every action on a held request (arm, hold, edit, forward, drop, forward all, reset) work
  and are tested end to end, but nothing is intercepted on the wire: the panel opens on a sample
  capture (`seedTraffic`, 16 requests shaped like a real session, http and websocket, a 404, a 503,
  a failure, two held, one dropped), and when the owned browser's recorder feeds real traffic it
  gives way to that. Observed traffic is history and cannot be edited, forwarded or dropped.
- The Browser view commands Annotate, Snapshot, Flow, Links, DOM, Reload (card) and Clear answer
  as interface placeholders.
- The header's `T/S`, `N/S`, `R/S` are a simulated feed (`useTelemetry` in `src/hooks.ts`); the
  page facts panel (title, forms) waits for the live page.
- The configuration view's options other than the sound default, including the whole Autopilot
  category.
- Player Two (D in the Cosmos): Artemis reads the cosmos in red beside the operator, marks the
  emulated anomalies as findings, and sits as a companion card under the header; the walk and the
  findings are emulated (`docs/console.md`, "Player Two"). The real agent comes later.

## Next, in the maintainer's order

Direction: use Artemis on real applications (two so far) and let what it lacks there decide the
next features. Usefulness first: an interface element earns its place by answering a question a
product manager, tester or UX reviewer actually has.

1. The Interceptor's listening proxy: a real forward proxy the owned browser is pointed through, so
   arming, holding, editing, forwarding and dropping act on traffic over the wire instead of on the
   panel's own state. Then websocket frames (not only the handshake), replay of any request from the
   history, and the interceptor's readouts in the header. The target is Burp Suite's proxy history
   and interception, with a form Burp does not attempt: this is the feature Artemis is measured
   against, not a side panel.
2. Wire the configuration view's options as each feature arrives: recording defaults read by
   `bun run artemis`, Scope subdomains, export formats.
3. DOM session replay (spike first).
4. Export policies on the HAR (masking or scoping, as options; today it is whole and unmasked by
   choice).
5. Categorisation, then more autopilot. No LLMs or new dependencies for now; strong open-source
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

### Player Two (defined and built emulated, 2026-10-24)

Player One is the operator; Player Two is Artemis herself: an agent that reads the cosmos beside
the operator, in real time, and marks what she finds. The interface comes first, with an emulated
flight, and the real agent (a model with the session database as its memory) attaches to these
shapes later; the backend never dictates them.

- Colour: the cosmos stays blue; everything Artemis does is red (`player` in every palette,
  `--player` on `.app`). Her current node is full red; the nodes she has read keep a red tint that
  fades with age (her trail); the links she walked are red; a finding is a red mark that stays.
- Her hand is visible: a red reticle on the node she is reading, with what she is doing in one
  line ("Reading /checkout", "Comparing with 4 siblings", "Anomaly on /api/session: ...").
- A finding is a pin with a short note on the node (the emulated network's anomalies become her
  findings when she reaches them); findings and the trail survive her standing down.
- She never takes the camera: Player One owns it. The edge glow breathes red while she plays, as
  it breathes gold for the autopilot.
- Key: `D` in the Cosmos view ("Artemis"), the same key that flies the site in the Browser view:
  D is the machine acting, in both views. Disperse leaves the card (Regenerate stays on R).
- Store: `agent: { on, at, trail, note, findings }`; controller: `agent()` toggle, `agentStep()`,
  `agentVisit(i)`; the emulated walk is deterministic (unvisited neighbours first, anomalies
  preferred, backtracking along the trail).
- The companion portrait: the maintainer wanted a clear live companion, StarCraft adjutant
  style, a girl or something divine. A goddess head as a hologram of lit points and feature
  lines with a halo was built from a CC-BY model and then parked: too much for the value it
  gives. It lives, committed, on the local branch `player-two-portrait` (never pushed; cherry-pick
  or merge if it comes back). Main keeps a plain breathing core with halo rings in the slot.
- Later, not now: her context window as a lit constellation (the nodes she currently holds), her
  turns as a timeline beside the session, each finding linked to the evidence row in the
  Interceptor, an 'agent' actor in the session database.

## Open questions

- Hosted Artemis (spike 004, `docs/spikes/004-container.md`): the recorder, autopilot, live HAR
  and live cosmos run without Electron from one Bun process in a Linux container (the Playwright
  image plus Bun), the console fed over a WebSocket through its existing shell bridge; 24 of 24
  Chromium tests pass inside the image. Decided direction: the Browser view becomes a view-only
  stream of the site with a hand on it for sign-in, the Cosmos the home; next is spike 005 (the
  streamed preview at scope-map size and full stage, the input path for sign-in, measured through
  Docker), then the product slices (root Dockerfile, `server/host.ts`, the console's socket bridge,
  the site preload in an isolated world, the Electron-bound tests rewritten against the Bun host).
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
