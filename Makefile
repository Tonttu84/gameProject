# **************************************************************************** #
#                                                                              #
#                                                         :::      ::::::::    #
#    Makefile                                           :+:      :+:    :+:    #
#                                                     +:+ +:+         +:+      #
#    By: jrimpila <jrimpila@student.hive.fi>        +#+  +:+       +#+         #
#                                                 +#+#+#+#+#+   +#+            #
#    Created: 2025/06/03 14:53:47 by jrimpila          #+#    #+#              #
#    Updated: 2025/08/19 12:39:02 by jrimpila         ###   ########.fr        #
#                                                                              #
# **************************************************************************** #

# Compiler and flags
# Compiler and flags
CC      = c++
CFLAGS  = -std=c++17 -Wall -Wextra -Werror -g2 -I$(INC_DIR)

# Directories
SRC_DIR = SRCS
INC_DIR = HDRS
OBJ_DIR = BUILD

# Files
SRCS    = $(wildcard $(SRC_DIR)/*.cpp)
OBJS    = $(patsubst $(SRC_DIR)/%.cpp,$(OBJ_DIR)/%.o,$(SRCS))
DEPS    = $(OBJS:.o=.d)
NAME    = game

# Build rules
all: $(NAME)

$(NAME): $(OBJS)
	$(CC) $(CFLAGS) -o $@ $(OBJS)


$(OBJ_DIR)/%.o: $(SRC_DIR)/%.cpp
	@mkdir -p $(OBJ_DIR)
	$(CC) $(CFLAGS) -MMD -MP -c $< -o $@

# Include dependency files
-include $(DEPS)

clean:
	rm -f $(OBJ_DIR)/*.o $(OBJ_DIR)/*.d

fclean: clean
	rm -f $(NAME)

re: fclean all
