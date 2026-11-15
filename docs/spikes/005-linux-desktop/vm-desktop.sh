#!/bin/sh
# Spike 005 on a real Ubuntu 24.04 (Lima VM): an X11 desktop (Xvfb, openbox, picom) for one
# command, run from the installed app (~/.artemis/app).
set -eu
export DISPLAY=:99
pgrep -x Xvfb >/dev/null || { Xvfb :99 -screen 0 1600x1000x24 -nolisten tcp >/tmp/xvfb.log 2>&1 & sleep 1; }
pgrep -x openbox >/dev/null || { openbox >/tmp/openbox.log 2>&1 & }
pgrep -x picom >/dev/null || { picom --backend xrender >/tmp/picom.log 2>&1 & }
sleep 1
cd "$HOME/.artemis/app"
exec "$@"
