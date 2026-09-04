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
// fatigue on completion — lives in AUnit::castSpells(); TARGETING lives in the
// resolver at the bottom of this file (A-1), and each body below only applies
// an effect to the target it was handed.
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

// ── shared targeting (A-1: declared on the form, resolved in one place) ─────
//
// Slice AI-1. What used to be seven hand-rolled searches inside the bodies is
// now the two predicates below plus Spells::candidates()/chooseTarget() at the
// bottom of this file. The bodies are EFFECT ONLY: they are handed a Target and
// apply what they do to it, which is what lets AI-2's scorer ask "whom would
// this form hit" without casting anything.
//
// Nothing about WHOM a spell picks changed here. Every predicate below is the
// old body's own code, moved rather than rewritten.

// The in-range test every offensive spell shared — findEnemyInRange's `inRange`
// lambda, unchanged: alive, on the other side, standing somewhere, and within
// SPELLRANGE once the elevation difference is clamped to the ranged cap.
static bool spellInRange(const AUnit& caster, const AUnit& target, int myTeam)
{
    if (!target.getAlive() || target.getTeam() == myTeam || !target.getHex()) return false;
    int dist  = Utility::calcDistance(target.getHex(), caster.getHex());
    int tiers = std::clamp(caster.getHex()->elevation - target.getHex()->elevation,
                           -ELEV_RANGED_CAP, ELEV_RANGED_CAP);
    return dist - tiers <= SPELLRANGE;
}

// findEnemyInRange's `scoreTarget`, likewise unchanged: prefer densely packed
// hexes at closer range. Its -1 cases are exactly the predicate's false cases,
// which is why it is written on top of it.
static int spellDensityScore(const AUnit& caster, const AUnit& target, int myTeam)
{
    if (!spellInRange(caster, target, myTeam)) return -1;
    int dist = Utility::calcDistance(target.getHex(), caster.getHex());
    return target.getHex()->sizeUsed * 10 / (dist + 1);
}

// Any living ally other than the caster — what a sacrifice needs (M-24). NOT
// targeting: the Low price is a second effect aimed at your own side, it takes
// no Target and it is not a thing the AI ever chooses. Left exactly as it was.
static AUnit* findAllyButSelf(AUnit& caster)
{
    Battlefield& field = Utility::getBattlefield();
    for (auto& u : field.getTeam(caster.getTeam()))
        if (u && u.get() != &caster && u->getAlive() && u->getHex())
            return u.get();
    return nullptr;
}

// A-8: a buff form's body marks the man it landed on, and Spells::candidates()
// then keeps that form off him for the rest of the battle. The id passed here
// must be the ROSTER id of the spell the body belongs to (form.spell->id) — the
// roster sweep in test_targeting.cpp is what holds the two together.
static void markBuffOn(AUnit& unit, std::string_view spellId)
{
    unit.markBuff(spellId);
}

// ── Fire — fireball (Evocation) ──────────────────────────────────────────────

// The minor form: a single bolt, no blast. What keeps a Fire 1 caster useful,
// exactly as Dominions' early-generation spells do (M-12).
static bool castEmber(AUnit& caster, const Target& target)
{
    // The caster's own hex is not targeting — a shot is fired FROM somewhere,
    // so an unplaced caster has nothing to fire from. Kept in the body for the
    // same reason it was always here.
    if (!caster.getHex()) return false;
    AUnit* aimUnit = target.unit;
    if (!aimUnit || !aimUnit->getHex()) return false;

    RangedShot shot;
    shot.baseDamage = EMBER_DAMAGE + caster.getPathLevel(SpellPath::Fire);
    shot.accuracy   = caster.getAccuracy();
    shot.pen        = ArmorPen::Normal;

    RangedCombat::fire(&caster, aimUnit, shot);
    return true;
}

