# Artemis

Web Application Intelligent Console.

![Status](https://img.shields.io/badge/status-draft%20UI-1034a6?style=flat-square)
![Tests](https://img.shields.io/badge/tests-186%20passing-005d2c?style=flat-square)
![Bun](https://img.shields.io/badge/Bun-1.4-000000?style=flat-square&logo=bun&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?style=flat-square&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-18-20232A?style=flat-square&logo=react&logoColor=61DAFB)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?style=flat-square&logo=vite&logoColor=white)
![Arwes](https://img.shields.io/badge/Arwes-1.0.0--alpha.23-0b1f66?style=flat-square)
![cosmos.gl](https://img.shields.io/badge/cosmos.gl-3.4-071441?style=flat-square)
![Playwright](https://img.shields.io/badge/Playwright-1.63-2EAD33?style=flat-square&logo=playwright&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-44-47848F?style=flat-square&logo=electron&logoColor=white)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-333333?style=flat-square&logo=apple&logoColor=white)

## Requirements

- [Bun](https://bun.sh) 1.4 or newer (runtime, package manager, test runner).
- A Chromium for Playwright (tests):

```sh
bunx playwright install chromium
```

- Electron, for the browser Artemis owns, comes with `bun install`; its binary is fetched the first
  time it starts.

macOS and Linux are exercised; the owned browser and the GPU flags used by the tests are tuned
for macOS (Metal via ANGLE).

## Install

```sh
git clone git@github.com:manteiga-foundation/artemis.git
cd artemis
bun install
```

## Run

Development server (open http://127.0.0.1:5173):

```sh
bun run dev
```

The browser Artemis owns (recommended): an Electron window where the website runs as a genuine
browser page behind the console, so sign-in flows, MFA, menus and dialogs behave as in any
browser. It starts the development server itself if nothing answers on the port:

```sh
bun run artemis            # ARTEMIS_PORT=5179 bun run artemis  to use another port; bun run artemis example.com  to engage it at once
```

Its profile (cookies, logins) persists under `data/shell-profile`, which is ignored by git.

Experiments page (sounds, with a per-action picker): http://127.0.0.1:5173/debug

## Verify

```sh
bun run check              # type-check app, server and the Electron shell
bun run test               # unit tests + Playwright tests in real Chromium and Electron (about 1 minute)
bun run build              # check + production bundle in dist/
bun run preview            # serve dist/ at http://127.0.0.1:4173
```

## Screenshots and measurements

With a development server running on `<port>`:

```sh
bun run scripts/screenshots.ts <port> [outDir] [site]           # entry, views, dive frames, 1280 check
bun run scripts/screenshots-shell.ts <port> [outDir] [site]     # the owned browser (Electron shell), 1440 and 1280
bun run scripts/screenshots-recorded.ts <port> [outDir] [site]  # the live cosmos after browsing a real site
bun run scripts/screenshots-entry.ts <port> [outDir]
bun run scripts/screenshots-debug.ts <port> [outDir]
bun run scripts/measure-dive.ts <port>                          # frame rate idle and through the view dive
```

Default output directory is `docs/screenshots/`.

## More

- `AGENTS.md` — how this repository is worked on: methodology, vocabulary, conventions, decisions.
- `docs/console.md` — notes on the console as built: views, layout, commands, tests, browser approach.
- `docs/spikes/` — validated experiments kept for reference.

## Credits

- [Arwes](https://arwes.dev) (MIT) for frames, animators and bleeps. The shipped sound files are the
  free sample files from the Arwes repository and are used for development only.
- [cosmos.gl](https://cosmos.gl) (MIT) for the GPU graph.
- Icons: [Game-icons.net](https://game-icons.net) (CC BY 3.0) via `react-icons/gi`; the View glyph is
  Font Awesome Free (CC BY 4.0) via `react-icons/fa6`.
- Fonts: Titillium Web and JetBrains Mono (OFL) via Fontsource.
