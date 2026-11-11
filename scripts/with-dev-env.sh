#!/usr/bin/env bash
# Runs a command with the secrets overlay (gameproject/dev.env in the private
# secrets repo) exported, for the native `make serve` / `make server-node`.
# The committed dev.env holds only empty names, so it is not sourced here: an
# empty value would clobber one the caller already exported. Without the
# overlay the command still runs, and the campaign server warns at boot (random
# JWT secret, dev login off; docs/decisions.md D10).
#
# Usage: bash scripts/with-dev-env.sh <command> [args]
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
overlay="${SECRETS_DIR:-$root/../secrets}/gameproject/dev.env"
if [ -f "$overlay" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$overlay"
  set +a
else
  echo "with-dev-env: no secrets overlay at $overlay (random JWT secret, dev login off)" >&2
fi
exec "$@"
