#include "SpellList.hpp"
#include "AUnit.hpp"
#include "Battlefield.hpp"
#include "BattleSetup.hpp"
#include "RangedCombat.hpp"
#include "UnitCatalog.hpp"
#include "Utility.hpp"
#include "units/Zombie.hpp"
#include "units/Skeleton.hpp"
#include "extern/json.hpp"
#include <algorithm>
#include <string>

using json = nlohmann::json;

// The spell roster. Common gating — alive/broken checks, the channel, paying
// fatigue on completion — lives in AUnit::castSpells(); each body below only
// targets and applies.
//
// Every rule cited by number is in "THE MAGIC SYSTEM" in docs/CAMPAIGN_PLAN.md.
// Two of them shape every body here:
//   M-20  A spell is cast with its PRIMARY path (requirement entry 0) and its
//         effect scales on THAT level, never on a secondary. Each body reads
//         its own path directly, because a body always knows what it is.
//   M-18  One minor spell per path, all ten, because paths are rolled at hire:
//         a path with no castable level-1 spell makes that roll a dud and the
//         player hires a Water 2 mage who can do nothing. Coverage here is
//         CORRECTNESS, not polish.
//
// ALL NUMBERS BELOW ARE BALANCE-DEFERRED per the standing pass. They are chosen
// to be sane relative to each other, not tuned.

// ── shared targeting ─────────────────────────────────────────────────────────

// Find the highest-value enemy within spell range, preferring dense hexes.
// Shared by every offensive spell — the pattern was fireball's, and nothing
// about it was fireball-specific.
static AUnit* findEnemyInRange(AUnit& caster)
{
    int myTeam = caster.getTeam();
    auto inRange = [&caster](const AUnit& target, int t) -> bool {
        if (!target.getAlive() || target.getTeam() == t || !target.getHex()) return false;
        int dist   = Utility::calcDistance(target.getHex(), caster.getHex());
        int tiers  = std::clamp(caster.getHex()->elevation - target.getHex()->elevation,
                                -ELEV_RANGED_CAP, ELEV_RANGED_CAP);
        return dist - tiers <= SPELLRANGE;
    };
    auto scoreTarget = [&caster](const AUnit& target, int t) -> int {
        if (!target.getAlive() || target.getTeam() == t || !target.getHex()) return -1;
        int dist  = Utility::calcDistance(target.getHex(), caster.getHex());
        int tiers = std::clamp(caster.getHex()->elevation - target.getHex()->elevation,
                               -ELEV_RANGED_CAP, ELEV_RANGED_CAP);
        if (dist - tiers > SPELLRANGE) return -1;
        // Prefer densely packed hexes at closer range.
        return target.getHex()->sizeUsed * 10 / (dist + 1);
    };
    return Utility::findTarget(
        Utility::getBattlefield().getTeam(3 - myTeam),
        inRange, scoreTarget, myTeam);
}

// Any living ally other than the caster — what a sacrifice needs (M-24).
static AUnit* findAllyButSelf(AUnit& caster)
{
    Battlefield& field = Utility::getBattlefield();
    for (auto& u : field.getTeam(caster.getTeam()))
        if (u && u.get() != &caster && u->getAlive() && u->getHex())
            return u.get();
    return nullptr;
}

// Any living ally including the caster — the usual target of a boon.
static AUnit* findAllyToAid(AUnit& caster)
{
    Battlefield& field = Utility::getBattlefield();
    AUnit* fallback = nullptr;
    for (auto& u : field.getTeam(caster.getTeam())) {
        if (!u || !u->getAlive() || !u->getHex()) continue;
        if (u->getHp() < u->getmaxHP()) return u.get();   // prefer someone who needs it
        if (!fallback) fallback = u.get();
    }
    return fallback;
}

// ── Fire — fireball (Evocation) ──────────────────────────────────────────────

// The minor form: a single bolt, no blast. What keeps a Fire 1 caster useful,
// exactly as Dominions' early-generation spells do (M-12).
static bool castEmber(AUnit& caster)
{
    if (!caster.getHex()) return false;
    AUnit* aimUnit = findEnemyInRange(caster);
    if (!aimUnit || !aimUnit->getHex()) return false;

    RangedShot shot;
    shot.baseDamage = EMBER_DAMAGE + caster.getPathLevel(SpellPath::Fire);
    shot.accuracy   = caster.getAccuracy();
    shot.pen        = ArmorPen::Normal;

    RangedCombat::fire(&caster, aimUnit, shot);
    return true;
}

