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
constexpr int FATIGUERECOVERY     = 4;   // default per-unit passive recovery every tick
constexpr int SWAPFATIGUE         = 60;  // engaged units retreat to rest above this
constexpr int FATIGUE_MAX         = 100; // exhausted above this — must rest before acting
constexpr int FATIGUE_LEVEL_DIV   = 20;  // fatigue / this = fatigue tier (0-5)

// Combat
constexpr int SHIELDREDUCTION        = 5;
constexpr int UNDEFENDED_SIDE_BONUS  = 3;  // attack bonus when no enemy unit defends the engaged side

// Archery
constexpr int BOWDAMAGE   = 5;
constexpr int BOWMAXRANGE = 8;   // max hex distance an archer can shoot
constexpr int BOWAMMO     = 30;

// Fireball
constexpr int FIREBALL_CENTRE    = 10; // damage to the primary hit
constexpr int FIREBALL_BLAST     = 5;  // damage per secondary hit
constexpr int FIREBALL_SECONDARY = 5;  // number of secondary blast hits
constexpr int SPELLRANGE         = 10; // max hex distance for spells

// Battlefield dimensions
constexpr int BATTLEFIELD_WIDTH  = 30;  // visual width  — hex rows (r), depth between armies
constexpr int BATTLEFIELD_HEIGHT = 16;  // visual height — hex columns (q), battle-line width

// Movement / formation
constexpr int CROWDED_THRESHOLD = 400; // sizeUsed at which a hex is "crowded" (~40 humans)

// Projectile deviation
constexpr int MAX_DEVIATION = 40; // maximum hexes a projectile can drift off-target

class Battlefield;
class HexGrid;
class AUnit;