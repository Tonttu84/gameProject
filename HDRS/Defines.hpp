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

// Armor penetration modes.
//   Normal  – armor subtracts normally; shields reduce damage by SHIELDREDUCTION.
//   Piercing – armor is halved; shields still apply.
//   Bypass  – armor is ignored AND SHIELDREDUCTION is skipped; only extra shields
//             (force fields) can deflect, and they do so completely.
enum class ArmorPen { Normal, Piercing, Bypass };

// A weapon's special effect(s), dispatched by WeaponEffects.hpp/.cpp. Kept as
// a plain flags tag on Weapon (not a std::function) so weapon definitions
// stay constexpr; the actual effect logic lives in one shared, recyclable
// place rather than being duplicated per weapon. A weapon can combine more
// than one via operator| (e.g. Lifedrain | MagicalChip on the same blade) —
// check membership with hasWeaponEffect(), not ==.
//   None        – no special effect.
//   Lifedrain   – attacker heals for the damage their attack dealt.
//   MagicalChip – every attack attempt also lands a guaranteed 1 point of
//                 Bypass (armour-negating) damage, independent of whether the
//                 weapon's own swing connects.
enum class WeaponEffect : unsigned { None = 0, Lifedrain = 1u << 0, MagicalChip = 1u << 1 };

constexpr WeaponEffect operator|(WeaponEffect a, WeaponEffect b) {
    return static_cast<WeaponEffect>(static_cast<unsigned>(a) | static_cast<unsigned>(b));
}
constexpr bool hasWeaponEffect(WeaponEffect set, WeaponEffect flag) {
    return (static_cast<unsigned>(set) & static_cast<unsigned>(flag)) != 0;
}

// Armour values
constexpr int LIGHTARMOUR = 2;
constexpr int HEAVYARMOUR = 5;

// Fatigue
constexpr int FATIGUERECOVERY     = 4;   // default per-unit passive recovery every tick
constexpr int FATIGUE_TIRED       = 30;  // border assignment: fresh → tired
constexpr int FATIGUE_VERY_TIRED  = 60;  // border assignment: tired → very tired (desperate pool)
                                          // also the threshold above which engaged units hold position
constexpr int FATIGUE_MAX         = 100; // exhausted — must rest before acting
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
// A hex retains effectiveFrontage(side)*this many fresh (non-tired) size-points
// per currently engaged HexSide before it's willing to spread its excess to a
// less-crowded engaged neighbor — see shouldSpreadToward() in Battlefield.cpp.
// One engaged open-terrain side retains 40*4=160 (16 humans); two retain 320 (32).
constexpr int ENGAGED_SIDE_RETENTION_MULTIPLIER = 4;

// Terrain movement costs (total ticks to enter; 1 = one tick = no debt)
constexpr int TERRAIN_COST_OPEN       = 1;
constexpr int TERRAIN_COST_FOREST     = 2;  // Mounted: impassable
constexpr int TERRAIN_COST_MARSH      = 3;  // Mounted: impassable; Beast/Skirmisher: 2
constexpr int TERRAIN_COST_RUBBLE     = 2;
constexpr int TERRAIN_COST_SLOPE      = 1;  // added when climbing 1 elevation tier

// Terrain combat modifiers (d6 system — each +1 is significant)
constexpr int ELEV_MELEE_BONUS        = 1;  // per tier height advantage in melee (capped at ±1)
constexpr int ELEV_RANGED_BONUS       = 1;  // per tier: to-hit and damage bonus shooting downward
constexpr int ELEV_RANGED_CAP         = 2;  // max tiers counted for ranged modifiers
constexpr int FORTIFIED_ATK_PENALTY   = 1;  // attacker crossing a fortified side
constexpr int FORTIFIED_DEF_BONUS     = 1;  // defender behind a fortified side
constexpr int RUBBLE_DEF_BONUS        = 1;  // melee defender in Rubble hex
constexpr int FOREST_RANGED_PENALTY   = 1;  // accuracy penalty (×10%) per forest hex in path
constexpr int FOREST_COVER_DEF_BONUS  = 1;  // free shield roll value for defender in forest
constexpr int CRAMPED_COMBAT_PENALTY       = 1;  // atk and def penalty when unit size > half effective frontage
constexpr int MULTI_ATTACK_DEFENCE_PENALTY = 1;  // defence malus per previous attack received this turn

// Cavalry / mounted units
constexpr int CAVALRY_FOREST_TARGET_PENALTY = 3;  // findTarget() distance penalty for Mounted searchers
                                                   // considering a forest-sheltered enemy
constexpr int RANGED_RIDER_BIAS             = 2;  // mount/rider hit-roll boundary shift favoring the rider
                                                   // on ranged attacks (arrows arc down from above)

// Projectile deviation
constexpr int MAX_DEVIATION = 40; // maximum hexes a projectile can drift off-target

class Battlefield;
class HexGrid;
class AUnit;