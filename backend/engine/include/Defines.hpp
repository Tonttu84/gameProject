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

// ─── Unit abilities ──────────────────────────────────────────────────────────
// The THIRD axis of the unit model (docs/CAMPAIGN_PLAN.md, slice 6 decision
// 6-1): a unit is STATS + ANATOMY + ABILITIES. Anything that differs from a
// human and is not a stat and not a body part is an ability — new behaviour
// joins this vocabulary or it does not go in.
//
// Flags, not a kind, and modelled on WeaponEffect above for the same reasons:
// a creature lists EVERY ability that applies, and membership is checked with
// hasAbility(), never ==. That composability is the point — a banner grants
// bare Fearless without also making your men mindless corpses.
//
//   Fearless – never breaks: AUnit::testMorale passes without rolling.
//   Mindless – no mind to break. Implies Fearless (see abilityClosure).
//              DELIBERATELY BARE (6-5): its real cost — mindless troops needing
//              a commander able to lead them — is designed but NOT built. Do
//              not stub it here.
//   Undead   – the thematic tag. Implies NoCorpse. Carries no behaviour of its
//              own yet; the morale immunity that used to hang off `bool undead`
//              belongs to Mindless, so a later lich or vampire can be Undead and
//              still be rattled.
//   NoCorpse – leaves nothing for the necromancer's corpse pool (Team.cpp).
//              Separable from Undead on purpose, for the small summons that
//              vanish without being undead at all.
enum class UnitAbility : unsigned {
    None     = 0,
    Fearless = 1u << 0,
    Mindless = 1u << 1,
    Undead   = 1u << 2,
    NoCorpse = 1u << 3,
};

constexpr UnitAbility operator|(UnitAbility a, UnitAbility b) {
    return static_cast<UnitAbility>(static_cast<unsigned>(a) | static_cast<unsigned>(b));
}
constexpr UnitAbility& operator|=(UnitAbility& a, UnitAbility b) { a = a | b; return a; }
constexpr bool hasAbilityFlag(UnitAbility set, UnitAbility flag) {
    return (static_cast<unsigned>(set) & static_cast<unsigned>(flag)) != 0;
}
// Set subtraction, for the SUPPRESSION half of the ability system (slice 9a,
// decision 9-4): gear may take an ability away as well as give one. Written as
// a named function rather than operators& and ~ because subtraction is the only
// thing any caller wants — and `~` on a 4-bit enum in an `unsigned` would set
// 28 bits nothing has a meaning for.
constexpr UnitAbility withoutAbilities(UnitAbility set, UnitAbility denied) {
    return static_cast<UnitAbility>(static_cast<unsigned>(set) & ~static_cast<unsigned>(denied));
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

// Fatigue past the ordinary ceiling runs into blood (M-2, docs/CAMPAIGN_PLAN.md).
// Universal — ordinary troops never reach it by marching and fighting, but a
// spell can put anyone there. At the hard ceiling a body sits at fatiguelvl 10,
// i.e. -20 defence: an overcast mage is not asleep, he is a free kill.
constexpr int FATIGUE_HARD_MAX    = FATIGUE_MAX * 2; // clamps here, never above
constexpr int FATIGUE_PER_WOUND   = 4;   // 4 fatigue past FATIGUE_MAX -> 1 damage,
                                          // the remainder rolled (1 over = 25% of a wound)

// Concentration (M-23): a struck caster throws to hold the channel together,
// mirroring testMorale's opposed roll with the PRIMARY path level as the stat.
// Balance-deferred like every other number in the magic system.
constexpr int CONCENTRATION_PER_LEVEL = 2;

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

// Spell numbers (M-18). ALL BALANCE-DEFERRED — chosen to be sane relative to
// one another, not tuned. Each is the BASE; M-20 adds the caster's primary
// path level on top, so a spell grows with the man casting it.
constexpr int EMBER_DAMAGE       = 4;  // fireball's minor form — one bolt, no blast
constexpr int SHOCK_DAMAGE       = 3;  // Air: less than fire, but it lands
constexpr int SHOCK_ACCURACY     = 80; // ...because lightning goes where it is aimed
constexpr int SOOTHING_RELIEF    = 20; // Water: fatigue washed off, not wounds healed
constexpr int WARD_STRENGTH      = 2;  // High: a barrier, per M-4's "wards, dispelling"
constexpr int SNARE_FATIGUE      = 15; // Nature: exhaustion inflicted, which M-2 makes lethal
constexpr int DRAIN_DAMAGE       = 4;  // Unholy: half of what lands returns as healing
constexpr int LOW_BLOOD_PRICE    = 3;  // M-21/M-24: what Low's second effect takes
constexpr int GREATER_BLESS_BASE = 2;  // Holy major: how many men one blessing reaches
constexpr int RAISE_DEAD_BODIES  = 3;  // Death major: corpses spent, and zombies raised

// Battlefield dimensions
constexpr int BATTLEFIELD_WIDTH  = 30;  // visual width  — hex rows (r), depth between armies
constexpr int BATTLEFIELD_HEIGHT = 16;  // visual height — hex columns (q), battle-line width

// Battle length: after this many turns the day is over and the battle is
// scored as it stands (both sides alive = draw). Default for every battle
// loop; BattleInput can override per battle via "max_turns" (clamped to
// [1, MAX_BATTLE_TICKS_CAP] at the trust boundary).
constexpr int DEFAULT_MAX_BATTLE_TICKS = 400;
constexpr int MAX_BATTLE_TICKS_CAP     = 5000;

// Terrain movement costs, in movement points spent to enter a hex. Each tick
// a unit banks movementSpeed points (never above that base) and steps while
// its bank is positive, going into debt on the step that empties it — debt
// then recovers at movementSpeed per tick. A normal human banks 10/tick, so
// open ground (12) means one hex most ticks with every 6th tick skipped.
constexpr int TERRAIN_COST_OPEN        = 12;
constexpr int TERRAIN_COST_FOREST      = 24;  // Mounted: impassable
constexpr int TERRAIN_COST_MARSH       = 36;  // Mounted: impassable
constexpr int TERRAIN_COST_MARSH_LOOSE = 24;  // Marsh for Beast/Skirmisher (surer footing)
constexpr int TERRAIN_COST_RUBBLE      = 24;
constexpr int TERRAIN_COST_SLOPE       = 12;  // added when climbing 1 elevation tier

// Terrain combat modifiers (d6 system — each +1 is significant)
constexpr int ELEV_MELEE_BONUS        = 1;  // per tier height advantage in melee (capped at ±1)
constexpr int ELEV_RANGED_BONUS       = 1;  // per tier: to-hit and damage bonus shooting downward
constexpr int ELEV_RANGED_CAP         = 2;  // max tiers counted for ranged modifiers
constexpr int FORTIFIED_ATK_PENALTY   = 1;  // attacker crossing a fortified side
constexpr int FORTIFIED_DEF_BONUS     = 1;  // defender behind a fortified side
constexpr int DEFAULT_FORT_DURABILITY = 100; // fortified-side durability when battle input omits it
                                             // (placeholder — nothing consumes it yet, Stage 3)
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