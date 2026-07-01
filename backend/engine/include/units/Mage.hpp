/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Mage.hpp                                         :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@student.hive.fi>        +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/19 15:03:43 by jrimpila          #+#    #+#             */
/*   Updated: 2025/08/20 11:26:47 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#pragma once

#include "Human.hpp"
#include "Defines.hpp"
#include "RangedCombat.hpp"
#include "Utility.hpp"
#include "Battlefield.hpp"

class Mage : public Human
{
    public:
        static constexpr int SIZE = 10;

        Mage(int setTeam) noexcept;
        Mage() noexcept;
        ~Mage() noexcept = default;
        int mana = 99;

        void special() override;
        AUnit* findFireballTarget();
};