static bool castFireball(AUnit& caster)
{
    if (!caster.getHex()) return false;
    AUnit* aimUnit = findEnemyInRange(caster);
    if (!aimUnit || !aimUnit->getHex()) return false;

    RangedShot shot;
    // M-20: the blast grows with the caster's FIRE level and nothing else.
    shot.baseDamage      = FIREBALL_CENTRE + caster.getPathLevel(SpellPath::Fire);
    shot.accuracy        = caster.getAccuracy();
    shot.pen             = ArmorPen::Normal;
    // Secondary blast hits: shrapnel from the detonation, landing on the same
    // hex as the primary shot regardless of whether the primary found a target.
    shot.secondaryHits   = FIREBALL_SECONDARY;
    shot.secondaryDamage = FIREBALL_BLAST;

    RangedCombat::fire(&caster, aimUnit, shot);
    return true;
}

// ── Air — shock (Evocation) ──────────────────────────────────────────────────
// Less damage than fire, but it goes where it is aimed.
static bool castShock(AUnit& caster)
{
    if (!caster.getHex()) return false;
    AUnit* aimUnit = findEnemyInRange(caster);
    if (!aimUnit || !aimUnit->getHex()) return false;

    RangedShot shot;
    shot.baseDamage = SHOCK_DAMAGE + caster.getPathLevel(SpellPath::Air);
    shot.accuracy   = SHOCK_ACCURACY;
    shot.pen        = ArmorPen::Piercing;   // lightning cares little for plate

    RangedCombat::fire(&caster, aimUnit, shot);
    return true;
}

// ── Earth — stoneskin (Enchantment) ──────────────────────────────────────────
static bool castStoneskin(AUnit& caster)
{
    AUnit* target = findAllyToAid(caster);
    if (!target) return false;
    target->applyStatMod("armour", 1 + caster.getPathLevel(SpellPath::Earth) / 3);
    Utility::getBattlefield().logEvent("Skin hardens to stone");
    return true;
}

// ── Water — soothing current (Enchantment) ───────────────────────────────────
// Water does not heal wounds; it washes off exhaustion. With M-2 making fatigue
// lethal past the ceiling, that is a real save and not a minor one.
static bool castSoothingCurrent(AUnit& caster)
{
    Battlefield& field = Utility::getBattlefield();
    AUnit* worst = nullptr;
    for (auto& u : field.getTeam(caster.getTeam()))
        if (u && u->getAlive() && (!worst || u->getFatigue() > worst->getFatigue()))
            worst = u.get();
    if (!worst || worst->getFatigue() <= 0) return false;
    worst->addFatigue(-(SOOTHING_RELIEF + caster.getPathLevel(SpellPath::Water) * 5));
    field.logEvent("Cool water washes the weariness from a body");
    return true;
}

// ── High — ward (Enchantment) ────────────────────────────────────────────────
// High acts on magic itself (M-4): a barrier rather than a wound.
static bool castWard(AUnit& caster)
{
    AUnit* target = findAllyToAid(caster);
    if (!target) return false;
    target->addShield(WARD_STRENGTH + caster.getPathLevel(SpellPath::High));
    Utility::getBattlefield().logEvent("A ward shimmers into place");
    return true;
}

// ── Nature — briar snare (Enchantment) ───────────────────────────────────────
static bool castBriarSnare(AUnit& caster)
{
    AUnit* target = findEnemyInRange(caster);
    if (!target) return false;
    target->addFatigue(SNARE_FATIGUE + caster.getPathLevel(SpellPath::Nature) * 5);
    Utility::getBattlefield().logEvent("Briars erupt and drag at a struggling body");
    return true;
}

