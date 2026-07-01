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
#include "Defines.hpp"
#include "Battlefield.hpp"
#include "RangedCombat.hpp"

class Archer : public Human
{
    public:
        static constexpr int SIZE = 10;

        Archer(int setTeam) noexcept;
        Archer() noexcept;
        ~Archer() noexcept = default ;

        void special() override;
        int fireBow();
        AUnit* findArcherTarget();
        int calcUnitValue(const AUnit& target, int myTeam);
        int calcShot(const AUnit& target, int myTeam);
        bool accurateShot(const AUnit &target, int myTeam);
        void restoreForNextBattle() override;

};