static bool castFireball(AUnit& caster, const Target& target)
{
    if (!caster.getHex()) return false;
    AUnit* aimUnit = target.unit;
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
static bool castShock(AUnit& caster, const Target& target)
{
    if (!caster.getHex()) return false;
    AUnit* aimUnit = target.unit;
    if (!aimUnit || !aimUnit->getHex()) return false;

    RangedShot shot;
    shot.baseDamage = SHOCK_DAMAGE + caster.getPathLevel(SpellPath::Air);
    shot.accuracy   = SHOCK_ACCURACY;
    shot.pen        = ArmorPen::Piercing;   // lightning cares little for plate

    RangedCombat::fire(&caster, aimUnit, shot);
    return true;
}

// ── Earth — stoneskin (Enchantment) ──────────────────────────────────────────
// A `buff` form (A-8): the resolver has already dropped every ally who is
// carrying this spell, so a target arriving here has never been skinned in this
// battle — and marking him keeps it that way.
static bool castStoneskin(AUnit& caster, const Target& target)
{
    AUnit* unit = target.unit;
    if (!unit) return false;
    unit->applyStatMod("armour", 1 + caster.getPathLevel(SpellPath::Earth) / 3);
    markBuffOn(*unit, "stoneskin");
    Utility::getBattlefield().logEvent("Skin hardens to stone");
    return true;
}

// ── Water — soothing current (Enchantment) ───────────────────────────────────
// Water does not heal wounds; it washes off exhaustion. With M-2 making fatigue
// lethal past the ceiling, that is a real save and not a minor one.
// TargetPick::Fatigued hands over the most exhausted body and NOBODY when the
// tiredest man on the line is at zero — the "nothing to wash off" case the old
// body tested for itself.
static bool castSoothingCurrent(AUnit& caster, const Target& target)
{
    Battlefield& field = Utility::getBattlefield();
    AUnit* worst = target.unit;
    if (!worst) return false;
    worst->addFatigue(-(SOOTHING_RELIEF + caster.getPathLevel(SpellPath::Water) * 5));
    field.logEvent("Cool water washes the weariness from a body");
    return true;
}

// ── High — ward (Enchantment) ────────────────────────────────────────────────
// High acts on magic itself (M-4): a barrier rather than a wound.
// The other `buff` form — one ward per man per battle, for the same reason
// (A-8): addShield stacks layers, and nothing but this rule stops a High caster
// from spending a whole battle wrapping one soldier.
static bool castWard(AUnit& caster, const Target& target)
{
    AUnit* unit = target.unit;
    if (!unit) return false;
    unit->addShield(WARD_STRENGTH + caster.getPathLevel(SpellPath::High));
    markBuffOn(*unit, "ward");
    Utility::getBattlefield().logEvent("A ward shimmers into place");
    return true;
}

// ── Nature — briar snare (Enchantment) ───────────────────────────────────────
static bool castBriarSnare(AUnit& caster, const Target& target)
{
    AUnit* unit = target.unit;
    if (!unit) return false;
    unit->addFatigue(SNARE_FATIGUE + caster.getPathLevel(SpellPath::Nature) * 5);
    Utility::getBattlefield().logEvent("Briars erupt and drag at a struggling body");
    return true;
}

// ── Nature — soothing winds (Enchantment, battlefield-wide) — E-6 ────────────
//
// The first of the sustained spells: it is not aimed at a man, it stands over
// the caster's own line until he does not. Friendly aim, so both sides may hold
// their own wind at once and each is helped by its own.
//
// The per-tick relief is deliberately tiny next to soothing_current's one-off
// wash: this one is paid every tick of the battle, and its real size is
// whatever the battle's length multiplies it by.
static void tickSoothingWinds(Battlefield& field, int team)
{
    for (auto& u : field.getTeam(team))
        if (u && u->getAlive()) u->addFatigue(-SOOTHING_WINDS_RELIEF);
}

// TargetKind::Battlefield: nothing is aimed at, so nothing is handed over.
static bool castSoothingWinds(AUnit& caster, const Target& /*target*/)
{
    return Utility::getBattlefield().beginEnchantment(caster, "soothing_winds");
}

// ── Death — leaden air (Enchantment, battlefield-wide, symmetric) — E-6 ──────
//
// Everyone aim: the weight presses on BOTH sides, so calling it is a bet that
// your line carries exhaustion better than theirs — and two instances never
// press twice, which is what keeps it a decision rather than a race.
static void tickLeadenAir(Battlefield& field, int /*team*/)
{
    // E-6's thematic ruling, read STRUCTURALLY rather than off a list of unit
    // names: the curse presses on the LIVING. A body that does not tire
    // (Skeleton, Zombie, Golem — fatigueCost 0) has nothing for a weight in the
    // air to work on, and the Undead flag exempts anything that tires but is
    // already dead. Between them, a unit type written next month lands on the
    // right side of the line without this body being edited.
    for (int team : {REDTEAM, BLUETEAM})
        for (auto& u : field.getTeam(team)) {
            if (!u || !u->getAlive() || !u->tires()) continue;
            if (u->hasAbility(UnitAbility::Undead)) continue;
            u->addFatigue(LEADEN_AIR_WEIGHT);
        }
}

static bool castLeadenAir(AUnit& caster, const Target& /*target*/)
{
    return Utility::getBattlefield().beginEnchantment(caster, "leaden_air");
}

// ── Unholy — drain life (granted, not researched: M-14) ──────────────────────
static bool castDrainLife(AUnit& caster, const Target& target)
{
    if (!caster.getHex()) return false;   // a shot needs somewhere to come from
    AUnit* unit = target.unit;
    if (!unit || !unit->getHex()) return false;
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

    RangedCombat::fire(&caster, unit, shot);
    return true;
}

// ── Low — hex of frailty (Enchantment), and its price (M-21/M-24) ────────────
static bool castHexOfFrailty(AUnit& caster, const Target& target)
{
    AUnit* unit = target.unit;
    if (!unit) return false;
    unit->applyStatMod("defence", -(1 + caster.getPathLevel(SpellPath::Low) / 3));
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

static bool castBless(AUnit& /*caster*/, const Target& target)
{
    AUnit* unit = target.unit;   // TargetPick::Broken — a broken man first
    if (unit == nullptr)
        return false;

    if (unit->getBroken())
    {
        Utility::getBattlefield().logEvent("The divine healing helps a soldier find his courage");
        unit->setBroken(false);
    }
    else
        Utility::getBattlefield().logEvent("The divine healing helps a soldier");
    unit->heal(1 + Utility::throwDice());
    unit->recover();
    return true;
}

// The major form: the blessing reaches the whole line rather than one man.
// M-20 again — it is the caster's HOLY level that decides how far it carries.
// TargetKind::AllyTeam: the resolver hands over the whole living line, in team
// order, and the walk down it — the reach cap and the skip rule — is exactly the
// one this body always did over field.getTeam() itself.
static bool castGreaterBless(AUnit& caster, const Target& target)
{
    Battlefield& field = Utility::getBattlefield();
    int reach  = GREATER_BLESS_BASE + caster.getPathLevel(SpellPath::Holy);
    int helped = 0;
    for (AUnit* u : target.units) {
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
// TargetKind::Adjacent: no unit is handed over — the body scans the caster's own
// neighbouring hexes, which is all this spell has ever needed.
static bool castRaiseSkeleton(AUnit& caster, const Target& /*target*/)
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
static bool castRaiseDead(AUnit& caster, const Target& /*target*/)
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
    // Ordered to match TargetKind, and read only by the catalog export. The
    // asserts are the guard a Count enumerator would otherwise give: a kind
    // inserted in the middle shifts every name after it, and the campaign layer
    // would then be told a spell targets something it does not.
    constexpr std::string_view kTargetKindNames[] = {
        "enemy_unit", "ally_unit", "ally_team", "adjacent", "battlefield", "none"
    };
    static_assert(sizeof(kTargetKindNames) / sizeof(kTargetKindNames[0])
                  == static_cast<size_t>(TargetKind::None) + 1);
    static_assert(kTargetKindNames[static_cast<size_t>(TargetKind::EnemyUnit)] == "enemy_unit");
    static_assert(kTargetKindNames[static_cast<size_t>(TargetKind::AllyTeam)]  == "ally_team");
    static_assert(kTargetKindNames[static_cast<size_t>(TargetKind::None)]      == "none");
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

int spellDivider(const SpellForm& form)
{
    if (form.aiDivider > 0) return form.aiDivider;   // A-4: the authored override wins
    int cost  = form.fatigue + form.poolCost * AI_POOL_COST_WEIGHT;
    int ticks = form.castingTime > 1 ? form.castingTime : 1;
    return std::max(1, ticks * (AI_DIVIDER_BASE + cost / AI_FATIGUE_PER_DIVIDER));
}

std::string_view targetKindName(TargetKind k)
{
    return kTargetKindNames[static_cast<size_t>(k)];
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

// The sustained spells say three things no ordinary description has to: that
// they stand rather than resolve, what ends them, and that a side gets one.
std::string soothingWinds()
{
    return "A wind runs the length of your own line and does not stop: every man on your "
           "side sheds " + std::to_string(SOOTHING_WINDS_RELIEF)
         + " fatigue every turn, for as long as the caster who called it still stands. "
           "It draws " + std::to_string(SOOTHING_WINDS_POOL_COST)
         + " channels from the army's banners, and an army may call it once in a battle.";
}

std::string leadenAir()
{
    return "The air over the whole field turns heavy — yours as much as theirs. Every "
           "living body on both sides gains " + std::to_string(LEADEN_AIR_WEIGHT)
         + " fatigue every turn, for as long as the caster who called it still stands; "
           "the undead and the unliving feel nothing. It draws "
         + std::to_string(LEADEN_AIR_POOL_COST)
         + " channels from the army's banners, and an army may call it once in a battle.";
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

// ── what each form is worth (A-3, slice AI-2) ────────────────────────────────
//
// Expected effect in UNIT-VALUE units for the target the resolver would hand
// the body, written per form because the magnitude lives inside the body.
// Damage: expected damage × the target's value (A-3), hit chance included.
// A standing effect: a share of its bearer. Relief: what would actually be
// washed off. Every one is PURE — it reads the field and rolls nothing.

static int worthDamage(int damage, int hitPct, const Target& t)
{
    if (!t.unit || damage <= 0) return 0;
    return damage * hitPct * t.unit->getValue() / (100 * AI_DAMAGE_SCALE);
}

static int worthEmber(const AUnit& c, const Target& t)
{
    return worthDamage(EMBER_DAMAGE + c.getPathLevel(SpellPath::Fire), c.getAccuracy(), t);
}

static int worthFireball(const AUnit& c, const Target& t)
{
    // The blast lands on the same hex: half the splash is a fair expectation
    // of what else stands there.
    int dmg = FIREBALL_CENTRE + c.getPathLevel(SpellPath::Fire)
            + FIREBALL_SECONDARY * FIREBALL_BLAST / 2;
    return worthDamage(dmg, c.getAccuracy(), t);
}

static int worthShock(const AUnit& c, const Target& t)
{
    return worthDamage(SHOCK_DAMAGE + c.getPathLevel(SpellPath::Air), SHOCK_ACCURACY, t);
}

static int worthDrainLife(const AUnit& c, const Target& t)
{
    int drain = DRAIN_DAMAGE + c.getPathLevel(SpellPath::Unholy);
    int worth = worthDamage(drain, c.getAccuracy(), t);
    // Half of what lands comes back — worth something only to a wounded caster.
    if (worth > 0 && c.getHp() < c.getmaxHP())
        worth += (drain / 2) * c.getValue() / AI_DAMAGE_SCALE;
    return worth;
}

static int worthBriarSnare(const AUnit& c, const Target& t)
{
    int fatigue = SNARE_FATIGUE + c.getPathLevel(SpellPath::Nature) * 5;
    return worthDamage(fatigue / AI_FATIGUE_PER_DAMAGE, 100, t);
}

// A buff's candidates already exclude a body carrying it (A-8), so a fresh
// target is worth a share of itself and the marked ones never reach here.
static int worthBuff(const AUnit&, const Target& t)
{
    return t.unit ? t.unit->getValue() * AI_BUFF_WORTH_PCT / 100 : 0;
}

static int worthSoothingCurrent(const AUnit& c, const Target& t)
{
    if (!t.unit || t.unit->getFatigue() <= 0) return 0;
    int relief = std::min(t.unit->getFatigue(),
                          SOOTHING_RELIEF + c.getPathLevel(SpellPath::Water) * 5);
    return (relief / AI_FATIGUE_PER_DAMAGE) * t.unit->getValue() / AI_DAMAGE_SCALE;
}

static int worthHexOfFrailty(const AUnit& c, const Target& t)
{
    if (!t.unit) return 0;
    // M-24: the bargain takes LOW_BLOOD_PRICE from your own side, and the
    // caster's own value stands in for whoever ends up paying it.
    int worth = t.unit->getValue() * AI_DEBUFF_WORTH_PCT / 100;
    return worth - LOW_BLOOD_PRICE * c.getValue() / AI_DAMAGE_SCALE;
}

// One man's worth of blessing: un-breaking him is worth most of him, a wound
// closed is worth what the heal would restore, a whole man is worth nothing.
static int blessWorthOf(const AUnit& u)
{
    if (u.getBroken()) return u.getValue() * AI_RALLY_WORTH_PCT / 100;
    int missing = u.getmaxHP() - u.getHp();
    if (missing <= 0) return 0;
    return std::min(missing, AI_HEAL_AVG) * u.getValue() / AI_DAMAGE_SCALE;
}

static int worthBless(const AUnit&, const Target& t)
{
    return t.unit ? blessWorthOf(*t.unit) : 0;
}

static int worthGreaterBless(const AUnit& c, const Target& t)
{
    int reach = GREATER_BLESS_BASE + c.getPathLevel(SpellPath::Holy);
    int worth = 0, helped = 0;
    for (const AUnit* u : t.units) {
        if (helped >= reach) break;
        int w = blessWorthOf(*u);
        if (w <= 0) continue;
        worth += w;
        ++helped;
    }
    return worth;
}

static int worthRaiseSkeleton(const AUnit& c, const Target&)
{
    return c.getHex() ? AI_SKELETON_WORTH : 0;
}

static int worthRaiseDead(const AUnit& c, const Target&)
{
    if (!c.getHex()) return 0;
    size_t want = static_cast<size_t>(RAISE_DEAD_BODIES + c.getPathLevel(SpellPath::Death) / 3);
    if (Utility::getBattlefield().getCorpses() < want) return 0;   // the body would fail (M-26)
    return static_cast<int>(want) * AI_ZOMBIE_WORTH;
}

// A battlefield enchantment is script-only (E-3), so its worth only ever meets
// the script floor: a flat number that says "worth calling", nothing finer.
static int worthGlobal(const AUnit&, const Target&)
{
    return AI_GLOBAL_WORTH;
}

// The worth each row carries, looked up by spell id and form name so the table
// below stays positional and untouched — the same reasoning as the back-pointer.
static int (*worthFor(std::string_view spellId, std::string_view formName))(const AUnit&, const Target&)
{
    if (spellId == "fireball")         return formName == "major" ? worthFireball : worthEmber;
    if (spellId == "shock")            return worthShock;
    if (spellId == "stoneskin")        return worthBuff;
    if (spellId == "soothing_current") return worthSoothingCurrent;
    if (spellId == "ward")             return worthBuff;
    if (spellId == "briar_snare")      return worthBriarSnare;
    if (spellId == "soothing_winds")   return worthGlobal;
    if (spellId == "hex_of_frailty")   return worthHexOfFrailty;
    if (spellId == "raise_dead")       return formName == "major" ? worthRaiseDead : worthRaiseSkeleton;
    if (spellId == "leaden_air")       return worthGlobal;
    if (spellId == "bless")            return formName == "major" ? worthGreaterBless : worthBless;
    if (spellId == "drain_life")       return worthDrainLife;
    return nullptr;   // the roster sweep in test_scoring.cpp fails on this
}

// ── the roster ────────────────────────────────────────────────────────────────

namespace Spells
{
    // M-18: one MINOR spell per path, all ten, plus MAJOR forms for the three
    // spells that already existed. The three lose their exact-unit-type gate —
    // R4 reserved that for genuinely unique spells, and fireball/bless/
    // raise_dead are not unique, they are the first three entries of a real
    // roster.
    //
    // Within a spell, forms run WEAKEST FIRST: M-26's fall-through at cast time
    // cycles DOWN the table when the chosen form fails, so the order is what
    // makes a fallback exist. Since AI-2 the form itself is CHOSEN BY SCORE
    // (optionsFor keeps the best-scoring form per target), not by position.
    const std::vector<Spell>& roster()
    {
        using P = SpellPath;
        using S = SpellSchool;
        // The trailing `EnchantAim::None, 0, nullptr` on the ordinary rows is
        // the battlefield trio at its default: the table is aggregate-initialised
        // POSITIONALLY, so declaring targeting (A-1) after it has to name what it
        // skips over. What follows the trio is the targeting itself — the kind,
        // the pick, and `true` where the form is a buff (A-8).
        static std::vector<Spell> table = {
            // ── Fire ─────────────────────────────────────────────────────────
            { "fireball", {
                { "minor", "Ember", ember(),
                  {{P::Fire, 1}}, S::Evocation, 1,  8, 1, castEmber,    nullptr,
                  EnchantAim::None, 0, nullptr,
                  TargetKind::EnemyUnit, TargetPick::Densest },
                { "major", "Fireball", fireball(),
                  {{P::Fire, 3}}, S::Evocation, 3, 22, 2, castFireball, nullptr,
                  EnchantAim::None, 0, nullptr,
                  TargetKind::EnemyUnit, TargetPick::Densest },
            }},
            // ── Air ──────────────────────────────────────────────────────────
            { "shock", {
                { "minor", "Shock", shock(),
                  {{P::Air, 1}}, S::Evocation, 1, 10, 1, castShock, nullptr,
                  EnchantAim::None, 0, nullptr,
                  TargetKind::EnemyUnit, TargetPick::Densest },
            }},
            // ── Earth ────────────────────────────────────────────────────────
            { "stoneskin", {
                { "minor", "Stoneskin", stoneskin(),
                  {{P::Earth, 1}}, S::Enchantment, 1, 10, 1, castStoneskin, nullptr,
                  EnchantAim::None, 0, nullptr,
                  TargetKind::AllyUnit, TargetPick::Wounded, true },
            }},
            // ── Water ────────────────────────────────────────────────────────
            { "soothing_current", {
                { "minor", "Soothing Current", soothingCurrent(),
                  {{P::Water, 1}}, S::Enchantment, 1, 8, 1, castSoothingCurrent, nullptr,
                  EnchantAim::None, 0, nullptr,
                  TargetKind::AllyUnit, TargetPick::Fatigued },
            }},
            // ── High ─────────────────────────────────────────────────────────
            { "ward", {
                { "minor", "Ward", ward(),
                  {{P::High, 1}}, S::Enchantment, 2, 12, 1, castWard, nullptr,
                  EnchantAim::None, 0, nullptr,
                  TargetKind::AllyUnit, TargetPick::Wounded, true },
            }},
            // ── Nature ───────────────────────────────────────────────────────
            { "briar_snare", {
                { "minor", "Briar Snare", briarSnare(),
                  {{P::Nature, 1}}, S::Enchantment, 1, 10, 1, castBriarSnare, nullptr,
                  EnchantAim::None, 0, nullptr,
                  TargetKind::EnemyUnit, TargetPick::Densest },
            }},
            // A battlefield-wide enchantment: ONE form, named "battlefield"
            // rather than minor/major, because there is no ladder to climb —
            // the spell either stands over the field or it does not. The three
            // trailing fields are what make it sustained (see Spell.hpp).
            { "soothing_winds", {
                { "battlefield", "Soothing Winds", soothingWinds(),
                  {{P::Nature, 2}}, S::Enchantment, 2,
                  SOOTHING_WINDS_FATIGUE, 2, castSoothingWinds, nullptr,
                  EnchantAim::Friendly, SOOTHING_WINDS_POOL_COST, tickSoothingWinds,
                  TargetKind::Battlefield, TargetPick::First },
            }},
            // ── Low — half fatigue (M-21) and a price that fires with it (M-24)
            { "hex_of_frailty", {
                { "minor", "Hex of Frailty", hexOfFrailty(),
                  {{P::Low, 1}}, S::Enchantment, 1, 14, 1,
                  castHexOfFrailty, priceOfFrailty,
                  EnchantAim::None, 0, nullptr,
                  TargetKind::EnemyUnit, TargetPick::Densest },
            }},
            // ── Death ────────────────────────────────────────────────────────
            { "raise_dead", {
                { "minor", "Raise Skeleton", raiseSkeleton(),
                  {{P::Death, 1}}, S::Conjuration, 1, 12, 1, castRaiseSkeleton, nullptr,
                  EnchantAim::None, 0, nullptr,
                  TargetKind::Adjacent, TargetPick::First },
                { "major", "Raise Dead", raiseDead(),
                  {{P::Death, 3}}, S::Conjuration, 3, 26, 2, castRaiseDead,     nullptr,
                  EnchantAim::None, 0, nullptr,
                  TargetKind::Adjacent, TargetPick::First },
            }},
            // The symmetric one: an Everyone aim presses on both lines at once,
            // and only once however many instances stand.
            { "leaden_air", {
                { "battlefield", "Leaden Air", leadenAir(),
                  {{P::Death, 2}}, S::Enchantment, 2,
                  LEADEN_AIR_FATIGUE, 2, castLeadenAir, nullptr,
                  EnchantAim::Everyone, LEADEN_AIR_POOL_COST, tickLeadenAir,
                  TargetKind::Battlefield, TargetPick::First },
            }},
            // ── Holy — granted, not researched, so NO school gate (M-14) ─────
            { "bless", {
                { "minor", "Blessing", blessing(),
                  {{P::Holy, 1}}, S::None, 0, 10, 1, castBless,        nullptr,
                  EnchantAim::None, 0, nullptr,
                  TargetKind::AllyUnit, TargetPick::Broken },
                { "major", "Greater Blessing", greaterBlessing(),
                  {{P::Holy, 3}}, S::None, 0, 24, 2, castGreaterBless, nullptr,
                  EnchantAim::None, 0, nullptr,
                  TargetKind::AllyTeam, TargetPick::First },
            }},
            // ── Unholy — granted like Holy, and likewise ungated by school ───
            { "drain_life", {
                { "minor", "Drain Life", drainLife(),
                  {{P::Unholy, 1}}, S::None, 0, 14, 1, castDrainLife, nullptr,
                  EnchantAim::None, 0, nullptr,
                  TargetKind::EnemyUnit, TargetPick::Densest },
            }},
        };
        // A-1/A-8: every form learns which spell it belongs to, ONCE, after the
        // table exists. A form can then name itself — the resolver needs the id
        // to ask a unit whether it is already carrying this buff, and AI-2's
        // per-decision log line needs it to say which spell scored what. Wired
        // here rather than typed into fifteen rows, where it could only ever go
        // out of sync with the spell it sits under.
        static const bool wired = [] {
            for (Spell& spell : table)
                for (SpellForm& form : spell.forms) {
                    form.spell = &spell;
                    // A-3: and what it is worth, by the same lookup discipline.
                    form.worth = worthFor(spell.id, form.name);
                }
            return true;
        }();
        (void) wired;
        return table;
    }

    bool qualifies(const AUnit& caster, const SpellForm& form)
    {
        // M-6: the army knows, the caster qualifies. Research decides what
        // exists campaign-wide; path levels decide who can cast it.
        for (const PathRequirement& req : form.paths)
            if (caster.getPathLevel(req.path) < req.level) return false;
        // E-2: a form paid for out of the army's channel pool does not qualify while
        // the pool cannot cover it IN FULL. This is a real gate and not an
        // affordability test of the kind M-22 refused for fatigue: fatigue is
        // the caster's own and he may spend himself into the overflow, while
        // the pool is the army's and there is no such thing as overdrawing it.
        // A line that does not qualify is skipped and the walk goes on.
        if (form.poolCost > 0
            && Utility::getBattlefield().getChannels(caster.getTeam()) < form.poolCost)
            return false;
        // M-19: both sides pass the identical school gate; only where the
        // number comes from differs. SpellSchool::None has no gate at all,
        // which is what a pure-Holy blessing carries (M-14).
        if (form.school == SpellSchool::None) return true;
        return Utility::getBattlefield().getSchoolLevel(caster.getTeam(), form.school)
               >= form.schoolLevel;
    }

    // ── The resolver (A-1, A-8) ──────────────────────────────────────────────
    //
    // SIDE-EFFECT-FREE and DICE-FREE, both deliberately: AI-2 will call this
    // once per candidate form per decision, and a resolver that touched the
    // field would make the scorer a simulation (A-1 rules that out), while one
    // that rolled would eat the mock queue a combat test seeded under TESTING.
    // Nothing below writes to a unit or calls Utility::getRandom.

    std::vector<AUnit*> candidates(const AUnit& caster, const SpellForm& form)
    {
        std::vector<AUnit*> out;
        Battlefield& field = Utility::getBattlefield();
        const int myTeam = caster.getTeam();

        switch (form.target) {
        case TargetKind::EnemyUnit:
            // An unplaced caster has no position to measure from — the old
            // predicate read caster.getHex()->elevation and simply assumed one
            // (the shot bodies checked it before ever calling in). Answering
            // "nobody" is what makes the resolver safe to ask of ANY caster,
            // which a scorer will do.
            if (!caster.getHex()) break;
            for (const auto& u : field.getTeam(3 - myTeam))
                if (u && spellInRange(caster, *u, myTeam)) out.push_back(u.get());
            break;

        case TargetKind::AllyUnit:
        case TargetKind::AllyTeam:
            // NO range check, NO hex check, the caster INCLUDED: bless and
            // soothing_current never asked for a hex (only findAllyToAid did),
            // and a boon needs no position to land — a Ward still reaches a
            // man across the map. Whether a boon should carry a range is one of
            // the questions the deferred targeting front owns; AI-1 does not
            // answer it, and AI-2 restored the hexless case AI-1 had narrowed.
            for (const auto& u : field.getTeam(myTeam)) {
                if (!u || !u->getAlive()) continue;
                // A-8's refresh rule, and the whole of it: a man already
                // carrying this spell is not a candidate for it again.
                if (form.buff && form.spell && u->hasBuff(form.spell->id)) continue;
                out.push_back(u.get());
            }
            break;

        case TargetKind::Adjacent:
        case TargetKind::Battlefield:
        case TargetKind::None:
            // Nothing is aimed at. raise_dead scans its own neighbours and a
            // standing enchantment covers the field; neither has a unit target
            // to enumerate, so neither gets one.
            break;
        }
        return out;
    }

    Target chooseTarget(const AUnit& caster, const SpellForm& form)
    {
        Target picked;
        Battlefield& field = Utility::getBattlefield();
        const int myTeam = caster.getTeam();

        if (form.target == TargetKind::AllyTeam) {
            // The whole line at once, in team order — greater_bless walks it
            // exactly as it used to walk field.getTeam().
            picked.units = candidates(caster, form);
            return picked;
        }

        switch (form.pick) {
        case TargetPick::Densest: {
            // Run through Utility::findTarget over the TEAM rather than over
            // the candidate list, with the same two predicates in the same two
            // roles findEnemyInRange gave them: the walk, the priority return
            // and the sortsBefore tie-break are then the same ones, and the
            // spell aims at the man it has always aimed at.
            if (!caster.getHex()) break;
            picked.unit = Utility::findTarget(
                field.getTeam(3 - myTeam),
                [&caster](const AUnit& t, int team) { return spellInRange(caster, t, team); },
                [&caster](const AUnit& t, int team) { return spellDensityScore(caster, t, team); },
                myTeam);
            break;
        }
        case TargetPick::Wounded: {
            // findAllyToAid: the first ally who needs it, and otherwise the
            // first ally at all.
            std::vector<AUnit*> pool = candidates(caster, form);
            if (pool.empty()) break;
            picked.unit = pool.front();
            for (AUnit* u : pool)
                if (u->getHp() < u->getmaxHP()) { picked.unit = u; break; }
            break;
        }
        case TargetPick::Fatigued: {
            // soothing_current: the most exhausted body, and NOBODY when even
            // he is fresh — there is nothing to wash off a rested line.
            std::vector<AUnit*> pool = candidates(caster, form);
            AUnit* worst = nullptr;
            for (AUnit* u : pool)
                if (!worst || u->getFatigue() > worst->getFatigue()) worst = u;
            if (worst && worst->getFatigue() > 0) picked.unit = worst;
            break;
        }
        case TargetPick::Broken:
            // bless, unchanged down to the helpers: a broken man is taken
            // first (the priority predicate), and a wounded one scores.
            picked.unit = Utility::findTarget(
                field.getTeam(myTeam), isBroken, isWounded, myTeam);
            break;
        case TargetPick::First: {
            std::vector<AUnit*> pool = candidates(caster, form);
            if (!pool.empty()) picked.unit = pool.front();
            break;
        }
        }
        return picked;
    }

    const Spell* findSpell(std::string_view id)
    {
        for (const Spell& s : roster())
            if (s.id == id) return &s;
        return nullptr;
    }

    bool isBattlefieldSpell(const Spell& s)
    {
        for (const SpellForm& f : s.forms)
            if (f.enchantAim != EnchantAim::None) return true;
        return false;
    }

    // ── the scorer (A-1..A-7) ────────────────────────────────────────────────

    int scoreOf(const AUnit& caster, const SpellForm& form, const Target& target)
    {
        if (!form.worth) return 0;
        int worth = form.worth(caster, target);
        if (worth <= 0) return 0;
        return worth * AI_SCORE_SCALE / spellDivider(form);
    }

    std::vector<CastOption> optionsFor(const AUnit& caster, const Spell& spell, int floor)
    {
        // Best form per target: the key is the target unit (nullptr for the
        // kinds that hand over none), and a later form only replaces an earlier
        // one when it scores higher — never merely because it is stronger.
        std::vector<CastOption> best;
        auto offer = [&](const SpellForm& form, Target target) {
            int score = scoreOf(caster, form, target);
            if (score < floor || score <= 0) return;
            for (CastOption& o : best)
                if (o.target.unit == target.unit) {
                    if (score > o.score) { o.form = &form; o.target = std::move(target); o.score = score; }
                    return;
                }
            best.push_back({ &spell, &form, std::move(target), score });
        };
        for (const SpellForm& form : spell.forms) {
            if (!qualifies(caster, form)) continue;
            if (form.target == TargetKind::EnemyUnit || form.target == TargetKind::AllyUnit) {
                for (AUnit* u : candidates(caster, form)) {
                    Target t;
                    t.unit = u;
                    offer(form, std::move(t));
                }
            } else {
                offer(form, chooseTarget(caster, form));
            }
        }
        return best;
    }

    const std::vector<const Spell*>& defaultScript()
    {
        // M-22: the AI's ordered list IS a script, which is why slice 4 costs
        // almost nothing — the player's list replaces this one and no second
        // code path exists. Roster order is the default priority.
        //
        // EXCEPT the battlefield-wide enchantments, which are SCRIPT-ONLY
        // (E-3, implemented as the user put it: they are simply "not in the
        // spell list for normal casts"). One
        // of them spends the army's whole pool allowance on a single casting
        // and burns the side's one call for the battle, so only a deliberate
        // script line may reach for it — never the fallback walk a caster takes
        // when nothing better offers. The self-harming globals depend on this
        // too: Leaden Air presses on the caster's own line, and no AI default
        // should ever decide that on its own.
        //
        // AUnit::setChosenSpells appends THIS list after the player's ids, so
        // excluding them here is the whole of the rule: a global is reachable
        // only by being named.
        static const std::vector<const Spell*> script = [] {
            std::vector<const Spell*> out;
            for (const Spell& s : roster())
                if (!isBattlefieldSpell(s)) out.push_back(&s);
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
                    // A-4: the divider the scorer actually uses (auto or override),
                    // so a screen can show the price the AI weighs a spell at.
                    {"divider",     spellDivider(form)},
                    // On EVERY row, false/0 for an ordinary spell rather than
                    // present only where it is interesting: the campaign server
                    // renders the pool price from these (E-2 adds no new wire
                    // field beyond them), and a reader that has to ask whether a
                    // key exists is a reader that will one day forget to.
                    {"battlefield", form.enchantAim != EnchantAim::None},
                    {"poolCost",    form.poolCost},
                    // A-1: what the form TARGETS, said out loud instead of
                    // buried in the description's prose. On every row for the
                    // same reason poolCost is: a reader that has to ask whether
                    // a key exists is a reader that will one day forget to.
                    // Nothing campaign-side reads these yet — AI-2/AI-3 are the
                    // slices that will.
                    {"target",      std::string(targetKindName(form.target))},
                    {"buff",        form.buff},
                });
            }
        }
        return json{{"spells", spells}}.dump();
    }
}
