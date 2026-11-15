#!/bin/sh
# Artemis, in one command:
#
#   curl -fsSL https://artemis.n30.ai/install.sh | sh
#
# What it does, and nothing else:
#   1. Bun: uses the one on your PATH (or ~/.bun), or installs it with Bun's own installer.
#   2. Artemis: downloads the latest release into ~/.artemis/app (a staged copy, swapped in only
#      once it is complete, so a failed download or install leaves the version you had).
#   3. Its dependencies: `bun install` (Electron included) and Playwright's ffmpeg (the session
#      videos need it).
#   4. The `artemis` command in ~/.local/bin, and that folder on the PATH of new terminals (one
#      line in your shell's rc file, added once).
#   5. On Linux where AppArmor keeps Chromium's sandbox from Electron (Ubuntu 23.10 and later): it
#      asks once to run scripts/linux-sandbox.sh with sudo (an AppArmor profile for Artemis's
#      Electron, nothing else). Say no and Artemis still works, without the sandbox, and says so.
#
# Your profile (the reviewed sites' logins) is ~/.artemis/profile and the recorded sessions are
# ~/.artemis/sessions; an update (`artemis update`, or this command again) never touches them.
# To remove Artemis: delete ~/.artemis and ~/.local/bin/artemis.
#
# Environment: ARTEMIS_VERSION (latest, the default: the newest release; a tag such as v0.3.0; or
# main, the development branch), ARTEMIS_SANDBOX (yes or no: answers step 5 without asking), ARTEMIS_SOURCE (a tarball URL instead of GitHub's),
# ARTEMIS_BUN_INSTALLER (instead of https://bun.sh/install), NO_COLOR. A version goes to sh:
#   curl -fsSL https://artemis.n30.ai/install.sh | ARTEMIS_VERSION=main sh
#
# Read it before you run it: curl -fsSL <the URL above> -o install.sh && less install.sh

set -eu

REPO="manteiga-foundation/artemis"

say() { printf '%s\n' "$*"; }
step() {
  if [ -z "${NO_COLOR:-}" ] && [ -t 1 ]; then printf '\033[38;2;224;184;92m>\033[0m %s\n' "$*"; else printf '> %s\n' "$*"; fi
}
fail() {
  printf 'Artemis: %s\n' "$*" >&2
  exit 1
}

