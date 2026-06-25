/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Utility.hpp                                        :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@hive.fi>                +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/17 12:57:50 by jrimpila          #+#    #+#             */
/*   Updated: 2025/10/06 10:59:56 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#pragma once
#include "Defines.hpp"
#include <vector>
#include <memory>

#include <random>
#ifdef TESTING
#include <queue>
#endif
#include "Battlefield.hpp"
#include <iostream>
#include <functional>
#include <SFML/Graphics.hpp>






class Utility
{
public:
        static int throwDice();
        static sf::Font font;
        static void load();

        static AUnit* findTarget(const std::vector<std::unique_ptr<AUnit>>& targets, const std::function<bool(const AUnit&, int)>& validPriorityTarget, \
        const std::function<int(const AUnit&, int)>& validTarget, int myTeam);
        static Battlefield &getBattlefield();
        static Cell *Deviate(const Cell &source, int OriginalH, int OriginalW, int accuracy);
        static int getRandom(int lowerBound, int upperBound);
        static Cell *FindPriorityTarget(const std::vector<std::unique_ptr<AUnit>>& targetTeam, const std::function<int(const AUnit&, int)>&, int myTeam);
        static ssize_t calcDistance(const Cell *target, const Cell*source);

#ifdef TESTING
        static void pushDiceRoll(int value);
        static void clearDiceRolls();
#endif

    private:
        static std::mt19937 gen;
#ifdef TESTING
        static std::queue<int> mockValues;
#endif
        Utility() = delete;
        ~Utility() = delete;
};

