# Full game stack in one image: C++ battle engine + Node campaign server +
# built React frontend, served together on one port (PORT, default 3001 —
# CI uses the default; docker-compose overrides to 5173 so the game URL
# matches native Vite dev). Pair with an external MongoDB
# (docker-compose.yml provides one) via MONGODB_URI.
#
# This is the LINUX build in a box — the way to run/test the game on any
# machine with Docker (including Windows via Docker Desktop/WSL2), not a
# native port. Battles are fully headless: `./game battle` simulates and
# prints replay JSON, and the browser ReplayView is the only renderer, so
# there is no X server / SFML in the image.

# ── Stage 1: C++ engine ──────────────────────────────────────────────────────
# Ubuntu 24.04 matches CI (gcc 13). The engine is headless — no SFML download,
# no X11/freetype link deps.
FROM ubuntu:24.04 AS engine-build
RUN apt-get update && apt-get install -y --no-install-recommends \
        g++ make ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY Makefile ./
COPY backend/ backend/
RUN make

# ── Stage 2: frontend ────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS frontend-build
WORKDIR /src/frontend
# .npmrc's engine-strict + the engines.npm floor guard against lockfile drift:
# this stage's npm (11.x) must satisfy them; the runtime stage below installs
# campaign-server deps with NodeSource node 22's npm 10, so its .npmrc is
# deliberately NOT copied before that npm ci — the floor is for machines that
# WRITE package-lock.json, and the image only ever consumes it.
COPY frontend/package.json frontend/package-lock.json frontend/.npmrc ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 3: runtime ─────────────────────────────────────────────────────────
FROM ubuntu:24.04
# - libasan8/libubsan1/liblsan0: the engine is built with the dev sanitizers
# - nodejs 22 from NodeSource (Ubuntu's own nodejs is too old)
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl \
        libasan8 libubsan1 liblsan0 \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=engine-build /src/game ./game
COPY maps/ ./maps/

COPY campaign-server/package.json campaign-server/package-lock.json ./campaign-server/
RUN cd campaign-server && npm ci --omit=dev
COPY campaign-server/ ./campaign-server/
COPY --from=frontend-build /src/frontend/dist ./frontend/dist

# Automatic build stamp (config.APP_VERSION reads this file). Placed AFTER
# every content COPY so Docker's layer cache re-runs it exactly when any code
# changed: every new build gets a fresh version, identical rebuilds keep
# theirs. The campaign server deletes saves from other builds at login
# (user, 2026-07-05: a stale save is never worth the risk), so no manual
# version bump can be forgotten. APP_VERSION build-arg still overrides.
RUN date -u +build-%Y%m%dT%H%M%SZ > /app/BUILD_VERSION
ARG APP_VERSION=
ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION} \
    ENGINE_BIN=/app/game \
    GAME_DIR=/app \
    MAPS_DIR=/app/maps \
    FRONTEND_DIST=/app/frontend/dist \
    PORT=3001

EXPOSE 3001
WORKDIR /app/campaign-server
CMD ["node", "index.js"]