main() {
  home="$HOME/.artemis"
  bin="$HOME/.local/bin"
  version="${ARTEMIS_VERSION:-latest}"
  github="${ARTEMIS_GITHUB:-https://github.com}"
  source_url="${ARTEMIS_SOURCE:-}"
  if [ -z "$source_url" ] && [ "$version" = latest ]; then
    # GitHub answers releases/latest with a redirect to the newest release's tag page.
    landed="$(curl -fsSL -o /dev/null -w '%{url_effective}' "$github/$REPO/releases/latest" </dev/null 2>/dev/null || true)"
    case "$landed" in
      */releases/tag/?*) version="${landed##*/releases/tag/}" ;;
      *) fail "the latest release could not be found ($github/$REPO/releases/latest); to install anyway, pick one: curl -fsSL https://artemis.n30.ai/install.sh | ARTEMIS_VERSION=main sh" ;;
    esac
  fi
  if [ -z "$source_url" ]; then
    case "$version" in
      main) source_url="$github/$REPO/archive/refs/heads/main.tar.gz" ;;
      *) source_url="$github/$REPO/archive/refs/tags/$version.tar.gz" ;;
    esac
  fi

  case "$(uname -s)" in
    Darwin) ;;
    Linux) ;;
    MINGW* | MSYS* | CYGWIN*) fail "Windows is not supported yet." ;;
    *) fail "unsupported system: $(uname -s)" ;;
  esac
  command -v curl >/dev/null 2>&1 || fail "curl is needed"
  command -v tar >/dev/null 2>&1 || fail "tar is needed"

  # 1. Bun
  mkdir -p "$home"
  # Tools' own output goes to a log, shown only if a step fails.
  log="$home/install.log"
  : >"$log"
  bun="$(command -v bun 2>/dev/null || true)"
  [ -n "$bun" ] || { [ -x "$HOME/.bun/bin/bun" ] && bun="$HOME/.bun/bin/bun"; } || true
  if [ -z "$bun" ]; then
    step "Installing Bun (bun.sh)"
    command -v unzip >/dev/null 2>&1 || fail "unzip is needed to install Bun"
    curl -fsSL "${ARTEMIS_BUN_INSTALLER:-https://bun.sh/install}" -o "$home/.bun-install.sh" </dev/null || fail "Bun's installer could not be downloaded"
    bash "$home/.bun-install.sh" </dev/null >>"$log" 2>&1 || { rm -f "$home/.bun-install.sh"; cat "$log" >&2; fail "Bun's installer failed (the full output is above, and in $log)"; }
    rm -f "$home/.bun-install.sh"
    bun="$HOME/.bun/bin/bun"
    [ -x "$bun" ] || fail "Bun was not found after installing it"
  fi
  bun_version="$("$bun" --version)"
  case "$bun_version" in
    0.* | 1.[0-3].*) fail "Bun $bun_version is too old: Artemis needs 1.4 or newer (bun upgrade)" ;;
  esac
  step "Bun $bun_version"

  # 2. Artemis, staged beside the installed copy
  stage="$home/.app-new"
  work="$home/.download"
  rm -rf "$stage" "$work"
  mkdir -p "$work"
  step "Downloading Artemis $version"
  curl -fsSL "$source_url" -o "$work/artemis.tar.gz" </dev/null || { rm -rf "$work"; fail "the download failed: $source_url"; }
  tar -xzf "$work/artemis.tar.gz" -C "$work" || { rm -rf "$work"; fail "the download is not a tarball: $source_url"; }
  top="$(find "$work" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  [ -n "$top" ] && [ -f "$top/package.json" ] || { rm -rf "$work"; fail "the download has no Artemis in it: $source_url"; }
  mv "$top" "$stage"
  rm -rf "$work"

  # 3. Dependencies, quietly (the log above).
  step "Installing dependencies"
  quiet() {
    what="$1"
    shift
    (cd "$stage" && "$@" </dev/null >>"$log" 2>&1) || {
      cat "$log" >&2
      rm -rf "$stage"
      fail "$what (the full output is above, and in $log)"
    }
  }
  quiet "bun install failed" "$bun" install --frozen-lockfile
  # Electron's binary would otherwise download on the first launch.
  quiet "Electron could not be downloaded" "$bun" node_modules/electron/install.js
  # Run with Bun itself: `bun x` honours the CLI's `#!/usr/bin/env node`, and many Macs have no Node.
  quiet "Playwright's ffmpeg could not be installed" "$bun" node_modules/playwright/cli.js install ffmpeg
  rm -f "$log"

  # Swap: the new copy in, the old one out.
  if [ -d "$home/app" ]; then
    rm -rf "$home/.app-old"
    mv "$home/app" "$home/.app-old"
  fi
  mv "$stage" "$home/app"
  rm -rf "$home/.app-old"
  mkdir -p "$home/profile" "$home/sessions"

  # 4. The command
  mkdir -p "$bin"
  cat >"$bin/.artemis-new" <<EOF
#!/bin/sh
# Artemis, installed by install.sh. \`artemis --help\` for the usage, \`artemis update\` for the latest.
ARTEMIS_HOME="\${ARTEMIS_HOME:-$home}"
if [ "\${1:-}" = update ]; then
  exec sh -c 'curl -fsSL "\$1" | sh' artemis "\${ARTEMIS_INSTALLER:-https://artemis.n30.ai/install.sh}"
