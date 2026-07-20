#!/usr/bin/env bash
# ── Dev-command wrapper ───────────────────────────────────────────────────────
# Purpose: give Claude Code (and humans) ONE operator-free command line for every
# common build/test task, so a single permission allow-rule can cover them all.
#
# Why this exists: Claude Code's permission engine splits a command on shell
# operators (&&, ||, ;, |, &) and requires EACH sub-command to match an allow
# rule — and its splitter is NOT quote-aware. So operators *inside* the quoted
# argument of `wsl -e bash -lc 'cd x && make | tail'` get split anyway, and no
# prefix rule like Bash(wsl -e bash -lc *) can ever authorize them → a prompt on
# every real compound command (verified 2026-07-08).
#
# By keeping all operators INSIDE this script, the command line stays a single
# token, e.g.:   wsl -e bash -lc 'bash /mnt/c/gameProject/scripts/dev.sh test'
# which the existing Bash(wsl -e bash -lc *) rule covers with no prompt, and
# which travels with the repo (works the same on every machine).
#
# Usage:  bash scripts/dev.sh <task> [args]
#   build [make-args]   full engine build            (make)
#   re                  fclean + rebuild             (make re)
#   test                serial C++ test suite (CI)   (make test-serial)
#   test-par            sharded C++ test suite       (make test)
#   clang               clang cross-compile          (make clang)
#   case "<filter>"     one C++ test by Catch2 filter (builds, then ./run_tests)
#   fe-test [args]      frontend Vitest suite        (make frontend-test)
#   fe-lint [args]      frontend oxlint              (npm --prefix frontend run lint)
#   cs-test [args]      campaign-server Vitest suite
#   info                build + ./game info
# Env: TAIL=N trims output to the last N lines (default 40; 0 = no trim).
# NOTE for Claude Code: pass the override as `dev.sh -tN <task>` (INSIDE the
# quoted wsl argument), never as a `TAIL=N wsl …` env prefix — the prefix
# changes the command's first token and no allow rule matches it → prompt.
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root (…/gameProject)

# Pick up nvm's node/npm/npx if this shell wasn't started as a login shell
# (nvm is normally sourced from ~/.bashrc or ~/.zshrc, which a non-login
# invocation of this script skips) — makes `bash scripts/dev.sh <task>` work
# standalone instead of requiring the caller to wrap it in `bash -lc`.
if ! command -v npx >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$HOME/.nvm/nvm.sh"
fi

tail_n="${TAIL:-40}"
_run() { if [ "$tail_n" = "0" ]; then "$@"; else "$@" 2>&1 | tail -n "$tail_n"; fi; }

# Flatpak-sandbox workaround for `cs-test` (mongodb-memory-server can't detect
# the distro to download mongod in there, and parallel file runs hit
# binary-startup contention). Gated on /.flatpak-info so this is a no-op on
# every machine that isn't running the editor/shell inside a Flatpak sandbox —
# see reference_laptop_mongo_tests memory for the failure modes this avoids.
if [ -e /.flatpak-info ]; then
  export MONGOMS_DISTRO="${MONGOMS_DISTRO:-ubuntu-22.04}"
  cs_test_extra_args=(--no-file-parallelism)
else
  cs_test_extra_args=()
fi

task="${1:-help}"; shift || true
# Optional tail override carried INSIDE the single-token command line
# (`dev.sh -t60 cs-test …`) so the permission rule still matches — a TAIL=N
# env prefix before `wsl` would force a prompt (see NOTE above).
if [[ "$task" =~ ^-t([0-9]+)$ ]]; then
  tail_n="${BASH_REMATCH[1]}"
  task="${1:-help}"; shift || true
fi
case "$task" in
  build)    _run make "$@" ;;
  re)       _run make re ;;
  test)     _run make test-serial ;;
  test-par) _run make test ;;
  clang)    _run make clang ;;
  case)     make run_tests >/dev/null 2>&1; _run ./run_tests "$@" ;;
  fe-test)  _run make frontend-test ;;
  fe-lint)  _run npm --prefix frontend run lint "$@" ;;
  cs-test)  ( cd campaign-server && _run npx vitest run "${cs_test_extra_args[@]}" "$@" ) ;;
  info)     make >/dev/null 2>&1; ./game info ;;
  help|*)   sed -n '/^# Usage:/,/^# Env:/p' "$0" | sed 's/^# \{0,1\}//' ; [ "$task" = help ] || { echo "unknown task: $task" >&2; exit 2; } ;;
esac