// ── Unholy — drain life (granted, not researched: M-14) ──────────────────────
static bool castDrainLife(AUnit& caster)
{
    AUnit* target = findEnemyInRange(caster);
    if (!target || !target->getHex()) return false;
    int drain = DRAIN_DAMAGE + caster.getPathLevel(SpellPath::Unholy);

    RangedShot shot;
    shot.baseDamage = drain;
    shot.accuracy   = caster.getAccuracy();
    shot.pen        = ArmorPen::Piercing;
    // What is taken from them is given to the caster — the whole point of the
    // spell, so it hangs off the damage hook rather than being paid blind.
    shot.onDamage   = [](AUnit* attacker, AUnit* /*victim*/, int damage) {
        if (attacker) attacker->heal(damage / 2);
    };

    RangedCombat::fire(&caster, target, shot);
    return true;
}

// ── Low — hex of frailty (Enchantment), and its price (M-21/M-24) ────────────
static bool castHexOfFrailty(AUnit& caster)
{
    AUnit* target = findEnemyInRange(caster);
    if (!target) return false;
    target->applyStatMod("defence", -(1 + caster.getPathLevel(SpellPath::Low) / 3));
    Utility::getBattlefield().logEvent("An old bargain leaves a man slower than he was");
    return true;
}

// M-24: Low is literally casting twice — once against them, once against
// yourself. This is the second effect, and it fires only after the first
// reported success. M-21 is what makes it fair: Low already paid HALF the
// fatigue for the privilege.
static bool priceOfFrailty(AUnit& caster)
{
    AUnit* ally = findAllyButSelf(caster);
    // The bargain takes from someone. It prefers a bystander and settles for
    // the caster, which is what stops a lone Low caster from paying nothing.
    AUnit* victim = ally ? ally : &caster;
    victim->takeDamage(LOW_BLOOD_PRICE, ArmorPen::Piercing);
    Utility::getBattlefield().logEvent(ally
        ? "Something old takes its due from the man standing nearest"
        : "Something old takes its due from the caster himself");
    return true;
}

// ── bless ─────────────────────────────────────────────────────────────────────

static bool isWounded(const AUnit& unit, int myTeam)
{
    (void) myTeam;
    return unit.getHp() < unit.getmaxHP();
}

static bool isBroken(const AUnit& unit, int myTeam)
{
    (void) myTeam;
    return unit.getBroken();
}

static bool castBless(AUnit& caster)
{
    AUnit* target = Utility::findTarget(
        Utility::getBattlefield().getTeam(caster.getTeam()),
        isBroken, isWounded, caster.getTeam());
    if (target == nullptr)
        return false;

    if (target->getBroken())
    {
        Utility::getBattlefield().logEvent("The divine healing helps a soldier find his courage");
        target->setBroken(false);
    }
    else
        Utility::getBattlefield().logEvent("The divine healing helps a soldier");
    target->heal(1 + Utility::throwDice());
    target->recover();
    return true;
}

// The major form: the blessing reaches the whole line rather than one man.
// M-20 again — it is the caster's HOLY level that decides how far it carries.
static bool castGreaterBless(AUnit& caster)
{
    Battlefield& field = Utility::getBattlefield();
    int reach  = GREATER_BLESS_BASE + caster.getPathLevel(SpellPath::Holy);
    int helped = 0;
    for (auto& u : field.getTeam(caster.getTeam())) {
        if (helped >= reach) break;
        if (!u || !u->getAlive()) continue;
        if (!u->getBroken() && u->getHp() >= u->getmaxHP()) continue;
        u->setBroken(false);
        u->heal(1 + Utility::throwDice());
        u->recover();
        ++helped;
    }
    if (helped == 0) return false;
    field.logEvent("A blessing runs down the line and men straighten where they stand");
    return true;
}

// ── raise_dead ────────────────────────────────────────────────────────────────

static bool placeZombie(AUnit& caster, Hex* targetHex)
{
    if (!targetHex) return false;
    std::unique_ptr<AUnit> Bob = std::make_unique<Zombie>(caster.getTeam());
    if (targetHex->sizeUsed + static_cast<int>(Bob->getPackingSize()) > Hex::CAPACITY) return false;
    for (AUnit* u : targetHex->units)
        if (u && u->getAlive() && u->getTeam() != caster.getTeam()) return false;

    if (Utility::getBattlefield().getCorpses())
        Utility::getBattlefield().setCorpses(Utility::getBattlefield().getCorpses() - 1);
    Bob->setBattleSummon(true);
    Bob->setHex(targetHex);
    Utility::getBattlefield().getTeam(caster.getTeam()).push_back(std::move(Bob));
    return true;
}

