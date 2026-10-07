# Contributing to Artemis

Thank you for your interest. Artemis is alpha: the interface leads and functionality attaches to
it, so the most useful contributions follow the same loop the project is built with.

## Before you start

1. Read `AGENTS.md`. It is the working contract for people and agents alike: what Artemis is, the
   fixed vocabulary (View, Lens, Layer, Dive, Owned browser), the conventions the tests depend on,
   and the standing decisions that are not re-opened without the maintainer.
2. Read `docs/status.md` for what is built, what is emulated and what comes next. Work from that
   list, or open an issue to propose something else before writing a large change.
3. Set up with the README (Bun, `bun install`, `bunx playwright install chromium`).

No new runtime dependencies for now; if a strong open-source tool would replace a lot of code,
propose it in an issue first.

## The loop: red first

Every change, however small, follows these steps.

1. **RED.** Write the failing test first: a unit test for logic (`tests/*.test.ts`, with the fake
   window and renderer in `tests/harness.ts` when the graph controller is involved), a Playwright
   test in real Chromium or the Electron shell for behaviour. Run it and watch it fail for the
   right reason.
2. **GREEN.** The smallest change that passes; refactor with the tests still green.
3. **Gates.** All three must pass:

   ```sh
   bun run check    # type-check app, server and shell
   bun run test     # unit tests + Playwright in Chromium and Electron (several minutes)
   bun run build    # check + production bundle
   ```

4. **Look at it.** For anything visible, take screenshots with `scripts/screenshots*.ts` at
   1440x900 and 1280x800 and inspect them; confirm what you see with a DOM or CSS probe.
5. **Document.** Update `docs/console.md` (and `docs/status.md` when the state changes); put
   screenshots in `docs/screenshots/`.
6. **Report.** In the pull request: what changed, what is verified (test counts, commands), one
   honest finding or trade-off, and what could come next.

When a question is uncertain (is it feasible? which colour? which sound?), do not argue it: spike
it with measured numbers, or render every candidate in context, and let the maintainer pick.

## Platforms and CI

Artemis is developed and fully tested on macOS. The CI job (`.github/workflows/ci.yml`) runs on
Linux: type-check, build and `bun run test:unit`, the tests that need no browser and no GPU. The
Playwright and Electron tests need a GPU and a desktop session, so they run locally with
`bun run test` and their result belongs in the pull request. Linux reports for the owned browser
are welcome; it has not been exercised there yet.

## Pull requests

- One slice per pull request, with a descriptive title and commit messages.
- Keep the vocabulary, the accessible names the tests use, and the palette tokens (`var(--token)`,
  never a literal colour in CSS).
- Use fixtures and reserved names in tests and screenshots (`example.com`, `shop.example`).
  Never commit anything under `data/`, session files, HARs, videos or screenshots of sites you are
  not entitled to publish.
- No emojis in code, documentation or commit messages.

Security problems go through `SECURITY.md`, not the issue tracker.
