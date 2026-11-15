#!/bin/sh
# Turn on Chromium's sandbox for Artemis's owned browser on Linux. Run it once, as root:
#
#   sudo sh ~/.artemis/app/scripts/linux-sandbox.sh
#
# Chromium sandboxes a site's pages with user namespaces, or else with its setuid helper
# (chrome-sandbox). Ubuntu 23.10 and later allow user namespaces only to programs an AppArmor
# profile names, so Electron cannot use them as installed and Artemis launches it without the
# sandbox (and says so in the terminal). This script does the smallest thing that turns it on:
#   - AppArmor restricting user namespaces (Ubuntu): a profile that lets this Electron, and nothing
#     else, create them: /etc/apparmor.d/artemis-electron. It names the binary's path, which an
#     `artemis update` keeps, so it lasts.
#   - User namespaces switched off altogether: chrome-sandbox owned by root with mode 4755, as
#     Chromium asks. An `artemis update` replaces the app, so run this again after one.
# To undo: sudo rm /etc/apparmor.d/artemis-electron && sudo apparmor_parser -R artemis-electron
# (or delete ~/.artemis/app/node_modules/electron/dist/chrome-sandbox's setuid bit).
set -eu

[ "$(id -u)" = 0 ] || { echo "Run it as root: sudo sh $0" >&2; exit 1; }
dist="$(cd "$(dirname "$0")/../node_modules/electron/dist" && pwd -P)" || { echo "Electron is not installed beside this script" >&2; exit 1; }
[ -x "$dist/electron" ] || { echo "Electron is not installed in $dist" >&2; exit 1; }

restrict="$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)"
clone="$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null || echo 1)"
max="$(cat /proc/sys/user/max_user_namespaces 2>/dev/null || echo 1)"

if [ "$restrict" = 1 ] && [ "$clone" != 0 ] && [ "$max" != 0 ]; then
  cat >/etc/apparmor.d/artemis-electron <<EOF
# Artemis's owned browser (scripts/linux-sandbox.sh): lets this Electron create the user
# namespaces Chromium's sandbox is made of. Unconfined otherwise, as it was.
abi <abi/4.0>,
include <tunables/global>

profile artemis-electron $dist/electron flags=(unconfined) {
  userns,

  include if exists <local/artemis-electron>
}
EOF
  apparmor_parser -r /etc/apparmor.d/artemis-electron
  echo "Chromium's sandbox is on: AppArmor lets $dist/electron use user namespaces."
else
  chown root:root "$dist/chrome-sandbox"
  chmod 4755 "$dist/chrome-sandbox"
  echo "Chromium's sandbox is on: $dist/chrome-sandbox is root's, mode 4755 (run this again after artemis update)."
fi
