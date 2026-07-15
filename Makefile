# **************************************************************************** #
#                                                                              #
#                                                         :::      ::::::::    #
#    Makefile                                           :+:      :+:    :+:    #
#                                                     +:+ +:+         +:+      #
#    By: jrimpila <jrimpila@hive.fi>                +#+  +:+       +#+         #
#                                                 +#+#+#+#+#+   +#+            #
#    Created: 2025/06/03 14:53:47 by jrimpila          #+#    #+#              #
#    Updated: 2026/07/07 00:00:00 by jrimpila         ###   ########.fr        #
#                                                                              #
# **************************************************************************** #

# ── Windows shim ──────────────────────────────────────────────────────────────
# No native Windows build (see CLAUDE.md). GNU make sets OS=Windows_NT when run
# from cmd/PowerShell; forward every goal into WSL, where the toolchain lives,
# then skip the Unix rules below. WSL inherits the current directory
# (C:\gameProject → /mnt/c/gameProject) automatically, so nothing is hardcoded,
# and a single operator-free command works whether make's recipe shell is
# cmd.exe or an sh.exe on PATH.
#
# The app runs in Docker on Windows: the WSL dev servers can't work here (WSL's
# Windows-PATH interop runs Windows node.exe, which can't spawn the Linux engine
# binary). So serve/server-node/frontend are redirected to docker-up — the whole
# stack in Linux containers; every other goal forwards to WSL unchanged.
ifeq ($(OS),Windows_NT)

GOALS       := $(or $(MAKECMDGOALS),all)
RUN_TARGETS := serve server-node frontend
FWD         := $(foreach g,$(GOALS),$(if $(filter $(RUN_TARGETS),$g),docker-up,$g))
ifneq ($(FWD),$(GOALS))
$(info Windows: the app runs in Docker; forwarding as 'make $(FWD)'.)
endif

.PHONY: $(GOALS) __wsl
$(GOALS): __wsl
	@:
__wsl:
	@wsl -e bash -lc "make $(FWD)"

else

# Non-Windows: this project builds on Linux only (headless engine, Linux
# toolchain, and the Unix shell built-ins used below). Bail out clearly on
# anything else (macOS, *BSD, …) instead of failing later with cryptic errors.
UNAME_S := $(shell uname -s)
ifneq ($(UNAME_S),Linux)
$(error Unsupported platform '$(UNAME_S)': build on Linux, or on Windows via WSL)
endif

# Compiler and flags
CC      = g++

MAKEFLAGS += --jobs=5

.DEFAULT_GOAL := all

# Directories
BACKEND_DIR  = backend
OBJ_DIR      = BUILD

# Include flags — one -I per module; preserves "server/X.hpp" etc.
# The engine is headless: battles simulate + record to JSON, and the browser
# ReplayView is the only renderer (no SFML — see docs/CAMPAIGN_PLAN.md).
INC_FLAGS    = -I$(BACKEND_DIR)/engine/include \
               -I$(BACKEND_DIR)/server/include \
               -I$(BACKEND_DIR)/scenarios/include

CFLAGS  = -std=c++20 -Wall -Wextra -Werror -g2 -fPIE $(INC_FLAGS) \
          -Wshadow -Wnull-dereference -Wformat=2 -fstack-protector-strong \
          -fsanitize=address -fsanitize=undefined -fsanitize=leak \
          -fsanitize=float-divide-by-zero

# Files — recursive discovery under backend/; subfolders included automatically.
# patsubst strips backend/ prefix so objects mirror the source tree under BUILD/.
NAME = game
SRCS = $(shell find $(BACKEND_DIR) -name '*.cpp' ! -path '*/engine/tests/*')
OBJS = $(patsubst $(BACKEND_DIR)/%.cpp,$(OBJ_DIR)/%.o,$(SRCS))
DEPS = $(OBJS:.o=.d)

