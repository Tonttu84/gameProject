// weapons_config.hpp
// Auto-generated constexpr melee‐weapon definitions.
// StrDivider: 3 = one-handed; 2 = two-handed or full-body effort
// ShieldBonus: 4 = has shield; 0 = no shield

#pragma once
#include "Weapon.hpp"

//std::string_view setType,  int setDefence, int setDamage, int setAttack, int setStrDiv, int shieldValue

namespace MeleeWeapons
{
    // Standard Arms
    constexpr Weapon Shortsword{     "Shortsword",        2,  4,  1,  3, 0};
    constexpr Weapon Dagger{         "Dagger",            1,  4,  2,  3, 0};
    constexpr Weapon MaceAndShield{  "Mace and shield",   1,  6,  2,  3, 4};
    constexpr Weapon SwordAndShield{ "Sword and shield",  2,  5,  2,  3, 4};
    constexpr Weapon Halberd{        "Halberd",           1,  8,  2,  2, 0};
    constexpr Weapon Greataxe{       "Greataxe",          0, 11,  3,  2, 0};
    constexpr Weapon Greatsword{     "Greatsword",        0, 10,  3,  2, 0};
    constexpr Weapon Spear{          "Spear",             1,  7,  2,  2, 0};
    constexpr Weapon Warhammer{      "Warhammer",         2,  9,  3,  2, 0};
    constexpr Weapon Staff{          "Staff",             2,  3,  1,  2, 0};
    constexpr Weapon UnarmedBrawl{   "Unarmed (Brawl)",   0,  2,  1,  3, 0};

    // Mythical & Natural Weapons
    constexpr Weapon Claws{          "Claws",             -1,  3,  2,  3, 0};
    constexpr Weapon Bite{           "Bite",              2,  5,  0,  3, 0};
    constexpr Weapon TailSlam{       "Tail slam",         1,  4,  1,  3, 0};
    constexpr Weapon Trample{        "Trample",           2,  6,  0,  3, 0};
    constexpr Weapon PythonSqueeze{  "Python squeeze",    2,  4,  0,  2, 0};

    // Dragons
    constexpr Weapon DragonClaw{     "Dragon claw",       2,  7,  1,  3, 0};
    constexpr Weapon DragonBite{     "Dragon bite",       3,  8,  1,  3, 0};
    constexpr Weapon DragonTail{     "Dragon tail",       1,  5,  1,  3, 0};

    // Giants & Titans
    constexpr Weapon GiantClub{      "Giant club",        3,  9,  2,  2, 0};
    constexpr Weapon TitanFist{      "Titan fist",        4, 10,  1,  2, 0};

    // Others
    constexpr Weapon KrakenTentacle{ "Kraken tentacle",   1,  6,  0,  3, 0};
    constexpr Weapon MinotaurHorns{  "Minotaur horns",    2,  6,  1,  3, 0};
    constexpr Weapon BasiliskClaw{   "Basilisk claw",     1,  5,  1,  3, 0};
}
