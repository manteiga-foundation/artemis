#!/bin/sh
# A Linux desktop for one command: the repository synced from /src (node_modules stay the image's
# Linux ones), then a session, then the command.
#   DESKTOP=x11 (default): Xvfb at 1600x1000, openbox as the window manager, picom as the
#     compositor (DESKTOP_COMPOSITOR=0 runs without one).
#   DESKTOP=wayland: Weston headless at 1600x1000 with Xwayland, XDG_SESSION_TYPE=wayland, as an
#     Ubuntu GNOME session presents itself to apps.
set -eu
rsync -a --delete --exclude node_modules --exclude data --exclude dist --exclude dist-shell \
  --exclude .git --exclude 'scripts/__*' --exclude rt-auth-probe.mjs /src/ /app/
eval "$(dbus-launch --sh-syntax)"
if [ "${DESKTOP:-x11}" = wayland ]; then
  export XDG_RUNTIME_DIR=/tmp/xdg && mkdir -p -m 700 "$XDG_RUNTIME_DIR"
  mkdir -p -m 1777 /tmp/.X11-unix
  weston --backend=headless --renderer=pixman --width=1600 --height=1000 --xwayland --debug \
    --socket=wayland-1 >/tmp/weston.log 2>&1 &
  for i in $(seq 100); do [ -S "$XDG_RUNTIME_DIR/wayland-1" ] && break; sleep 0.1; done
  export WAYLAND_DISPLAY=wayland-1 XDG_SESSION_TYPE=wayland
  sleep 1
  # Weston starts Xwayland on demand on the first free display; it listens from the start.
  export DISPLAY=":$(ls /tmp/.X11-unix | sed -n 's/^X//p' | sort -n | tail -1)"
else
  export DISPLAY=:99
  Xvfb :99 -screen 0 1600x1000x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
  for i in $(seq 50); do xdpyinfo >/dev/null 2>&1 && break; sleep 0.1; done
  openbox >/tmp/openbox.log 2>&1 &
  if [ "${DESKTOP_COMPOSITOR:-1}" = 1 ]; then picom --backend xrender >/tmp/picom.log 2>&1 & fi
  sleep 1
fi
exec "$@"
