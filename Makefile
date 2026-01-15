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
CC      = c++
CFLAGS  = -std=c++17 -Wall -Wextra -Werror -g2 -I$(INC_DIR) -I$(SFML_DIR)/include \
          -fsanitize=address -fsanitize=undefined -fsanitize=leak

# Directories
SRC_DIR = SRCS
INC_DIR = HDRS
OBJ_DIR = BUILD

# SFML setup
SFML_VERSION = 2.6.0
SFML_DIR = SFML-$(SFML_VERSION)
SFML_TAR = SFML-$(SFML_VERSION)-linux-gcc-64-bit.tar.gz
SFML_URL = https://www.sfml-dev.org/files/$(SFML_TAR)
SFML_LIBS = -L$(SFML_DIR)/lib -lsfml-graphics -lsfml-window -lsfml-system


# Fonts 
FONT_DIR = assets/fonts
FONT_FILE = DejaVuSans.ttf

$(FONT_DIR)/$(FONT_FILE):
	@mkdir -p $(FONT_DIR)
	cp /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf $@
	chmod 644 $@

all: $(FONT_DIR)/$(FONT_FILE) $(SFML_DIR)/include/SFML/Config.hpp $(NAME)


# Files
SRCS    = $(wildcard $(SRC_DIR)/*.cpp)
OBJS    = $(patsubst $(SRC_DIR)/%.cpp,$(OBJ_DIR)/%.o,$(SRCS))
DEPS    = $(OBJS:.o=.d)
NAME    = game

# Build rules
all: $(SFML_DIR)/include/SFML/Config.hpp $(NAME)

$(NAME): $(OBJS)
	$(CC) $(CFLAGS) -o $@ $(OBJS) $(SFML_LIBS) -Wl,-rpath,$(SFML_DIR)/lib

$(OBJ_DIR)/%.o: $(SRC_DIR)/%.cpp
	@mkdir -p $(OBJ_DIR)
	$(CC) $(CFLAGS) -MMD -MP -c $< -o $@

# SFML download and extraction
$(SFML_DIR)/include/SFML/Config.hpp: $(SFML_TAR)
	tar -xzf $(SFML_TAR)
	rm $(SFML_TAR)

$(SFML_TAR):
	wget $(SFML_URL)

# Include dependency files
-include $(DEPS)

# Cleanup
clean:
	rm -f $(OBJ_DIR)/*.o $(OBJ_DIR)/*.d

fclean: clean
	rm -f $(NAME)

re: fclean all

run: $(NAME)
	LD_LIBRARY_PATH=$(SFML_DIR)/lib ./$(NAME)
