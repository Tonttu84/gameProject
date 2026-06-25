/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Defines.hpp                                        :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@hive.fi>                +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/09/19 13:54:25 by jrimpila          #+#    #+#             */
/*   Updated: 2025/10/04 17:30:36 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#pragma once

// Teams
constexpr int REDTEAM  = 1;
constexpr int BLUETEAM = 2;

// Armour values
constexpr int LIGHTARMOUR = 2;
constexpr int HEAVYARMOUR = 5;

// Fatigue
constexpr int FATIGUERECOVERY = 4;   // default per-unit passive recovery every tick
constexpr int SWAPFATIGUE     = 60;  // engaged units retreat to rest above this

// Combat
constexpr int SHIELDREDUCTION = 5;

// Archery
constexpr int BOWDAMAGE        = 5;
constexpr int BOWMAXRANGE      = 8;   // max hex distance an archer can shoot
constexpr int BOWAMMO          = 30;
constexpr int BOWACCURATERANGE = 2;   // within this range archers can attempt an aimed individual shot

// Battlefield dimensions
constexpr int BATTLEFIELD_WIDTH  = 30;  // hex columns (q)
constexpr int BATTLEFIELD_HEIGHT = 16;  // hex rows (r)

class Battlefield;
class HexGrid;
class AUnit;