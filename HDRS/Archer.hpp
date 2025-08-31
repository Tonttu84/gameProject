/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Archer.hpp                                         :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@student.hive.fi>        +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/19 15:03:43 by jrimpila          #+#    #+#             */
/*   Updated: 2025/08/31 10:12:18 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#pragma once

#include "AUnit.hpp"
#include "vector"
#include "Utility.hpp"
#include "Human.hpp"

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