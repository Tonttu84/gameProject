#!/bin/bash
# Runtime entrypoint: pick the X display the engine's SFML windows render to.
#
# If a host X server's socket is mounted at /tmp/.X11-unix (see
# docker-compose.display.yml — Windows Docker Desktop exposes the WSLg server
# there), use it: spawned `./game battle` windows appear on the real desktop.
# Otherwise start a headless Xvfb, the default for `make docker-up` and what
# the CI docker job smokes.
#
# A plain background Xvfb, deliberately not xvfb-run: it hides Xvfb's stderr
# in a temp file and, if Xvfb crashloops, spins forever without ever starting
# node — this way Xvfb errors land in the container log and the server still
# boots (only battles would fail) if the virtual display is broken.
#
# Runs with WORKDIR /app/campaign-server (like the CMD it replaced).
if [ -S /tmp/.X11-unix/X0 ]; then
    export DISPLAY="${DISPLAY:-:0}"
    echo "entrypoint: host X socket mounted — battle windows go to DISPLAY=${DISPLAY}"
else
    echo "entrypoint: no host X socket — starting headless Xvfb on :99"
    Xvfb :99 -screen 0 800x600x24 &
    export DISPLAY=:99
fi
exec node index.js
