/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Utility.hpp                                        :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@student.hive.fi>        +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/17 12:57:50 by jrimpila          #+#    #+#             */
/*   Updated: 2025/08/30 17:22:35 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#pragma once
#include <vector>
#include <memory>
#include <AUnit.hpp>
#include <random>
#include "Battlefield.hpp"
#include <iostream>
#include <functional>


class Utility
{
public:
        static int throwDice();

    static AUnit* findTarget(const std::vector<std::unique_ptr<AUnit>>& targets, const std::function<bool(const AUnit&, int)>& validPriorityTarget, \
    const std::function<int(const AUnit&, int)>& validTarget, int myTeam);
    static Battlefield &getBattlefield();
    static Cell *Deviate(const Cell &source, int OriginalH, int OriginalW, int accuracy);
    static int getRandom(int lowerBound, int upperBound);
    static Cell *FindPriorityTarget(const std::vector<std::unique_ptr<AUnit>>& targetTeam, const std::function<int(const AUnit&, int)>&, int myTeam);
    static ssize_t calcDistance(const Cell *target, const Cell*source);

    private:
        static std::mt19937 gen;
        Utility() = delete;
        ~Utility() = delete;
};

