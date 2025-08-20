/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Priest.hpp                                         :+:      :+:    :+:   */
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

class Priest : public AUnit
{
    public:
        Priest(int setTeam) noexcept;
        Priest() noexcept;
        ~Priest() noexcept = default ;
        int mana = 99;
        bool spellcaster = true;

        void special();
        void castBless();
};