/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Soldier.hpp                                         :+:      :+:    :+:   */
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


class Soldier : public Human
{
    public:
        Soldier(int setTeam) noexcept;
        ~Soldier() noexcept = default ;

        void special();

};