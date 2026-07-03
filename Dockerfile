# Full game stack in one image: C++ battle engine + Node campaign server +
# built React frontend, served together on port 3001. Pair with an external
# MongoDB (docker-compose.yml provides one) via MONGODB_URI.
#
# This is the LINUX build in a box — the way to run/test the game on any
# machine with Docker (including Windows via Docker Desktop/WSL2), not a
# native port. `./game battle` opens an SFML window even when spawned by the
# server, so the runtime wraps everything in Xvfb (a headless X display).

# ── Stage 1: C++ engine ──────────────────────────────────────────────────────
# Ubuntu 24.04 matches CI (gcc 13). `make` downloads the prebuilt SFML binary
# unless backend/SFML-2.6.0/ is already in the build context. The X11/freetype
# runtime libs must be present at LINK time too — ld resolves the prebuilt
# libsfml-*.so's own dependencies (same list the CI test job installs).
FROM ubuntu:24.04 AS engine-build
RUN apt-get update && apt-get install -y --no-install-recommends \
        g++ make wget ca-certificates fonts-dejavu-core \
        libx11-6 libxrandr2 libxcursor1 libudev1 libgl1 libfreetype6 \
        libogg0 libvorbis0a \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY Makefile ./
COPY backend/ backend/
COPY assets/ assets/
RUN make

# ── Stage 2: frontend ────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS frontend-build
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 3: runtime ─────────────────────────────────────────────────────────
FROM ubuntu:24.04
# - xvfb/xauth: virtual display for the engine's SFML window modes
# - libx11/xrandr/xcursor/udev/gl/freetype: SFML runtime dependencies
# - libasan8/libubsan1/liblsan0: the engine is built with the dev sanitizers
# - nodejs 22 from NodeSource (Ubuntu's own nodejs is too old)
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl xvfb xauth fonts-dejavu-core \
        libx11-6 libxrandr2 libxcursor1 libudev1 libgl1 libfreetype6 \
        libasan8 libubsan1 liblsan0 \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# The engine binary's rpath is backend/SFML-2.6.0/lib relative to its cwd
# (GAME_DIR=/app), so keep the repo layout.
COPY --from=engine-build /src/game ./game
COPY --from=engine-build /src/backend/SFML-2.6.0/lib ./backend/SFML-2.6.0/lib
COPY --from=engine-build /src/assets ./assets
COPY maps/ ./maps/

COPY campaign-server/package.json campaign-server/package-lock.json ./campaign-server/
RUN cd campaign-server && npm ci --omit=dev
COPY campaign-server/ ./campaign-server/
COPY --from=frontend-build /src/frontend/dist ./frontend/dist

ENV NODE_ENV=production \
    ENGINE_BIN=/app/game \
    GAME_DIR=/app \
    MAPS_DIR=/app/maps \
    FRONTEND_DIST=/app/frontend/dist \
    PORT=3001

EXPOSE 3001
WORKDIR /app/campaign-server
# xvfb-run provides the DISPLAY the spawned `./game battle` windows need.
CMD ["xvfb-run", "-a", "node", "index.js"]
