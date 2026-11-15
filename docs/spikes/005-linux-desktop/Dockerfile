# Spike 005: the owned browser (Electron shell) on a Linux desktop, in a container.
# The Playwright image carries Chromium, Xvfb, GTK and fonts; added here: what Electron needs on top,
# a window manager (openbox), a compositor (picom: transparent windows need one), xdotool for real X
# input, and ImageMagick to grab the composited screen.
# Build from the repository root:  docker build -f docs/spikes/005-linux-desktop/Dockerfile -t artemis-linux .
FROM mcr.microsoft.com/playwright:v1.63.0-noble

ENV BUN_INSTALL=/usr/local/bun
ENV PATH=$BUN_INSTALL/bin:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends \
      unzip rsync openbox picom xdotool imagemagick x11-utils dbus-x11 \
      libnss3 libatk-bridge2.0-0t64 libgtk-3-0t64 libgbm1 libasound2t64 libxss1 libxtst6 libnotify4 xdg-utils \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.2"

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile && bun node_modules/electron/install.js

# A Wayland session (Ubuntu's default): Weston headless with Xwayland, screenshots through
# weston-screenshooter. sqlite3: the recorder tests read the live database from another process.
RUN apt-get update && apt-get install -y --no-install-recommends weston xwayland sqlite3 && rm -rf /var/lib/apt/lists/*

# The source comes in at run time from a read-only mount (/src), so iterating needs no rebuild.
COPY docs/spikes/005-linux-desktop/desktop.sh /usr/local/bin/desktop
RUN chmod +x /usr/local/bin/desktop
ENTRYPOINT ["desktop"]