static bool placeSkeleton(AUnit& caster, Hex* targetHex)
{
    if (!targetHex) return false;
    std::unique_ptr<AUnit> sk = std::make_unique<Skeleton>(caster.getTeam());
    if (targetHex->sizeUsed + static_cast<int>(sk->getPackingSize()) > Hex::CAPACITY) return false;
    for (AUnit* u : targetHex->units)
        if (u && u->getAlive() && u->getTeam() != caster.getTeam()) return false;
    sk->setBattleSummon(true);
    sk->setHex(targetHex);
    Utility::getBattlefield().getTeam(caster.getTeam()).push_back(std::move(sk));
    return true;
}

// The minor form: one skeleton from old bones, costing no corpse. What keeps a
// Death 1 caster useful on a field that has not yet produced any dead.
static bool castRaiseSkeleton(AUnit& caster)
{
    if (!caster.getHex()) return false;
    Battlefield& myBattle = Utility::getBattlefield();
    for (const HexCoord& nc : myBattle.hexGrid.neighbors(caster.getHex()->coord)) {
        if (placeSkeleton(caster, myBattle.hexGrid.getHex(nc))) break;
    }
    // Reports true whenever its gates pass, even if every placement failed —
    // the casting happened, the grave soil just didn't cooperate.
    return true;
}

// The major form is HUNGRY, and it is allowed to be: M-20 scales how many rise
// on the caster's DEATH level, and the corpses have to come from somewhere. When
// the field has not produced enough dead it simply FAILS — and failing is not a
// wasted turn, because completeCast() then tries this spell's weaker forms and
// the caster falls back to conjuring a single skeleton (user, 2026-08-25: "You
// can make the major need more corpses but then also try minor if the major
// fails"). That is why this body no longer carries its own skeleton fallback:
// the minor form IS the fallback, so there is exactly one of it.
static bool castRaiseDead(AUnit& caster)
{
    if (!caster.getHex()) return false;
    Battlefield& myBattle = Utility::getBattlefield();

    size_t want = static_cast<size_t>(
        RAISE_DEAD_BODIES + caster.getPathLevel(SpellPath::Death) / 3);
    if (myBattle.getCorpses() < want) return false;
    myBattle.setCorpses(myBattle.getCorpses() - want);

    size_t summons = want;
    for (const HexCoord& nc : myBattle.hexGrid.neighbors(caster.getHex()->coord)) {
        if (!summons) break;
        if (placeZombie(caster, myBattle.hexGrid.getHex(nc))) summons--;
    }
    // Reports true even if a placement failed for want of room — the casting
    // happened, the grave soil just didn't cooperate.
    return true;
}

// ── path / school names ──────────────────────────────────────────────────────
// The JSON boundary needs both directions. An unknown name resolves to Count,
// which every caller treats as "skip this entry" rather than throwing — the
// same never-throw discipline UnitRegistry uses for every other placement field.

namespace {
    constexpr std::string_view kPathNames[SPELL_PATH_COUNT] = {
        "fire", "earth", "water", "air", "high", "low", "nature", "death", "holy", "unholy"
    };
    constexpr std::string_view kSchoolNames[SPELL_SCHOOL_COUNT] = {
        "evocation", "conjuration", "enchantment", "construction"
    };
}

std::string_view spellPathName(SpellPath p)
{
    if (p == SpellPath::Count) return "";
    return kPathNames[static_cast<size_t>(p)];
}

SpellPath spellPathFromName(std::string_view name)
{
    for (size_t i = 0; i < SPELL_PATH_COUNT; ++i)
        if (kPathNames[i] == name) return static_cast<SpellPath>(i);
    return SpellPath::Count;
}

std::string_view spellSchoolName(SpellSchool s)
{
    if (s == SpellSchool::Count || s == SpellSchool::None) return "";
    return kSchoolNames[static_cast<size_t>(s)];
}

SpellSchool spellSchoolFromName(std::string_view name)
{
    for (size_t i = 0; i < SPELL_SCHOOL_COUNT; ++i)
        if (kSchoolNames[i] == name) return static_cast<SpellSchool>(i);
    return SpellSchool::Count;
}

