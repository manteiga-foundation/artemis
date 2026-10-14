# Spike 004: Artemis as one Linux container (the Playwright image already carries Chromium, its
# shared libraries, fonts and ffmpeg at the exact version package.json pins; Bun is added).
# Build from the repository root:  docker build -f docs/spikes/004-container/Dockerfile -t artemis-spike .
FROM mcr.microsoft.com/playwright:v1.63.0-noble

ENV BUN_INSTALL=/usr/local/bun
ENV PATH=$BUN_INSTALL/bin:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends unzip && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.2"

WORKDIR /app
COPY package.json bun.lock ./
# Electron is a devDependency the container never runs.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# Sessions, HARs and videos.
VOLUME /data
ENV ARTEMIS_SESSIONS_DIR=/data/sessions
ENV ARTEMIS_PROFILE_DIR=/data/profile
EXPOSE 5173
CMD ["bun", "run", "docs/spikes/004-container/serve.ts"]
