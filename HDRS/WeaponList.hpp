// weapons_config.hpp
// Auto-generated constexpr melee‐weapon definitions.
// StrDivider: 3 = one-handed; 2 = two-handed or full-body effort
// ShieldBonus: 4 = has shield; 0 = no shield
//
// Reach scale: 0 natural, 1 short/one-handed, 2 two-handed, 3 spears,
// 4 pikes, 5 special/magical (cap). Giant/large-unit version of any weapon
// (including natural) gets a flat +1, capped at 5 overall.

#pragma once
#include "Weapon.hpp"

//std::string_view setType,  int setDefence, int setDamage, int setAttack, int setStrDiv, int shieldValue, int reach

namespace MeleeWeapons
{
    // Standard Arms
    constexpr Weapon Shortsword{     "Shortsword",        2,  4,  1,  3, 0, 1};
    constexpr Weapon Dagger{         "Dagger",            1,  4,  2,  3, 0, 1};
    constexpr Weapon MaceAndShield{  "Mace and shield",   1,  6,  2,  3, 4, 1};
    constexpr Weapon SwordAndShield{ "Sword and shield",  2,  5,  2,  3, 4, 1};
    constexpr Weapon Halberd{        "Halberd",           1,  8,  2,  2, 0, 2};
    constexpr Weapon Greataxe{       "Greataxe",          0, 11,  3,  2, 0, 2};
    constexpr Weapon Greatsword{     "Greatsword",        0, 10,  3,  2, 0, 2};
    constexpr Weapon Spear{          "Spear",             1,  7,  2,  2, 0, 3};
    constexpr Weapon Warhammer{      "Warhammer",         2,  9,  3,  2, 0, 2};
    constexpr Weapon Staff{          "Staff",             2,  3,  1,  2, 0, 2};
    constexpr Weapon UnarmedBrawl{   "Unarmed (Brawl)",   0,  2,  1,  3, 0, 0};

    // Mythical & Natural Weapons
    constexpr Weapon Claws{          "Claws",             -1,  3,  2,  3, 0, 0};
    constexpr Weapon Bite{           "Bite",              2,  5,  0,  3, 0, 0};
    constexpr Weapon TailSlam{       "Tail slam",         1,  4,  1,  3, 0, 0};
    constexpr Weapon Trample{        "Trample",           2,  6,  0,  3, 0, 0};
    constexpr Weapon PythonSqueeze{  "Python squeeze",    2,  4,  0,  2, 0, 0};
    constexpr Weapon Hoof{           "Hoof",              1,  4,  1,  3, 0, 0};
    constexpr Weapon Stinger{        "Stinger",           1,  5,  1,  3, 0, 3}; // scorpion tail — long reach

    // Dragons — natural weapons, giant-scaled (0 + giant modifier 1)
    constexpr Weapon DragonClaw{     "Dragon claw",       2,  7,  1,  3, 0, 1};
    constexpr Weapon DragonBite{     "Dragon bite",       3,  8,  1,  3, 0, 1};
    constexpr Weapon DragonTail{     "Dragon tail",       1,  5,  1,  3, 0, 1};

    // Giants & Titans — giant-scaled (base category + giant modifier 1)
    constexpr Weapon GiantClub{      "Giant club",        3,  9,  2,  2, 0, 3}; // two-handed(2) + giant(1)
    constexpr Weapon TitanFist{      "Titan fist",        4, 10,  1,  2, 0, 1}; // natural(0) + giant(1)

    // Others
    constexpr Weapon KrakenTentacle{ "Kraken tentacle",   1,  6,  0,  3, 0, 1}; // natural(0) + giant(1) — colossal
    constexpr Weapon MinotaurHorns{  "Minotaur horns",    2,  6,  1,  3, 0, 0}; // large, not giant-scale
    constexpr Weapon BasiliskClaw{   "Basilisk claw",     1,  5,  1,  3, 0, 0}; // large, not giant-scale

    // Special / Magical — reach 5 cap example: a hovering construct that
    // crashes into foes from beyond normal melee range.
    constexpr Weapon MagicalStoneBird{ "Magical stone bird", 1,  6,  1,  2, 0, 5};

    // Effect weapons — see Defines.hpp (WeaponEffect) and WeaponEffects.hpp/.cpp
    // for what these actually do; the weapon definition only carries the tag.
    constexpr Weapon Lifedrinker{   "Lifedrinker",       1,  4,  1,  3, 0, 1,
                                     ArmorPen::Normal, WeaponEffect::Lifedrain};
    constexpr Weapon SpectralBlade{ "Spectral Blade",    0,  2,  1,  3, 0, 1,
                                     ArmorPen::Normal, WeaponEffect::MagicalChip};
}
