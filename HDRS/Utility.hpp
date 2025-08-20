/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Utility.hpp                                        :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@student.hive.fi>        +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/17 12:57:50 by jrimpila          #+#    #+#             */
/*   Updated: 2025/08/20 11:07:02 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#pragma once
#include <vector>
#include <memory>
#include <AUnit.hpp>
#include <random>
#include "Battlefield.hpp"
#include <iostream>

class Utility
{
public:
        static int throwDice();

        static AUnit* findTarget(const std::vector<std::unique_ptr<AUnit>>& targets, bool (*primary_condition)(const AUnit&), bool (*secondary_condition)(const AUnit&));
        static Battlefield &getBattlefield();

    private:
        Utility() = delete;
};

