# **************************************************************************** #
#                                                                              #
#                                                         :::      ::::::::    #
#    Makefile                                           :+:      :+:    :+:    #
#                                                     +:+ +:+         +:+      #
#    By: jrimpila <jrimpila@hive.fi>                +#+  +:+       +#+         #
#                                                 +#+#+#+#+#+   +#+            #
#    Created: 2025/06/03 14:53:47 by jrimpila          #+#    #+#              #
#    Updated: 2025/10/04 15:30:15 by jrimpila         ###   ########.fr        #
#                                                                              #
# **************************************************************************** #

# Compiler and flags
CC      = g++
CFLAGS  = -std=c++20 -Wall -Wextra -Werror -g2 -fPIE -I$(INC_DIR) -I$(SFML_DIR)/include \
          -Wshadow -Wnull-dereference -Wformat=2 -fstack-protector-strong \
          -fsanitize=address -fsanitize=undefined -fsanitize=leak \
          -fsanitize=float-divide-by-zero

MAKEFLAGS += --jobs=5

.DEFAULT_GOAL := all

# Directories
SRC_DIR = SRCS
INC_DIR = HDRS
OBJ_DIR = BUILD

# SFML setup
SFML_VERSION = 2.6.0
SFML_DIR     = SFML-$(SFML_VERSION)
SFML_TAR     = SFML-$(SFML_VERSION)-linux-gcc-64-bit.tar.gz
SFML_URL     = https://www.sfml-dev.org/files/$(SFML_TAR)
SFML_LIBS    = -L$(SFML_DIR)/lib -lsfml-graphics -lsfml-window -lsfml-system

# Fonts
FONT_DIR  = assets/fonts
FONT_FILE = DejaVuSans.ttf

# Files — recursive discovery so subfolders (units/, render/, campaign/, debug/) are included.
# patsubst with % is greedy over '/' so SRCS/units/Soldier.cpp → BUILD/units/Soldier.o.
NAME = game
SRCS = $(shell find $(SRC_DIR) -name '*.cpp')
OBJS = $(patsubst $(SRC_DIR)/%.cpp,$(OBJ_DIR)/%.o,$(SRCS))
DEPS = $(OBJS:.o=.d)

