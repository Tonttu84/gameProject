#!/bin/bash
# SessionStart hook for Claude Code on the web (remote sessions).
#
# A fresh remote clone has no node_modules and no built ./game, so the test
# suites and linters can't run until this provisions them. It:
#   1. builds the headless engine (./game) — needed by the C++ tests and by
#      campaign-server's engine.integration.test.js, which spawns it;
#   2. installs the campaign-server + frontend node deps.
#
# npm_config_engine_strict=false is deliberate. Root .npmrc pins
# engine-strict=true so the LOCKFILE is only ever (re)written by npm >= 11
# (guarding against cross-machine lockfile drift), but this managed image ships
# npm 10 and `npm ci` only READS the lockfile — bypassing the version GATE here
# keeps the guard's intent intact while letting the reproducible install run.
# Drop it once the base image ships npm >= 11.
#
# NOT provisioned: mongod. campaign-server's DB-backed tests use
# mongodb-memory-server, whose binary download host (fastdl.mongodb.org) is
# blocked by this environment's egress policy, so those files can't run here
# (CI runs them against a real mongo container). Everything else runs: the
# pure-logic campaign-server tests, the frontend Vitest suite, fe-lint (oxlint),
# and the C++ engine tests via `make test-serial`.
set -euo pipefail

# Local dev boxes (Linux/WSL/Windows) manage their own toolchain — see CLAUDE.md.
# Only provision the managed web environment.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# 1. The headless engine binary (idempotent — make no-ops when up to date).
make -j"$(nproc)" game

# 2. Node deps for the two test suites (see the engine-strict note above).
#    `npm ci` is reproducible and never rewrites the lockfile.
export npm_config_engine_strict=false
( cd campaign-server && npm ci --no-audit --no-fund )
( cd frontend       && npm ci --no-audit --no-fund )