// ── what the player is told (slice 3, S3-1/S3-4) ─────────────────────────────
//
// Every sentence below is BUILT from the constants the matching effect body
// reads, never typed out as a literal. The Study is the player's only written
// source on what a spell does, and a description carrying a hardcoded "4
// damage" would go quietly wrong the day EMBER_DAMAGE moved — the exact drift
// the unit catalog's single-source-of-truth export exists to prevent.
//
// They live beside the roster rather than in the campaign server for the same
// reason: the numbers are here, so the prose about the numbers is here too.
// The server phrases what it owns (17-5) — school names, level lines — and
// passes these through untouched.

namespace {

const std::string kRange = " at range";

// "N damage, +1 for each level of X" — the shape most offensive spells share.
std::string scalingDamage(int base, std::string_view path)
{
    return std::to_string(base) + " damage, and one more for every level of "
         + std::string(path) + " the caster commands";
}

std::string ember()
{
    return "A single bolt of fire" + kRange + ": " + scalingDamage(EMBER_DAMAGE, "Fire")
         + ". No blast — this is what keeps a newly sworn Fire mage useful.";
}

// Not built on scalingDamage(): fireball's sentence has to name the man it
// lands on BEFORE the scaling clause, or the "+1 per level" reads as attaching
// to the blast that follows it.
std::string fireball()
{
    return "A detonation" + kRange + ": " + std::to_string(FIREBALL_CENTRE)
         + " damage to the man it lands on, and one more for every level of Fire "
           "the caster commands, then " + std::to_string(FIREBALL_SECONDARY)
         + " further hits of " + std::to_string(FIREBALL_BLAST)
         + " damage each tearing through the same ground.";
}

std::string shock()
{
    return "A lightning stroke" + kRange + ": " + scalingDamage(SHOCK_DAMAGE, "Air")
         + ". Less than fire carries, but it pierces armour and goes where it is aimed.";
}

std::string stoneskin()
{
    return "One ally's skin hardens to stone: a point of armour, and another for "
           "every three levels of Earth.";
}

std::string soothingCurrent()
{
    return "Washes " + std::to_string(SOOTHING_RELIEF)
         + " fatigue off the most exhausted man on the field, and 5 more for every "
           "level of Water. It closes no wounds — but past the ceiling, exhaustion kills.";
}

std::string ward()
{
    return "A barrier over one ally, turning aside " + std::to_string(WARD_STRENGTH)
         + " damage and one more for every level of High.";
}

std::string briarSnare()
{
    return "Briars erupt and drag at one enemy" + kRange + ": "
         + std::to_string(SNARE_FATIGUE)
         + " fatigue inflicted, and 5 more for every level of Nature. "
           "Exhaustion is lethal past the ceiling.";
}

std::string hexOfFrailty()
{
    return "One enemy loses a point of defence, and another for every three levels "
           "of Low. Then the bargain takes its due: " + std::to_string(LOW_BLOOD_PRICE)
         + " damage to the man standing nearest the caster — or to the caster himself, "
           "if he stands alone.";
}

std::string raiseSkeleton()
{
    return "One skeleton claws up from old bones beside the caster. It costs no corpse, "
           "so a raiser is useful on a field that has not yet made any dead.";
}

std::string raiseDead()
{
    return std::to_string(RAISE_DEAD_BODIES)
         + " corpses rise as zombies, and one more for every three levels of Death. "
           "Fails outright where the field has not produced enough dead — and the "
           "lesser form is then tried in its place.";
}

std::string blessing()
{
    return "One wounded or broken man is healed and steadied: he finds his courage "
           "and recovers his footing.";
}

std::string greaterBlessing()
{
    return "The blessing runs down the line, reaching " + std::to_string(GREATER_BLESS_BASE)
         + " men and one more for every level of Holy, healing and steadying each.";
}

std::string drainLife()
{
    return "Life is pulled out of one enemy" + kRange + ": "
         + scalingDamage(DRAIN_DAMAGE, "Unholy")
         + ", piercing armour — and half of what lands returns to the caster as healing.";
}

}  // namespace

// ── the roster ────────────────────────────────────────────────────────────────