# Test build
TEST_DIR      = $(BACKEND_DIR)/engine/tests
TEST_NAME     = run_tests
TEST_OBJ_DIR  = BUILD/test
TEST_SRCS     = $(filter-out $(BACKEND_DIR)/main.cpp, $(SRCS))
TEST_OBJS     = $(patsubst $(BACKEND_DIR)/%.cpp,$(TEST_OBJ_DIR)/%.o,$(TEST_SRCS))
TEST_DEPS     = $(TEST_OBJS:.o=.d)
# All *.cpp files in the tests directory are compiled and linked into the test binary.
UNIT_SRCS     = $(wildcard $(TEST_DIR)/*.cpp)
UNIT_OBJS     = $(patsubst $(TEST_DIR)/%.cpp,$(TEST_OBJ_DIR)/%.o,$(UNIT_SRCS))
UNIT_DEPS     = $(UNIT_OBJS:.o=.d)

# ── Clang cross-check ────────────────────────────────────────────────────────
# Compile with clang++ into a separate object directory so GCC and Clang
# objects never mix. Use the same CFLAGS minus GCC-only sanitizer flags.
CLANG         = clang++
CLANG_OBJ_DIR = BUILD/clang
CLANG_NAME    = game_clang
CLANG_FLAGS   = -std=c++20 -Wall -Wextra -Werror -g2 -fPIE $(INC_FLAGS) \
                -Wshadow -Wnull-dereference -fstack-protector-strong \
                -fsanitize=address -fsanitize=undefined -fsanitize=leak
CLANG_OBJS    = $(patsubst $(BACKEND_DIR)/%.cpp,$(CLANG_OBJ_DIR)/%.o,$(SRCS))
CLANG_DEPS    = $(CLANG_OBJS:.o=.d)

$(CLANG_OBJ_DIR)/%.o: $(BACKEND_DIR)/%.cpp
	@mkdir -p $(dir $@)
	$(CLANG) $(CLANG_FLAGS) -MMD -MP -c $< -o $@

$(CLANG_NAME): $(CLANG_OBJS)
	$(CLANG) $(CLANG_FLAGS) -o $@ $^

-include $(CLANG_DEPS)

clang: $(CLANG_NAME)

.PHONY: all clean fclean re test test-serial clang serve server-node frontend frontend-test db-clean docker-check docker-build docker-up docker-down docker-clean docker-logs

# ── Default goal ──────────────────────────────────────────────────────────────
all: $(NAME)

# ── Main binary ───────────────────────────────────────────────────────────────
# Ask the compiler itself where its libstdc++ lives and bake that path into the binary.
# Prevents GLIBCXX version mismatches on machines where the system /lib has an older libstdc++.
STDCXX_RPATH := $(shell dirname $$($(CC) -print-file-name=libstdc++.so.6))

$(NAME): $(OBJS)
	$(CC) $(CFLAGS) -o $@ $(OBJS) -Wl,-rpath,$(STDCXX_RPATH)

$(OBJ_DIR)/%.o: $(BACKEND_DIR)/%.cpp
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) -MMD -MP -c $< -o $@

-include $(DEPS)

# ── Tests ─────────────────────────────────────────────────────────────────────
$(TEST_OBJ_DIR)/%.o: $(BACKEND_DIR)/%.cpp
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) -DTESTING -MMD -MP -c $< -o $@

$(TEST_OBJ_DIR)/%.o: $(TEST_DIR)/%.cpp
	@mkdir -p $(TEST_OBJ_DIR)
	$(CC) $(CFLAGS) -DTESTING -I$(TEST_DIR) -MMD -MP -c $< -o $@

$(TEST_NAME): $(TEST_OBJS) $(UNIT_OBJS)
	$(CC) $(CFLAGS) -DTESTING -o $@ $^

-include $(TEST_DEPS) $(UNIT_DEPS)

# Default: shards test cases across several processes (see backend/engine/tests/run_parallel.sh
# for why processes rather than threads). JOBS defaults to nproc; override with
# JOBS=N. CI uses test-serial instead, so a sharding-specific bug in this script
# can't mask a real failure.
test: $(TEST_NAME)
	$(TEST_DIR)/run_parallel.sh ./$(TEST_NAME)

test-serial: $(TEST_NAME)
	./$(TEST_NAME)

# ── Cleanup ───────────────────────────────────────────────────────────────────
# Campaign DB (embedded persistent mongod). Lives OUTSIDE the repo on a real
# Linux filesystem because mongod cannot run on /mnt/c (drvfs) — this default
# mirrors campaign-server/utils/config.js (DB_PATH); change both together.
DB_DIR = $(HOME)/.gameproject/db

clean:
	rm -f $(OBJS) $(DEPS) $(TEST_OBJS) $(TEST_DEPS) $(UNIT_OBJS) $(UNIT_DEPS) \
	      $(CLANG_OBJS) $(CLANG_DEPS)

# Wipe the campaign DB (battles, replays, unit catalog). The catalog re-syncs
# on the next campaign-server start; battles/replays are gone for good.
# campaign-server/data holds only stray test/legacy files, cleared too.
db-clean:
	rm -rf $(DB_DIR) campaign-server/data

fclean: clean db-clean
	rm -f $(NAME) $(TEST_NAME) $(CLANG_NAME)

re:
	$(MAKE) fclean
	$(MAKE) all

# ── Campaign dev ──────────────────────────────────────────────────────────────
# Node BFF (campaign-server/): DB + replay storage; spawns ./game itself.
# This is what the frontend's /api proxy points at (port 3001).
server-node: $(NAME)
	cd campaign-server && npm start

frontend:
	cd frontend && npm run dev

# Run React/Vitest tests. Uses whatever node/npm is on PATH (/usr/bin node v22 here).
frontend-test:
	npm --prefix frontend test

# Launch campaign server (Node BFF) + Vite dev server side-by-side.
serve: $(NAME)
	cd campaign-server && npm start &
	cd frontend && npm run dev

# ── Docker ────────────────────────────────────────────────────────────────────
# Full stack (engine + campaign server + built frontend + MongoDB) in
# containers, for running the game on any machine with Docker (Windows:
# Docker Desktop). NOT for the WSL dev machine (no Docker there — WSL runs
# the stack natively via `make serve`); the CI "docker" job builds and
# smoke-tests the image on every push. Battles are headless (no X server).

# All docker targets fail fast with a real explanation when docker is absent
# (fresh laptop, plain WSL without Docker Desktop) instead of a bare
# "docker: command not found" — the native no-docker path is `make serve`.
docker-check:
	@command -v docker >/dev/null 2>&1 || { \
	  echo "error: docker is not installed (or not on PATH in this shell)."; \
	  echo "  - On Windows: install Docker Desktop with the WSL2 backend, and enable"; \
	  echo "    WSL integration for this distro (Settings > Resources > WSL integration)."; \
	  echo "  - No Docker needed for development: 'make serve' runs the full stack natively."; \
	  exit 1; }

# Build just the game image (no containers started).
docker-build: docker-check
	docker build -t gameproject .

# Build + start everything → http://localhost:5173, log in as testuser/test.
# (5173 = the same port the Vite dev server uses natively, so the game URL is
# identical on every machine; the compose file sets the PORT override.)
# Campaigns persist in the `gamedb` volume across restarts.
docker-up: docker-check
	docker compose up --build

# Stop the stack; campaign DB volume survives for the next docker-up.
docker-down: docker-check
	docker compose down

# Stop the stack AND wipe the campaign DB volume — the Docker twin of db-clean.
docker-clean: docker-check
	docker compose down -v

# Follow the game server's logs (battle tick counts, boot messages).
docker-logs: docker-check
	docker compose logs -f game

endif  # Windows shim: end of Unix (else) branch