fi
BUN="\$(command -v bun 2>/dev/null || echo "$bun")"
ARTEMIS_COMMAND=artemis
export ARTEMIS_HOME ARTEMIS_COMMAND
exec "\$BUN" run "\$ARTEMIS_HOME/app/scripts/artemis.ts" "\$@"
EOF
  chmod +x "$bin/.artemis-new"
  mv "$bin/.artemis-new" "$bin/artemis"

  # The PATH of new terminals, once.
  case ":$PATH:" in
    *":$bin:"*) on_path=1 ;;
    *) on_path=0 ;;
  esac
  if [ "$on_path" = 0 ]; then
    case "$(basename "${SHELL:-sh}")" in
      zsh) rc="$HOME/.zshrc"; line="export PATH=\"$bin:\$PATH\"" ;;
      bash) if [ "$(uname -s)" = Darwin ]; then rc="$HOME/.bash_profile"; else rc="$HOME/.bashrc"; fi; line="export PATH=\"$bin:\$PATH\"" ;;
      fish) rc="$HOME/.config/fish/config.fish"; line="fish_add_path $bin" ;;
      *) rc="$HOME/.profile"; line="export PATH=\"$bin:\$PATH\"" ;;
    esac
    mkdir -p "$(dirname "$rc")"
    touch "$rc"
    if ! grep -qF "$bin" "$rc"; then
      printf '\n# Artemis\n%s\n' "$line" >>"$rc"
    fi
  fi

  # 5. Chromium's sandbox for the sites Artemis opens (Linux). Where the system lets only the
  # programs an AppArmor profile names create user namespaces (Ubuntu 23.10 and later), Electron
  # needs Artemis's profile: one sudo step, scripts/linux-sandbox.sh, kept across updates. Asked
  # here once; without it Artemis opens sites unsandboxed and says so at every launch.
  # ARTEMIS_SANDBOX=yes or no answers without asking.
  proc="${ARTEMIS_PROC:-/proc}"
  profile="${ARTEMIS_APPARMOR_DIR:-/etc/apparmor.d}/artemis-electron"
  sandbox_script="$home/app/scripts/linux-sandbox.sh"
  sandbox_note=""
  if [ "$(cat "$proc/sys/kernel/apparmor_restrict_unprivileged_userns" 2>/dev/null || echo 0)" = 1 ] \
    && ! grep -qF "$home/app/node_modules/electron/dist/electron" "$profile" 2>/dev/null; then
    answer="${ARTEMIS_SANDBOX:-ask}"
    if [ "$answer" = ask ]; then
      answer=no
      # The script itself is curl's pipe on standard input: ask on the terminal, if there is one.
      if (: </dev/tty) 2>/dev/null; then
        printf "Chromium's sandbox needs one sudo step here (an AppArmor profile for Artemis's browser). Turn it on now? [Y/n] " >/dev/tty
        read -r reply </dev/tty || reply=n
        case "$reply" in "" | y | Y | yes | Yes | YES) answer=yes ;; esac
      fi
    fi
    # sudo asks for the password on the terminal itself.
    if [ "$answer" = yes ] && "${ARTEMIS_SUDO:-sudo}" sh "$sandbox_script" </dev/null >"$log" 2>&1; then
      step "Chromium's sandbox is on"
    else
      if [ "$answer" = yes ]; then cat "$log" >&2; fi
      sandbox_note="sudo sh $sandbox_script"
    fi
    rm -f "$log"
  fi

  say ""
  step "Artemis installed: $bin/artemis"
  say "  Profile   $home/profile"
  say "  Sessions  $home/sessions"
  [ -z "$sandbox_note" ] || say "  Sandbox   off until you run: $sandbox_note"
  say ""
  if [ "$on_path" = 0 ]; then
    say "Open a new terminal (or: export PATH=\"$bin:\$PATH\"), then:"
  else
    say "Then:"
  fi
  say "  artemis example.com"
  say "  artemis --help"
}

main "$@"