namespace Spells
{
    // M-18: one MINOR spell per path, all ten, plus MAJOR forms for the three
    // spells that already existed. The three lose their exact-unit-type gate —
    // R4 reserved that for genuinely unique spells, and fireball/bless/
    // raise_dead are not unique, they are the first three entries of a real
    // roster.
    //
    // Within a spell, forms run WEAKEST FIRST: chooseSpellToCast() takes the
    // last one the caster qualifies for, which is how M-13's "the AI takes the
    // most powerful form" is enforced by the table's own order.
    const std::vector<Spell>& roster()
    {
        using P = SpellPath;
        using S = SpellSchool;
        static const std::vector<Spell> table = {
            // ── Fire ─────────────────────────────────────────────────────────
            { "fireball", {
                { "minor", "Ember", ember(),
                  {{P::Fire, 1}}, S::Evocation, 1,  8, 1, castEmber,    nullptr },
                { "major", "Fireball", fireball(),
                  {{P::Fire, 3}}, S::Evocation, 3, 22, 2, castFireball, nullptr },
            }},
            // ── Air ──────────────────────────────────────────────────────────
            { "shock", {
                { "minor", "Shock", shock(),
                  {{P::Air, 1}}, S::Evocation, 1, 10, 1, castShock, nullptr },
            }},
            // ── Earth ────────────────────────────────────────────────────────
            { "stoneskin", {
                { "minor", "Stoneskin", stoneskin(),
                  {{P::Earth, 1}}, S::Enchantment, 1, 10, 1, castStoneskin, nullptr },
            }},
            // ── Water ────────────────────────────────────────────────────────
            { "soothing_current", {
                { "minor", "Soothing Current", soothingCurrent(),
                  {{P::Water, 1}}, S::Enchantment, 1, 8, 1, castSoothingCurrent, nullptr },
            }},
            // ── High ─────────────────────────────────────────────────────────
            { "ward", {
                { "minor", "Ward", ward(),
                  {{P::High, 1}}, S::Enchantment, 2, 12, 1, castWard, nullptr },
            }},
            // ── Nature ───────────────────────────────────────────────────────
            { "briar_snare", {
                { "minor", "Briar Snare", briarSnare(),
                  {{P::Nature, 1}}, S::Enchantment, 1, 10, 1, castBriarSnare, nullptr },
            }},
            // ── Low — half fatigue (M-21) and a price that fires with it (M-24)
            { "hex_of_frailty", {
                { "minor", "Hex of Frailty", hexOfFrailty(),
                  {{P::Low, 1}}, S::Enchantment, 1, 14, 1,
                  castHexOfFrailty, priceOfFrailty },
            }},
            // ── Death ────────────────────────────────────────────────────────
            { "raise_dead", {
                { "minor", "Raise Skeleton", raiseSkeleton(),
                  {{P::Death, 1}}, S::Conjuration, 1, 12, 1, castRaiseSkeleton, nullptr },
                { "major", "Raise Dead", raiseDead(),
                  {{P::Death, 3}}, S::Conjuration, 3, 26, 2, castRaiseDead,     nullptr },
            }},
            // ── Holy — granted, not researched, so NO school gate (M-14) ─────
            { "bless", {
                { "minor", "Blessing", blessing(),
                  {{P::Holy, 1}}, S::None, 0, 10, 1, castBless,        nullptr },
                { "major", "Greater Blessing", greaterBlessing(),
                  {{P::Holy, 3}}, S::None, 0, 24, 2, castGreaterBless, nullptr },
            }},
            // ── Unholy — granted like Holy, and likewise ungated by school ───
            { "drain_life", {
                { "minor", "Drain Life", drainLife(),
                  {{P::Unholy, 1}}, S::None, 0, 14, 1, castDrainLife, nullptr },
            }},
        };
        return table;
    }

    bool qualifies(const AUnit& caster, const SpellForm& form)
    {
        // M-6: the army knows, the caster qualifies. Research decides what
        // exists campaign-wide; path levels decide who can cast it.
        for (const PathRequirement& req : form.paths)
            if (caster.getPathLevel(req.path) < req.level) return false;
        // M-19: both sides pass the identical school gate; only where the
        // number comes from differs. SpellSchool::None has no gate at all,
        // which is what a pure-Holy blessing carries (M-14).
        if (form.school == SpellSchool::None) return true;
        return Utility::getBattlefield().getSchoolLevel(caster.getTeam(), form.school)
               >= form.schoolLevel;
    }