# Test build
TEST_DIR      = TESTS
TEST_NAME     = run_tests
TEST_OBJ_DIR  = BUILD/test
TEST_SRCS     = $(filter-out $(SRC_DIR)/main.cpp, $(SRCS))
TEST_OBJS     = $(patsubst $(SRC_DIR)/%.cpp,$(TEST_OBJ_DIR)/%.o,$(TEST_SRCS))
TEST_DEPS     = $(TEST_OBJS:.o=.d)
# All *.cpp files in TESTS/ are compiled and linked into the test binary.
UNIT_SRCS     = $(wildcard $(TEST_DIR)/*.cpp)
UNIT_OBJS     = $(patsubst $(TEST_DIR)/%.cpp,$(TEST_OBJ_DIR)/%.o,$(UNIT_SRCS))
UNIT_DEPS     = $(UNIT_OBJS:.o=.d)

# ── Clang cross-check ────────────────────────────────────────────────────────
# Compile with clang++ into a separate object directory so GCC and Clang
# objects never mix. Use the same CFLAGS minus GCC-only sanitizer flags.
CLANG         = clang++
CLANG_OBJ_DIR = BUILD/clang
CLANG_NAME    = game_clang
CLANG_FLAGS   = -std=c++20 -Wall -Wextra -Werror -g2 -fPIE -I$(INC_DIR) -I$(SFML_DIR)/include \
                -Wshadow -Wnull-dereference -fstack-protector-strong \
                -fsanitize=address -fsanitize=undefined -fsanitize=leak
CLANG_OBJS    = $(patsubst $(SRC_DIR)/%.cpp,$(CLANG_OBJ_DIR)/%.o,$(SRCS))
CLANG_DEPS    = $(CLANG_OBJS:.o=.d)

$(CLANG_OBJ_DIR)/%.o: $(SRC_DIR)/%.cpp
	@mkdir -p $(dir $@)
	$(CLANG) $(CLANG_FLAGS) -MMD -MP -c $< -o $@

$(CLANG_NAME): $(CLANG_OBJS)
	$(CLANG) $(CLANG_FLAGS) -o $@ $^ $(SFML_LIBS) -Wl,-rpath,$(SFML_DIR)/lib

-include $(CLANG_DEPS)

clang: $(FONT_DIR)/$(FONT_FILE) $(SFML_DIR)/include/SFML/Config.hpp $(CLANG_NAME)

.PHONY: all clean fclean re test test-serial run clang

# ── Default goal ──────────────────────────────────────────────────────────────
all: $(FONT_DIR)/$(FONT_FILE) $(SFML_DIR)/include/SFML/Config.hpp $(NAME)

# ── Main binary ───────────────────────────────────────────────────────────────
# Ask the compiler itself where its libstdc++ lives and bake that path into the binary.
# Prevents GLIBCXX version mismatches on machines where the system /lib has an older libstdc++.
STDCXX_RPATH := $(shell dirname $$($(CC) -print-file-name=libstdc++.so.6))

$(NAME): $(OBJS)
	$(CC) $(CFLAGS) -o $@ $(OBJS) $(SFML_LIBS) -Wl,-rpath,$(SFML_DIR)/lib -Wl,-rpath,$(STDCXX_RPATH)

$(OBJ_DIR)/%.o: $(SRC_DIR)/%.cpp
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) -MMD -MP -c $< -o $@

-include $(DEPS)

# ── Font ──────────────────────────────────────────────────────────────────────
$(FONT_DIR)/$(FONT_FILE):
	@mkdir -p $(FONT_DIR)
	cp /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf $@
	chmod 644 $@

# ── SFML ──────────────────────────────────────────────────────────────────────
$(SFML_DIR)/include/SFML/Config.hpp:
	wget $(SFML_URL) -O $(SFML_TAR)
	tar -xzf $(SFML_TAR)
	rm $(SFML_TAR)

# ── Tests ─────────────────────────────────────────────────────────────────────
$(TEST_OBJ_DIR)/%.o: $(SRC_DIR)/%.cpp
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) -DTESTING -MMD -MP -c $< -o $@

$(TEST_OBJ_DIR)/%.o: $(TEST_DIR)/%.cpp
	@mkdir -p $(TEST_OBJ_DIR)
	$(CC) $(CFLAGS) -DTESTING -I$(TEST_DIR) -MMD -MP -c $< -o $@

$(TEST_NAME): $(TEST_OBJS) $(UNIT_OBJS)
	$(CC) $(CFLAGS) -DTESTING -o $@ $^ $(SFML_LIBS) -Wl,-rpath,$(SFML_DIR)/lib

-include $(TEST_DEPS) $(UNIT_DEPS)

# Default: shards test cases across several processes (see TESTS/run_parallel.sh
# for why processes rather than threads). JOBS defaults to nproc; override with
# JOBS=N. CI uses test-serial instead, so a sharding-specific bug in this script
# can't mask a real failure.
test: $(FONT_DIR)/$(FONT_FILE) $(SFML_DIR)/include/SFML/Config.hpp $(TEST_NAME)
	$(TEST_DIR)/run_parallel.sh ./$(TEST_NAME)

test-serial: $(FONT_DIR)/$(FONT_FILE) $(SFML_DIR)/include/SFML/Config.hpp $(TEST_NAME)
	./$(TEST_NAME)

# ── Cleanup ───────────────────────────────────────────────────────────────────
clean:
	rm -f $(OBJS) $(DEPS) $(TEST_OBJS) $(TEST_DEPS) $(UNIT_OBJS) $(UNIT_DEPS) \
	      $(CLANG_OBJS) $(CLANG_DEPS)

fclean: clean
	rm -f $(NAME) $(TEST_NAME) $(CLANG_NAME)

re:
	$(MAKE) fclean
	$(MAKE) all

run: $(NAME)
	LD_LIBRARY_PATH=$(SFML_DIR)/lib ./$(NAME)
