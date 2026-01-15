/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Archer.hpp                                         :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@hive.fi>                +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/19 15:03:43 by jrimpila          #+#    #+#             */
/*   Updated: 2025/10/06 10:56:47 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#pragma once

#include "AUnit.hpp"
#include "Utility.hpp"
#include "Human.hpp"

class AUnit;
#include "Defines.hpp"
#include "Human.hpp"
#include "Cell.hpp"
#include "Battlefield.hpp"

#define BOWDAMAGE 5
#define BOWMAXRANGE 50
#define BOWAMMO 30

class Archer : public Human
{
    public:
        Archer(int setTeam) noexcept;
        Archer() noexcept;
        ~Archer() noexcept = default ;

        void special();
        int fireBow();
        Cell *findArcherTarget();
        int calcCellValue(const Cell &targetCell, int myTeam);
        int calcShot(const AUnit& target, int myTeam);
        bool accurateShot(const AUnit &target, int myTeam);

};