    const Spell* findSpell(std::string_view id)
    {
        for (const Spell& s : roster())
            if (s.id == id) return &s;
        return nullptr;
    }

    const std::vector<const Spell*>& defaultScript()
    {
        // M-22: the AI's ordered list IS a script, which is why slice 4 costs
        // almost nothing — the player's list replaces this one and no second
        // code path exists. Roster order is the default priority.
        static const std::vector<const Spell*> script = [] {
            std::vector<const Spell*> out;
            for (const Spell& s : roster()) out.push_back(&s);
            return out;
        }();
        return script;
    }

    // How many rows of the enemy's home end count as its "rear edge".
    static constexpr int SALLY_REAR_BAND = 3;

    int castGarrisonSally(Battlefield& field, const Reinforcement& r)
    {
        if (r.count <= 0) return 0;
        const int enemyTeam = 3 - r.team;

        // The enemy's rear edge, in visual-col space (matching randomPlaceArmy).
        // Red flees south (r = height-1), Blue north (r = 0); the sally lands on
        // whichever home edge belongs to the enemy of the reinforcing team.
        const int band = std::min(SALLY_REAR_BAND, Battlefield::height);
        PlacementZone zone = (enemyTeam == REDTEAM)
            ? PlacementZone{0, Battlefield::width - 1, Battlefield::height - band, Battlefield::height - 1}
            : PlacementZone{0, Battlefield::width - 1, 0, band - 1};

        Army wave;
        for (int i = 0; i < r.count; ++i) {
            std::unique_ptr<AUnit> u = makeUnitByName(r.unitType, r.team);
            if (u) { u->setBattleSummon(true); wave.push_back(std::move(u)); }
        }
        if (wave.empty()) return 0;

        // Partial placement is tolerated, exactly like raise_dead: if the rear
        // edge is full, the units that found no hex simply never arrive.
        randomPlaceArmy(wave, field, zone);

        int placed = 0;
        for (auto& u : wave) {
            if (u && u->getHex()) {
                field.getTeam(r.team).push_back(std::move(u));
                ++placed;
            }
        }
        if (placed > 0)
            field.logEvent(r.message.empty()
                ? "Reinforcements storm the enemy's rear!"
                : r.message);
        return placed;
    }

    // ── the catalog export (slice 3, S3-1) ───────────────────────────────────
    //
    // ONE ROW PER FORM, because a form is what The Study draws: "Ember" and
    // "Fireball" are two rows the player reads, not one row with a rank hidden
    // inside it. The spell id rides along so slice 4's scripts — which name a
    // spell AND a form (M-13) — can address the pair without a second export.
    //
    // The campaign server imports this at boot exactly as it imports
    // `dump-units`, which is what keeps the C++ roster the single source of
    // truth: retune a gate here, restart the server, and the screen is current.
    //
    // A school-less form (pure Holy, pure Unholy — M-14) exports `school: null`
    // rather than being dropped. It is the WHOLE truth about the roster that
    // crosses; which rows a given screen shows is the reader's business, and
    // The Study's answer (S3-2: it shows neither) is one the server makes.
    std::string spellCatalogJson()
    {
        json spells = json::array();
        for (const Spell& spell : roster()) {
            for (const SpellForm& form : spell.forms) {
                json paths = json::array();
                // ORDERED, and the order is load-bearing: paths[0] is the
                // PRIMARY (M-20), which decides the fatigue divide and the
                // scaling. A reader that sorts these has broken them.
                for (const PathRequirement& req : form.paths)
                    paths.push_back({
                        {"path",  std::string(spellPathName(req.path))},
                        {"level", req.level},
                    });

                spells.push_back({
                    {"spell",       std::string(spell.id)},
                    {"form",        std::string(form.name)},
                    {"label",       std::string(form.label)},
                    {"description", form.description},
                    {"school",      form.school == SpellSchool::None
                                        ? json(nullptr)
                                        : json(std::string(spellSchoolName(form.school)))},
                    {"schoolLevel", form.schoolLevel},
                    {"paths",       paths},
                    {"fatigue",     form.fatigue},
                    {"castingTime", form.castingTime},
                });
            }
        }
        return json{{"spells", spells}}.dump();
    }
}
