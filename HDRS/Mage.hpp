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

#include "AUnit.hpp"
#include "vector"
#include "Utility.hpp"
#include "Human.hpp"

class Mage : public Human
{
    public:
        Mage(int setTeam) noexcept;
        Mage() noexcept;
        ~Mage() noexcept = default ;
        int mana = 99;
        bool spellcaster = true;

        void special();
        void castFireball();
        Cell *findTarget(Cell &source);
};

