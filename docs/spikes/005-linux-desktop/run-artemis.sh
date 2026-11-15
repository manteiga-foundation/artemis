#!/bin/sh
# Spike 005: the installed `artemis` on a virtual display (Xvfb, openbox, picom) on Ubuntu, flying a
# real site at max, screenshots of the whole screen along the way, then Ctrl+C and the saved files.
#   sh run-artemis.sh <site> <out dir> [seconds]
set -u
site="$1"
out="$2"
secs="${3:-75}"
mkdir -p "$out"
export DISPLAY=:99 PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH" FORCE_COLOR=0 NO_COLOR=1
pgrep -x Xvfb >/dev/null || { Xvfb :99 -screen 0 1600x1000x24 -nolisten tcp >/tmp/xvfb.log 2>&1 & sleep 1; }
pgrep -x openbox >/dev/null || { openbox >/tmp/openbox.log 2>&1 & }
pgrep -x picom >/dev/null || { picom --backend xrender >/tmp/picom.log 2>&1 & }
sleep 1
artemis "$site" --autopilot max >"$out/terminal.txt" 2>&1 &
pid=$!
for t in 15 30 45 60; do
  [ "$t" -le "$secs" ] || break
  sleep 15
  import -window root "$out/screen-${t}s.png"
done
sleep $((secs > 60 ? secs - 60 : 0))
# V: the cosmos the flight drew, then the whole screen once more.
xdotool key v
sleep 15
import -window root "$out/screen-cosmos.png"
kill -INT "$pid"
wait "$pid"
echo "exit $?" >>"$out/terminal.txt"
ls -la "$HOME/.artemis/sessions" >"$out/sessions.txt"
