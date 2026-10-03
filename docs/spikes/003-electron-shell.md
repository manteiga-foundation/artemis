# 003: electron-shell

Question: can Artemis keep its interface exactly as it is (the website edge to edge in the Browser
view, glass panels floating over it, the dive) while the website runs as a genuine, unmodified
top-level browser page, and does Playwright automation (sessions, video, tracing, routing) still
work?

Why: the framed browser (rewrites headers and cookies, detectably framed) blanks Microsoft sign-in;
the streamed tab (spike 002) imitates input and loses browser-drawn widgets. Both put our code
between the reviewer and the site, so a bug seen in review might be ours.

## Approach

- `main.cjs`: an Electron window (native title bar) whose content is the website as a
  `WebContentsView`: a genuine Chromium page in its own process, with native input, dropdowns,
  dialogs, file picker, IME, clipboard and DevTools. The Artemis console is a frameless transparent
  child window exactly over the content area, loaded unchanged from the Vite server
  (`?owned=1&shell=electron`); two CSS rules open its backdrop and hide its iframe in the Browser
  view. A small agent in the console reports the slot's rect (the site view is placed and sized to
  it, hidden outside the Browser view) and decides per mouse move whether the pointer is over a
  panel (keep clicks) or over the site (`setIgnoreMouseEvents(true, { forward: true })`, clicks go
  through to the site). The site's user agent drops "Electron".
- `site-preload.cjs`: the only code of ours in the site's renderer, in an isolated world (no DOM
  changes, invisible to the page's scripts): it reports whether focus is in an editable field and
  forwards plain keys to the console as hotkeys, as the frame agent does today. The page still
  receives every key.
- Native right-click menu on the site: Back, Forward, Reload, Cut, Copy, Paste, Inspect Element.
- `measure.ts`: Playwright `_electron.launch` with `recordVideo` and tracing; drives the console
  and the site; then attaches to a separately started shell with `chromium.connectOverCDP`.
- `live.ts`: the shell on screen with a click-counting fixture, readable over CDP, for real OS input.

Run by hand: `cd docs/spikes/003-electron-shell && bun install && bun run start` (Vite on 5179, or
`APP_URL=http://127.0.0.1:5173 bun run start`).

## Results (Electron 44.5.1 / Chromium 152, Playwright 1.63, macOS arm64)

| Check | Result |
| --- | --- |
| Site view is a regular Playwright `Page` | yes: locators, `fill`, `click`, `goto`, `evaluate` |
| staging site -> PingOne -> Microsoft, driven by Playwright | renders; `top === self`, body `display: block` |
| What sites see | `Chrome/152.0.7977.130`, no "Electron" |
| Address strip | follows the site through every redirect |
| Console reload | the site keeps its page (separate web contents) |
| V typed in the site (focus not in a field) | console dives to Page, site view hides; V back shows it, state kept |
| V typed in a site field | stays in the field, no view change |
| Click decision | over the site: pass through; over the header: keep |
| Console frame rate with the site under it | 60 fps, worst frame 18-19 ms |
| `context.route` | sees the site's requests |
| Cookies | `cookies()` 20-29 across 5 domains (staging.example, PingOne, Microsoft); clear -> 0; `addCookies` -> all back |
| Tracing from launch | 15.7-15.9 MB trace |
| Video from launch (`recordVideo`) | one file per page; site video ~450 KB |
| Attach later (`connectOverCDP`) | site page found; `page.screencast.start({ path })` records video; tracing works |
| `context.storageState()` | fails: `Target.createTarget: Not supported` (Playwright opens helper pages; Electron refuses) |
| Console page errors | none |

Composed frame (`data/spike-003/a-composite.png`, from Electron's captures of each surface): the
site legible in the centre, header, address strip and bottom panels over its edges, bottom panels
translucent.

## Verdict: VALIDATED, with five findings to design around

1. Real OS click-through is not yet verified by a real click: this terminal and the desktop tool
   have no Accessibility / Screen Recording permission. The decision logic is verified; Electron's
   `setIgnoreMouseEvents(..., { forward: true })` is the documented mechanism. Confirm by hand.
2. Glass: the console cannot blur the site behind it (separate windows; `backdrop-filter` only sees
   the console's own pixels). Panels over the site keep their tint and translucency; the frost is
   lost there.
3. Dive: the site view hides at the swap instead of travelling with the stage. A `capturePage`
   snapshot can ride the dive and hand back to the live view.
4. Sessions: Playwright's one-call `storageState()` / `setStorageState()` do not work in Electron;
   cookies do (Playwright or Electron's `session.cookies`), and local storage is read on the page or
   through Electron's session APIs. Isolated, persistent profiles are Electron partitions
   (`persist:<name>`).
5. Playwright quirks: its page setup stalls on a `WebContentsView` that was never navigated (load
   `about:blank` at creation); its synthetic keys never reach Electron's `before-input-event`
   (measured 0), which is why hotkeys are forwarded from the isolated preload.

Not tested, known: Google blocks "Sign in with Google" in embedded browsers (accepted limitation);
Widevine DRM video needs a special Electron build; Electron trails Chrome stable by a few weeks.
Browser features Chrome gives for free must be supplied by the shell: find in page, zoom,
downloads UI, permission prompts (Electron grants by default unless a handler asks), popups as
tabs, password autofill (absent). The header's CPU/MEM readouts need the machine feed ported from
`server/machine.ts` to the main process.
