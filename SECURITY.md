# Security

Artemis is alpha software maintained by a small team. Only the `main` branch is supported.

## Reporting a problem

Report security problems privately through GitHub: open the repository's Security tab and choose
"Report a vulnerability". Please do not open a public issue, pull request or discussion for a
security problem.

A useful report says what you found, the commit you tested (`git rev-parse --short HEAD`), your
platform, and the steps to reproduce it against a fixture or a site you control. Never attach a
session database, HAR, video or browser profile from a real site: they contain credentials (see
below). Reports are acknowledged as soon as possible, on a best-effort basis; once a fix lands, the
reporter is credited unless they prefer otherwise.

## In scope

Problems in Artemis itself, for example:

- the Electron shell (`shell/`), its preloads, or the bridge between the console and the site;
- a way for a visited website to reach the console, the shell's main process, the machine or the
  session files;
- the recorder, the session store or the HAR writer exposing data beyond the session's own files;
- the development server or launcher listening beyond the local machine.

Weaknesses of the websites you browse with Artemis are not in scope here; report them to their
owners under their own disclosure policies.

## What Artemis stores, and where

Artemis records what the operator sees, unmasked, so the session can be studied and replayed in
other tools:

- `data/sessions/` holds one SQLite database per session, its live HAR and its videos. They
  contain cookies, authorisation headers, tokens, form posts and typed values as sent, including
  passwords (stored, and marked sensitive).
- `data/shell-profile/` is the owned browser's profile: cookies and signed-in sessions persist
  there between runs.

Both live under `data/`, which git ignores. Treat them as secrets: do not commit, share or upload
them, and delete a session's files when you no longer need them. Masking and scoping policies for
exports are on the roadmap (`docs/status.md`).

A site certificate Chromium cannot trust is accepted for the site's pages so that staging
environments can be studied; it is never accepted silently (the shell lists it and the launcher
prints a warning).

Use Artemis only on applications you are authorised to examine.
