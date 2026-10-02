# SCOPE — Network Operations Console (Draft UI)

Draft implementation of the hand-sketched console layout using the Arwes sci-fi UI framework,
a cosmos.gl GPU graph, and an Egyptian blue palette (base `#1034A6`).

## Run

```bash
bun install
bun run dev        # http://127.0.0.1:5173
bun run build      # type-check + production bundle in dist/
bun run preview    # serve dist/ at http://127.0.0.1:4173
```

Press **Engage** (or Enter) on the entry screen. Browsers only allow audio after a user gesture,
so the console assembles and the intro sound plays at that moment.

## Layout (maps to the sketches)

| Sketch element | Implementation |
| --- | --- |
| Header: `T/S  N/S  R/S  Links  Nodes  ~~~  13:11`, double rule | `src/components/Header.tsx` — live counters, sparkline, sim state, mute, clock |
| Centre graph (core, six hubs, satellites) | `src/components/GraphCanvas.tsx` + `src/graph/controller.ts` (cosmos.gl, WebGL) |
| Bottom-left "map" / "scope" | `src/components/MiniMap.tsx` — second cosmos.gl instance, viewport rectangle, click/drag to pan |
| Bottom-right 3x3 grid with hotkey letters | `src/components/CommandCard.tsx`, commands in `src/commands.tsx` |
| Reference tab bar (chamfered caps, active underline, dashed rail, `<< >>`) | `src/components/Console.tsx` (`TabStrip`) |

## Controls

| Key | Command | Effect |
| --- | --- | --- |
| A | Target | Arm targeting; click a node to lock on and zoom |
| S | Stop | Halt / resume the force simulation |
| H | Hold | Pin the selected node in place (toggle) |
| V | Vision | Fit the whole network in view |
| F | Focus | Zoom to selection, or cycle through sectors |
| L | Links | Show / hide links |
| D | Disperse | Repulsion pulse, layout re-settles |
| R | Regenerate | New network topology |
| X | Clear | Clear selection, holds, targeting |
| 1-5, Left/Right | Views | Overview, Clusters, Hubs, Routes, Anomalies |
| Esc | Cancel | Disarm targeting / clear selection |
| M | Mute | Toggle sound |

## Arwes usage

- `AnimatorGeneralProvider`, `Animator`, `Animated` — staggered assemble/disassemble of every panel
- `FrameOctagon`, `FrameCorners`, `FrameKranox`, `FrameLines` — panel and button frames (colours via CSS custom properties)
- `Text` (decipher) — header labels, console messages, entry screen
- `BleepsProvider`, `useBleeps`, `BleepsOnAnimator` — UI sounds
- `GridLines`, `Dots` (cross), `MovingLines` — background
- `createEffectIlluminator` — pointer glow on panels

## Notes and placeholders

- The meaning of `T/S`, `N/S`, `R/S` in the sketch was not specified. They are rendered as
  throughput, node events and route updates per second, fed by a simulated random walk
  (`useTelemetry` in `src/hooks.ts`). Replace with a real data source.
- The network is procedurally generated (`src/graph/data.ts`, about 2,000 nodes).
- Pinned to `@arwes/react@1.0.0-alpha.23` (the version documented on arwes.dev), React 18,
  mounted without `StrictMode` as Arwes requires.

## Credits

- Sounds: Arwes project UI sounds (MIT), from `github.com/arwes/arwes/static/assets/sounds`.
- Icons: Game-icons.net (CC BY 3.0) via `react-icons/gi`. Attribution is required if distributed.
- Fonts: Titillium Web and JetBrains Mono (SIL OFL) via Fontsource.
