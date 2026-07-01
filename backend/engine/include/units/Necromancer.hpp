/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Necromancer.hpp                                         :+:      :+:    :+:   */
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
#include "Zombie.hpp"
#include "Skeleton.hpp"



class Necromancer : public Human
{
    public:
        static constexpr int SIZE = 10;

        Necromancer(int setTeam) noexcept;
        Necromancer() noexcept;
        ~Necromancer() noexcept = default ;
        int mana = 99;

        void special() override;
        void raiseDead();
        bool placeZombie(Hex* targetHex);
        bool placeSkeleton(Hex* targetHex);

};

