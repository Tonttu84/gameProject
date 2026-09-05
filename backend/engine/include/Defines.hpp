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

// Area of effect (T-6/T-7, slice TG-2). An area is measured in HEX SIZE POINTS
// — the same 640-slot currency a hex's bodies stand in — and covered as one
// contiguous arc per hex, so a blast strikes the men who happen to stand where
// it falls rather than sampling the hex until it has found everybody.
constexpr int AREA_CHUNK = 10;  // (bd) the RANDOM mode's grain: one man's worth of
                                 // ground per drawn hex, so a scattered area lands in
                                 // recognisable patches instead of one point per hex

// Fireball
constexpr int FIREBALL_CENTRE    = 10; // damage to the man it lands on
constexpr int FIREBALL_BLAST     = 5;  // damage to every OTHER body the area covers
                                        // (T-7: friend and foe alike)
constexpr int FIREBALL_AREA      = 100; // (bd) ten men's worth of ground: on a hex of
                                        // twenty humans a 100-point arc strikes three
                                        // or four, close to the old splash's expectation

// T-2: the DEFAULT per-form range. Every SpellForm carries its own `range` and
// this is what a row gets when it does not say otherwise — boons included, now
// that a Ward across the map is no longer a thing (see SPELL TARGETING AND
// DELIVERY in docs/CAMPAIGN_PLAN.md). Balance-deferred.
constexpr int SPELLRANGE         = 10; // the DEFAULT per-form range (T-2)
// T-1: a form whose `accuracy` is written as this is PRECISE — it strikes the
// target the resolver picked, with no roll, no scatter and no elevation or
// forest adjustment. Not a balance number: it is the top of the 0..100 accuracy
// scale, and "as accurate as a thing can be" is what the rule means by it.
constexpr int SPELL_PRECISE      = 100;

// Spell numbers (M-18). ALL BALANCE-DEFERRED — chosen to be sane relative to
// one another, not tuned. Each is the BASE; M-20 adds the caster's primary
// path level on top, so a spell grows with the man casting it.
constexpr int EMBER_DAMAGE       = 4;  // fireball's minor form — one bolt, no blast
constexpr int SHOCK_DAMAGE       = 3;  // Air: less than fire, but it lands — the row is
                                       // PRECISE (T-1), which is where "it lands" now lives
constexpr int SOOTHING_RELIEF    = 20; // Water: fatigue washed off, not wounds healed
constexpr int WARD_STRENGTH      = 2;  // High: a barrier, per M-4's "wards, dispelling"
constexpr int SNARE_FATIGUE      = 15; // Nature: exhaustion inflicted, which M-2 makes lethal
constexpr int DRAIN_DAMAGE       = 4;  // Unholy: half of what lands returns as healing
constexpr int LOW_BLOOD_PRICE    = 3;  // M-21/M-24: what Low's second effect takes
constexpr int GREATER_BLESS_BASE = 2;  // Holy major: how many men one blessing reaches
constexpr int RAISE_DEAD_BODIES  = 3;  // Death major: corpses spent, and zombies raised

// Battlefield-wide enchantments (E-6). A sustained spell is a DIFFERENT kind of price
// from the ones above: the per-tick number is tiny because it is paid every tick
// of the battle, while the fatigue and the channels are paid once, up front, by
// a side that only gets to call the spell once. ALSO BALANCE-DEFERRED — the
// per-tick figures are the ones most likely to move, since their real cost is
// whatever the battle's length multiplies them by.
constexpr int SOOTHING_WINDS_FATIGUE   = 20; // Nature 2: what calling the wind costs its caster
constexpr int SOOTHING_WINDS_POOL_COST = 2;  // channels drawn IN FULL on completion
constexpr int SOOTHING_WINDS_RELIEF    = 1;  // fatigue washed off every friendly body, per tick
constexpr int LEADEN_AIR_FATIGUE       = 24; // Death 2: what calling the weight costs its caster
constexpr int LEADEN_AIR_POOL_COST     = 3;  // channels drawn IN FULL on completion
constexpr int LEADEN_AIR_WEIGHT        = 2;  // fatigue pressed onto every LIVING body, per tick

// The casting AI (docs/CAMPAIGN_PLAN.md "THE CASTING AI", A-1..A-7). ALL
// BALANCE-DEFERRED — and, per A-4, the FIRST knobs the balance pass should reach
// for, since every one of them moves what a caster reaches for.
//
// score = worth * AI_SCORE_SCALE / spellDivider(form)     (A-4)
// divider = castingTime * (AI_DIVIDER_BASE + (fatigue + poolCost * AI_POOL_COST_WEIGHT)
//                                            / AI_FATIGUE_PER_DIVIDER)
constexpr int AI_SCORE_SCALE         = 100;
constexpr int AI_DIVIDER_BASE        = 10;   // a free instant spell would divide by this
constexpr int AI_FATIGUE_PER_DIVIDER = 4;    // one divider point per this much authored fatigue
constexpr int AI_POOL_COST_WEIGHT    = 8;    // a channel counts as this much fatigue in the divider
constexpr int AI_SCRIPT_FLOOR        = 10;   // A-6: a scripted line scoring below this is skipped
constexpr int AI_LOTTERY_FLOOR       = 10;   // A-7: an option below this gets no ticket
// Worth is measured in UNIT-VALUE units (A-3): damage converts at AI_DAMAGE_SCALE
// points per value point, inflicted/relieved fatigue at AI_FATIGUE_PER_DAMAGE
// per damage point; a standing effect is a share of its bearer.
constexpr int AI_DAMAGE_SCALE        = 4;
constexpr int AI_FATIGUE_PER_DAMAGE  = 5;
constexpr int AI_BUFF_WORTH_PCT      = 50;   // stoneskin / ward on a fresh body
constexpr int AI_DEBUFF_WORTH_PCT    = 40;   // hex of frailty
constexpr int AI_RALLY_WORTH_PCT     = 80;   // un-breaking a man is worth most of him
constexpr int AI_HEAL_AVG            = 4;    // bless heals 1 + d6 (exploding): call it four
constexpr int AI_GLOBAL_WORTH        = 40;   // a battlefield enchantment's flat worth (script-only, E-3)
constexpr int AI_SKELETON_WORTH      = 4;    // mirrors Skeleton::unitValue
constexpr int AI_ZOMBIE_WORTH        = 5;    // mirrors Zombie::unitValue
constexpr int AI_LOG_TOP             = 3;    // options named in the Detail-tier "weighs" line
constexpr int AI_VALUE_CAP           = 1000; // the wire's `value` is clamped to [1, this]

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