/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Priest.hpp                                         :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@student.hive.fi>        +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/19 15:03:43 by jrimpila          #+#    #+#             */
/*   Updated: 2025/08/28 17:05:27 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#pragma once

#include "AUnit.hpp"
#include "vector"
#include "Utility.hpp"
#include "Human.hpp"

class Priest : public Human
{
    public:
        Priest(int setTeam) noexcept;
        Priest() noexcept;
        ~Priest() noexcept = default ;
        int mana = 99;

        void special();
        void castBless();
};