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

// T-2: ONE range rule, for every kind. Two PLACED bodies, the distance between
// them, and the height difference clamped to the ranged cap coming off it —
// which is what findEnemyInRange's `inRange` lambda always did for an enemy.
// The change TG-1 makes is not the arithmetic, it is who is measured: a boon
// used to check no range at all, and now goes through this same predicate
// against its own row's `range`. Team is deliberately NOT tested here — the
// callers know which side they are walking.
static bool withinRange(const AUnit& caster, const AUnit& target, int range)
{
    if (!caster.getHex() || !target.getHex()) return false;
    int dist  = Utility::calcDistance(target.getHex(), caster.getHex());
    int tiers = std::clamp(caster.getHex()->elevation - target.getHex()->elevation,
                           -ELEV_RANGED_CAP, ELEV_RANGED_CAP);
    return dist - tiers <= range;
}

// The enemy predicate: alive, on the other side, and in the form's range.
static bool spellInRange(const AUnit& caster, const AUnit& target, int myTeam, int range)
{
    if (!target.getAlive() || target.getTeam() == myTeam) return false;
    return withinRange(caster, target, range);
}

// findEnemyInRange's `scoreTarget`, unchanged apart from the range it is told:
// prefer densely packed hexes at closer range. Its -1 cases are exactly the
// predicate's false cases, which is why it is written on top of it.
static int spellDensityScore(const AUnit& caster, const AUnit& target, int myTeam, int range)
{
    if (!spellInRange(caster, target, myTeam, range)) return -1;
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

// A-8, as T-5 rebuilt it: a `buff` form's body RECORDS what it did on the man
// it landed on (AUnit::applyEffect), and Spells::candidates() then keeps that
// form off him for as long as the effect stands. The id a body passes must be
// the ROSTER id of the spell it belongs to (form.spell->id) — the sweep in
// test_targeting.cpp is what holds the literal and the row together.
//
// Boon or bane: T-5 widened the rule to both sides, so the exclusion below is
// asked of an enemy candidate as much as of an ally one. A debuff that stacked
// every tick was the same bug A-8 closed for buffs, wearing the other hat.
static bool alreadyCarries(const SpellForm& form, const AUnit& unit)
{
    return form.buff && form.spell && unit.hasBuff(form.spell->id);
}

// ── how a shot spell arrives (T-1, slice TG-1) ───────────────────────────────
//
// The one place a damage body hands its RangedShot over, so "precise or not" is
// decided once from the row rather than four times from memory. Before TG-1
// every one of these rode RangedCombat::fire() and was therefore an ARROW —
// deviated, and then rolled against the archer's aimed-shot chance on top. T-1
// splits that in two: a precise row strikes, an imprecise one scatters and the
// scatter IS its miss (assistant's call 1).
//
// The body no longer sets shot.accuracy at all: the effective number is the
// caster's stat plus the row's modifier, and delivery is told it outright.
static void deliver(AUnit& caster, const SpellForm& form, AUnit& aimUnit, const RangedShot& shot)
{
    if (spellPrecise(form)) RangedCombat::strike(&caster, &aimUnit, shot);
    else RangedCombat::scatter(&caster, &aimUnit, shot, spellAccuracy(caster, form));
}

// ── Fire — fireball (Evocation) ──────────────────────────────────────────────

// The minor form: a single bolt, no blast. What keeps a Fire 1 caster useful,
// exactly as Dominions' early-generation spells do (M-12).
static bool castEmber(AUnit& caster, const SpellForm& form, const Target& target)
{
    // The caster's own hex is not targeting — a shot is fired FROM somewhere,
    // so an unplaced caster has nothing to fire from. Kept in the body for the
    // same reason it was always here.
    if (!caster.getHex()) return false;
    AUnit* aimUnit = target.unit;
    if (!aimUnit || !aimUnit->getHex()) return false;

    RangedShot shot;
    shot.baseDamage = EMBER_DAMAGE + caster.getPathLevel(SpellPath::Fire);
    shot.pen        = ArmorPen::Normal;

    deliver(caster, form, *aimUnit, shot);
    return true;
}

static bool castFireball(AUnit& caster, const SpellForm& form, const Target& target)
{
    if (!caster.getHex()) return false;
    AUnit* aimUnit = target.unit;
    if (!aimUnit || !aimUnit->getHex()) return false;

    RangedShot shot;
    // M-20: the blast grows with the caster's FIRE level and nothing else.
    shot.baseDamage = FIREBALL_CENTRE + caster.getPathLevel(SpellPath::Fire);
    shot.pen        = ArmorPen::Normal;
    // T-6: the AREA is read off the ROW rather than typed here, so the catalog
    // the player reads and the blast he is hit by cannot say different things —
    // the delivery sweep pins the agreement. Only the per-body damage is the
    // body's own, being an effect number like the centre damage above it.
    shot.areaMode   = form.areaMode;
    shot.areaPoints = form.area;
    shot.areaDamage = FIREBALL_BLAST;

    deliver(caster, form, *aimUnit, shot);
    return true;
}

// ── Air — shock (Evocation) ──────────────────────────────────────────────────
// Less damage than fire, but it goes where it is aimed — and since T-1 that
// sentence is the ROW's, not a constant this body reads: shock is written
// SPELL_PRECISE, so delivery strikes instead of scattering.
static bool castShock(AUnit& caster, const SpellForm& form, const Target& target)
{
    if (!caster.getHex()) return false;
    AUnit* aimUnit = target.unit;
    if (!aimUnit || !aimUnit->getHex()) return false;

    RangedShot shot;
    shot.baseDamage = SHOCK_DAMAGE + caster.getPathLevel(SpellPath::Air);
    shot.pen        = ArmorPen::Piercing;   // lightning cares little for plate

    deliver(caster, form, *aimUnit, shot);
    return true;
}

// ── Earth — stoneskin (Enchantment) ──────────────────────────────────────────
// A `buff` form (A-8): the resolver has already dropped every ally who is
// carrying this spell, so a target arriving here is not already skinned — and
// recording the effect keeps it that way for as long as the effect stands.
//
// T-5: ONE call does both jobs. applyEffect moves the stat through applyStatMod
// exactly as before AND records what actually landed, so the armour comes back
// off when the effect expires or the battle ends. The duration is the ROW's —
// 0 on this row, which is "the whole battle", and the field is what would make
// a timed stoneskin a one-line change.
static bool castStoneskin(AUnit& caster, const SpellForm& form, const Target& target)
{
    AUnit* unit = target.unit;
    if (!unit) return false;
    unit->applyEffect("stoneskin", "armour",
                      1 + caster.getPathLevel(SpellPath::Earth) / 3, form.duration);
    Utility::getBattlefield().logEvent("Skin hardens to stone");
    return true;
}

// ── Water — soothing current (Enchantment) ───────────────────────────────────
// Water does not heal wounds; it washes off exhaustion. With M-2 making fatigue
// lethal past the ceiling, that is a real save and not a minor one.
// TargetPick::Fatigued hands over the most exhausted body and NOBODY when the
// tiredest man on the line is at zero — the "nothing to wash off" case the old
// body tested for itself.
static bool castSoothingCurrent(AUnit& caster, const SpellForm& /*form*/, const Target& target)
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
// T-5: the barrier itself is a CONSUMABLE shield layer, so the registry entry
// this body records changes no number (an empty stat, applied 0). It is there
// for the refresh rule — one ward per man while it stands — and the layer is
// not reverted at battle end but CLEARED with the rest of the shield stack in
// restoreForNextBattle(), because a layer that was rolled against is spent and
// there is nothing to put back.
static bool castWard(AUnit& caster, const SpellForm& form, const Target& target)
{
    AUnit* unit = target.unit;
    if (!unit) return false;
    unit->addShield(WARD_STRENGTH + caster.getPathLevel(SpellPath::High));
    unit->applyEffect("ward", "", 0, form.duration);
    Utility::getBattlefield().logEvent("A ward shimmers into place");
    return true;
}

// ── Nature — briar snare (Enchantment) ───────────────────────────────────────
// One of the three rows tagged Negates (T-4). A direct-effect body contests the
// resistance AT THE TOP, for its one target, and a body that shrugs it off takes
// nothing — while the CAST still reports true, because it happened: M-23's rule
// is about a spell that never fired, and this one fired and was thrown off.
static bool castBriarSnare(AUnit& caster, const SpellForm& form, const Target& target)
{
    AUnit* unit = target.unit;
    if (!unit) return false;
    if (Spells::resisted(caster, form, *unit)) return true;
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
static bool castSoothingWinds(AUnit& caster, const SpellForm& /*form*/, const Target& /*target*/)
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

static bool castLeadenAir(AUnit& caster, const SpellForm& /*form*/, const Target& /*target*/)
{
    return Utility::getBattlefield().beginEnchantment(caster, "leaden_air");
}

// ── Unholy — drain life (granted, not researched: M-14) ──────────────────────
static bool castDrainLife(AUnit& caster, const SpellForm& form, const Target& target)
{
    if (!caster.getHex()) return false;   // a shot needs somewhere to come from
    AUnit* unit = target.unit;
    if (!unit || !unit->getHex()) return false;
    int drain = DRAIN_DAMAGE + caster.getPathLevel(SpellPath::Unholy);

    RangedShot shot;
    shot.baseDamage = drain;
    shot.pen        = ArmorPen::Piercing;
    // T-4: a SHOT body hands the contest to the shot rather than asking it
    // here, because delivery is what knows which bodies were struck — an area
    // would contest each of them separately. Checked before anything else
    // happens to a body, so a man who shrugs it off takes no damage AND gives
    // the caster nothing: onDamage never runs for him.
    //
    // The captures outlive the call: `shot` is a local handed straight to
    // deliver(), which resolves it before this frame returns.
    shot.resisted   = [&caster, &form](AUnit* victim) {
        return victim && Spells::resisted(caster, form, *victim);
    };
    // What is taken from them is given to the caster — the whole point of the
    // spell, so it hangs off the damage hook rather than being paid blind.
    shot.onDamage   = [](AUnit* attacker, AUnit* /*victim*/, int damage) {
        if (attacker) attacker->heal(damage / 2);
    };

    deliver(caster, form, *unit, shot);
    return true;
}

// ── Low — hex of frailty (Enchantment), and its price (M-21/M-24) ────────────
//
// The row that exercises BOTH of TG-3's rules at once, deliberately: it is
// tagged Negates (T-4) and it is the one row on the roster with a real
// `duration` (T-5), so the expiry machinery is walked by a spell rather than by
// a test alone.
//
// The two rules meet in an order that matters. The contest runs FIRST — a hex
// that was shrugged off leaves nothing standing, so there is nothing to expire
// — and the body still reports true either way, which means M-24's price fires
// on a resisted cast exactly as it does on a landed one. That is not an
// oversight: the bargain was struck when the caster reached for it, and what
// the enemy made of the spell is not the creditor's problem.
static bool castHexOfFrailty(AUnit& caster, const SpellForm& form, const Target& target)
{
    AUnit* unit = target.unit;
    if (!unit) return false;
    if (Spells::resisted(caster, form, *unit)) return true;
    unit->applyEffect("hex_of_frailty", "defence",
                      -(1 + caster.getPathLevel(SpellPath::Low) / 3), form.duration);
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

static bool castBless(AUnit& /*caster*/, const SpellForm& /*form*/, const Target& target)
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
static bool castGreaterBless(AUnit& caster, const SpellForm& /*form*/, const Target& target)
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
static bool castRaiseSkeleton(AUnit& caster, const SpellForm& /*form*/, const Target& /*target*/)
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
static bool castRaiseDead(AUnit& caster, const SpellForm& /*form*/, const Target& /*target*/)
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
    // Ordered to match AreaMode, guarded exactly as the kinds above are: a mode
    // inserted in the middle would otherwise rename every mode after it on the
    // wire, and the campaign layer would be told a spell spreads a way it does not.
    constexpr std::string_view kAreaModeNames[] = { "none", "explosion", "random" };
    static_assert(sizeof(kAreaModeNames) / sizeof(kAreaModeNames[0])
                  == static_cast<size_t>(AreaMode::Random) + 1);
    static_assert(kAreaModeNames[static_cast<size_t>(AreaMode::None)]      == "none");
    static_assert(kAreaModeNames[static_cast<size_t>(AreaMode::Explosion)] == "explosion");
    static_assert(kAreaModeNames[static_cast<size_t>(AreaMode::Random)]    == "random");
    // Ordered to match ResistKind, guarded exactly as the two above are, and for
    // the same reason: a kind inserted in the middle would rename every kind
    // after it on the wire and the campaign layer would be told a spell can be
    // shrugged off in a way it cannot.
    constexpr std::string_view kResistKindNames[] = { "none", "negates" };
    static_assert(sizeof(kResistKindNames) / sizeof(kResistKindNames[0])
                  == static_cast<size_t>(ResistKind::Negates) + 1);
    static_assert(kResistKindNames[static_cast<size_t>(ResistKind::None)]    == "none");
    static_assert(kResistKindNames[static_cast<size_t>(ResistKind::Negates)] == "negates");
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

// ── T-1's two questions (slice TG-1) ─────────────────────────────────────────
//
// Pure and tiny, and free functions rather than members of SpellForm for the
// same reason spellDivider() is one: a row is aggregate-initialised data, and
// the rules ABOUT a row live beside the roster that authors it.

bool spellPrecise(const SpellForm& form)
{
    return form.accuracy >= SPELL_PRECISE;
}

int spellAccuracy(const AUnit& caster, const SpellForm& form)
{
    // T-1: 100 flat when precise — the caster's own stat does not enter into it
    // (user: "100 ignores the caster accuracy and just hits"). Otherwise the
    // stat is the base and the row's signed modifier moves it, clamped to the
    // 0..100 the whole ranged layer speaks in. Elevation is NOT applied here:
    // it needs the two hexes and belongs to the shot, not to the row.
    if (spellPrecise(form)) return SPELL_PRECISE;
    return std::clamp(caster.getAccuracy() + form.accuracy, 0, SPELL_PRECISE);
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

std::string_view areaModeName(AreaMode m)
{
    return kAreaModeNames[static_cast<size_t>(m)];
}

std::string_view resistKindName(ResistKind k)
{
    return kResistKindNames[static_cast<size_t>(k)];
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
           "the caster commands. The blast then spreads outward from where it fell "
           "over " + std::to_string(FIREBALL_AREA / AREA_CHUNK)
         + " men's worth of ground, and every body it covers takes "
         + std::to_string(FIREBALL_BLAST)
         + " — friend and foe alike, your own line included.";
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

// T-4/T-5: the two sentences a resistible or a timed row owes the player,
// built like every other clause here — from the constants and from the ROW,
// never typed out. A form's tag and its duration are facts about what the
// player is buying, and The Study's numbers line says them too; the
// description is where they are said in words.
const std::string kResistible =
    " A strong enough will can throw it off entirely.";

std::string standsFor(int ticks)
{
    return " It lasts " + std::to_string(ticks) + " ticks.";
}

std::string briarSnare()
{
    return "Briars erupt and drag at one enemy" + kRange + ": "
         + std::to_string(SNARE_FATIGUE)
         + " fatigue inflicted, and 5 more for every level of Nature. "
           "Exhaustion is lethal past the ceiling." + kResistible;
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
           "of Low." + standsFor(HEX_FRAILTY_DURATION) + kResistible
         + " Then the bargain takes its due, whether the hex held or not: "
         + std::to_string(LOW_BLOOD_PRICE)
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
         + ", piercing armour — and half of what lands returns to the caster as healing."
         + kResistible;
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

static int worthEmber(const AUnit& c, const SpellForm& form, const Target& t)
{
    // T-1: the hit chance the estimator prices is the FORM's effective accuracy,
    // not the caster's raw stat — a precise row is worth what it is worth
    // because it lands, and a row with a modifier is worth what the modifier
    // makes it. This is the whole of TG-1's change to the scorer.
    return worthDamage(EMBER_DAMAGE + c.getPathLevel(SpellPath::Fire),
                       spellAccuracy(c, form), t);
}

// ── what an AREA is worth (assistant's call 2, T-7 — slice TG-2) ─────────────
//
// The candidate stays the enemy unit: an area form aims at a MAN, and the blast
// is what happens around him. What the estimator adds to the centre's worth is
// a FULL-COVERAGE estimate with no dice in it — for every hex the area would
// reach with P points, each body other than the aimed man is struck with the
// ARC-OVERLAP probability min(100, (P + size) × 100 / 640) percent, the chance
// that a P-slot arc starting anywhere overlaps a body `size` slots wide.
//
// NETTED (T-7): a body on the caster's own side counts NEGATIVE, in A-3's one
// currency and with no new number. That is the whole of "friendly fire is real"
// as the AI sees it — a fireball into a melee your own line is holding prices
// itself out, and nothing had to forbid it.
//
// Deliberately ignored: the elevation damage bonus, and the accuracy — the
// aimed man's own term already carries the latter through worthDamage, and a
// scattered blast covers a hex either way. PURE: it reads hex->units and the
// ring walk, never the slot cache (which would MUTATE it) and never the dice.
static int worthAreaOnHex(const AUnit& c, const Hex* hex, int points,
                          const AUnit* aimed, int areaDamage)
{
    if (!hex) return 0;
    int worth = 0;
    for (const AUnit* u : hex->units) {
        if (!u || u == aimed || !u->getAlive()) continue;
        int chance = std::min(100, (points + static_cast<int>(u->getSize())) * 100
                                   / Hex::CAPACITY);
        int share  = areaDamage * chance * u->getValue() / (100 * AI_DAMAGE_SCALE);
        worth += (u->getTeam() == c.getTeam()) ? -share : share;
    }
    return worth;
}

// Written generically rather than inside worthFireball: the second area spell
// is a roster row away, and its estimator should be one line.
static int worthArea(const AUnit& c, const SpellForm& form, const Target& t, int areaDamage)
{
    if (!t.unit || !t.unit->getHex() || form.area <= 0 || areaDamage <= 0) return 0;
    const Hex* centre = t.unit->getHex();
    int worth = 0;

    if (form.areaMode == AreaMode::Explosion) {
        // The same walk coverArea makes, minus the rotation roll: which hexes
        // are reached does not depend on it, only the order they are reached in.
        int left = form.area;
        for (int k = 0; left > 0; ++k) {
            std::vector<Hex*> ring = RangedCombat::ringHexes(centre, k);
            if (k > 0 && ring.empty()) break;
            for (const Hex* h : ring) {
                if (left <= 0) break;
                int give = std::min(left, Hex::CAPACITY);
                worth += worthAreaOnHex(c, h, give, t.unit, areaDamage);
                left  -= give;
            }
        }
    } else if (form.areaMode == AreaMode::Random) {
        // No dice to model, so the honest expectation is the total spread EVENLY
        // over the ring set the chunks would be drawn from.
        std::vector<Hex*> set;
        for (int k = 0; ; ++k) {
            std::vector<Hex*> ring = RangedCombat::ringHexes(centre, k);
            if (k > 0 && ring.empty()) break;
            set.insert(set.end(), ring.begin(), ring.end());
            if (static_cast<int>(set.size()) * Hex::CAPACITY >= form.area) break;
        }
        if (set.empty()) return 0;
        int each = form.area / static_cast<int>(set.size());
        for (const Hex* h : set) worth += worthAreaOnHex(c, h, each, t.unit, areaDamage);
    }
    return worth;
}

static int worthFireball(const AUnit& c, const SpellForm& form, const Target& t)
{
    // The man it lands on, priced like every other bolt, plus what the blast
    // does to everyone else standing in it — his own side subtracted (T-7).
    return worthDamage(FIREBALL_CENTRE + c.getPathLevel(SpellPath::Fire),
                       spellAccuracy(c, form), t)
         + worthArea(c, form, t, FIREBALL_BLAST);
}

static int worthShock(const AUnit& c, const SpellForm& form, const Target& t)
{
    // No constant named here any more: shock's "it lands" is its row's
    // SPELL_PRECISE, and the estimator reads the row like every other one.
    return worthDamage(SHOCK_DAMAGE + c.getPathLevel(SpellPath::Air),
                       spellAccuracy(c, form), t);
}

static int worthDrainLife(const AUnit& c, const SpellForm& form, const Target& t)
{
    int drain = DRAIN_DAMAGE + c.getPathLevel(SpellPath::Unholy);
    int worth = worthDamage(drain, spellAccuracy(c, form), t);
    // Half of what lands comes back — worth something only to a wounded caster.
    if (worth > 0 && c.getHp() < c.getmaxHP())
        worth += (drain / 2) * c.getValue() / AI_DAMAGE_SCALE;
    return worth;
}

static int worthBriarSnare(const AUnit& c, const SpellForm& /*form*/, const Target& t)
{
    int fatigue = SNARE_FATIGUE + c.getPathLevel(SpellPath::Nature) * 5;
    return worthDamage(fatigue / AI_FATIGUE_PER_DAMAGE, 100, t);
}

// A buff's candidates already exclude a body carrying it (A-8), so a fresh
// target is worth a share of itself and the marked ones never reach here.
static int worthBuff(const AUnit&, const SpellForm&, const Target& t)
{
    return t.unit ? t.unit->getValue() * AI_BUFF_WORTH_PCT / 100 : 0;
}

static int worthSoothingCurrent(const AUnit& c, const SpellForm& /*form*/, const Target& t)
{
    if (!t.unit || t.unit->getFatigue() <= 0) return 0;
    int relief = std::min(t.unit->getFatigue(),
                          SOOTHING_RELIEF + c.getPathLevel(SpellPath::Water) * 5);
    return (relief / AI_FATIGUE_PER_DAMAGE) * t.unit->getValue() / AI_DAMAGE_SCALE;
}

static int worthHexOfFrailty(const AUnit& c, const SpellForm& /*form*/, const Target& t)
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

static int worthBless(const AUnit&, const SpellForm&, const Target& t)
{
    return t.unit ? blessWorthOf(*t.unit) : 0;
}

static int worthGreaterBless(const AUnit& c, const SpellForm& /*form*/, const Target& t)
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

static int worthRaiseSkeleton(const AUnit& c, const SpellForm&, const Target&)
{
    return c.getHex() ? AI_SKELETON_WORTH : 0;
}

static int worthRaiseDead(const AUnit& c, const SpellForm&, const Target&)
{
    if (!c.getHex()) return 0;
    size_t want = static_cast<size_t>(RAISE_DEAD_BODIES + c.getPathLevel(SpellPath::Death) / 3);
    if (Utility::getBattlefield().getCorpses() < want) return 0;   // the body would fail (M-26)
    return static_cast<int>(want) * AI_ZOMBIE_WORTH;
}

// A battlefield enchantment is script-only (E-3), so its worth only ever meets
// the script floor: a flat number that says "worth calling", nothing finer.
static int worthGlobal(const AUnit&, const SpellForm&, const Target&)
{
    return AI_GLOBAL_WORTH;
}

// The worth each row carries, looked up by spell id and form name so the table
// below stays positional and untouched — the same reasoning as the back-pointer.
static int (*worthFor(std::string_view spellId, std::string_view formName))(const AUnit&, const SpellForm&, const Target&)
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
        //
        // TG-1 adds TWO MORE after the buff slot, and every row now writes its
        // buff flag out loud so it can reach them: ACCURACY then RANGE (T-1,
        // T-2). Accuracy is a signed modifier on the caster's own stat, and
        // SPELL_PRECISE means the row just lands — which is what most of this
        // table already was, since a body that applied its effect directly never
        // rolled to hit anything. Only fireball's two forms are imprecise, and
        // they are the two that were always thrown rather than laid on. Range is
        // SPELLRANGE everywhere for now; the number is balance-deferred and the
        // FIELD is the point, so a row can differ the day one should.
        //
        // TG-2 adds TWO MORE after the range: the AREA MODE and the area's size
        // in hex points (T-6). They are DESCRIPTIVE — the body reads them off
        // its own row to fill the shot — and `AreaMode::None, 0` on every row
        // but fireball's major form, which is the only thing on the roster that
        // covers ground rather than a man.
        //
        // TG-3 adds THREE MORE after the area: the RESIST KIND, its signed
        // MODIFIER and the DURATION (T-4, T-5). Three rows are tagged
        // ResistKind::Negates — hex_of_frailty, briar_snare and drain_life,
        // the spells that work on a man rather than on the air around him —
        // and every other row is None and cannot be resisted at all. The
        // modifier is 0 everywhere: Dominions' "resisted easily" is a number
        // this table can now write, and today nothing needs to. The duration
        // is 0 (the whole battle) everywhere but the hex, which is deliberate
        // — one real timed row means the expiry is walked by a spell and not
        // only by a test.
        static std::vector<Spell> table = {
            // ── Fire ─────────────────────────────────────────────────────────
            { "fireball", {
                { "minor", "Ember", ember(),
                  {{P::Fire, 1}}, S::Evocation, 1,  8, 1, castEmber,    nullptr,
                  EnchantAim::None, 0, nullptr,
                  TargetKind::EnemyUnit, TargetPick::Densest, false, 0, SPELLRANGE,
                  AreaMode::None, 0,
                  ResistKind::None, 0, 0 },
                { "major", "Fireball", fireball(),
                  {{P::Fire, 3}}, S::Evocation, 3, 22, 2, castFireball, nullptr,
                  EnchantAim::None, 0, nullptr,
                  TargetKind::EnemyUnit, TargetPick::Densest, false, 0, SPELLRANGE,
                  // The one area on the roster (T-6): an EXPLOSION of
                  // FIREBALL_AREA points, filling the hex it lands on and
                  // opening the ring outward when it has more than that to give.
                  AreaMode::Explosion, FIREBALL_AREA,
                  ResistKind::None, 0, 0 },
            }},
            // ── Air ──────────────────────────────────────────────────────────
            { "shock", {
                { "minor", "Shock", shock(),
                  {{P::Air, 1}}, S::Evocation, 1, 10, 1, castShock, nullptr,
                  EnchantAim::None, 0, nullptr,
                  // PRECISE: what SHOCK_ACCURACY used to say, said as a rule.
                  TargetKind::EnemyUnit, TargetPick::Densest, false,
                  SPELL_PRECISE, SPELLRANGE,
                  AreaMode::None, 0,
                  ResistKind::None, 0, 0 },
            }},
            // ── Earth ────────────────────────────────────────────────────────
            { "stoneskin", {
                { "minor", "Stoneskin", stoneskin(),
                  {{P::Earth, 1}}, S::Enchantment, 1, 10, 1, castStoneskin, nullptr,
                  EnchantAim::None, 0, nullptr,
                  TargetKind::AllyUnit, TargetPick::Wounded, true,
                  SPELL_PRECISE, SPELLRANGE,
                  AreaMode::None, 0,
                  ResistKind::None, 0, 0 },
            }},
            // ── Water ────────────────────────────────────────────────────────
            { "soothing_current", {
                { "minor", "Soothing Current", soothingCurrent(),
                  {{P::Water, 1}}, S::Enchantment, 1, 8, 1, castSoothingCurrent, nullptr,
                  EnchantAim::None, 0, nullptr,
                  TargetKind::AllyUnit, TargetPick::Fatigued, false,
                  SPELL_PRECISE, SPELLRANGE,
                  AreaMode::None, 0,
                  ResistKind::None, 0, 0 },
            }},
            // ── High ─────────────────────────────────────────────────────────
            { "ward", {
                { "minor", "Ward", ward(),
                  {{P::High, 1}}, S::Enchantment, 2, 12, 1, castWard, nullptr,
                  EnchantAim::None, 0, nullptr,
                  TargetKind::AllyUnit, TargetPick::Wounded, true,
                  SPELL_PRECISE, SPELLRANGE,
                  AreaMode::None, 0,
                  ResistKind::None, 0, 0 },
            }},
            // ── Nature ───────────────────────────────────────────────────────
            { "briar_snare", {
                { "minor", "Briar Snare", briarSnare(),
                  {{P::Nature, 1}}, S::Enchantment, 1, 10, 1, castBriarSnare, nullptr,
                  EnchantAim::None, 0, nullptr,
                  TargetKind::EnemyUnit, TargetPick::Densest, false,
                  SPELL_PRECISE, SPELLRANGE,
                  AreaMode::None, 0,
                  ResistKind::Negates, 0, 0 },
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
                  // Nothing is aimed at, so precise is the honest value and the
                  // range is never read.
                  TargetKind::Battlefield, TargetPick::First, false,
                  SPELL_PRECISE, SPELLRANGE,
                  AreaMode::None, 0,
                  ResistKind::None, 0, 0 },
            }},
            // ── Low — half fatigue (M-21) and a price that fires with it (M-24)
            { "hex_of_frailty", {
                { "minor", "Hex of Frailty", hexOfFrailty(),
                  {{P::Low, 1}}, S::Enchantment, 1, 14, 1,
                  castHexOfFrailty, priceOfFrailty,
                  EnchantAim::None, 0, nullptr,
                  // `buff` TRUE since T-5, and it is a bane: a standing effect
                  // the target keeps is one the resolver must not relay, on the
                  // enemy side exactly as on its own. Without it the right play
                  // was to re-hex the same man every tick forever.
                  TargetKind::EnemyUnit, TargetPick::Densest, true,
                  SPELL_PRECISE, SPELLRANGE,
                  AreaMode::None, 0,
                  // The row that carries BOTH of TG-3's rules: resistible
                  // (T-4) and the only real duration on the roster (T-5).
                  ResistKind::Negates, 0, HEX_FRAILTY_DURATION },
            }},
            // ── Death ────────────────────────────────────────────────────────
            { "raise_dead", {
                { "minor", "Raise Skeleton", raiseSkeleton(),
                  {{P::Death, 1}}, S::Conjuration, 1, 12, 1, castRaiseSkeleton, nullptr,
                  EnchantAim::None, 0, nullptr,
                  TargetKind::Adjacent, TargetPick::First, false,
                  SPELL_PRECISE, SPELLRANGE,
                  AreaMode::None, 0,
                  ResistKind::None, 0, 0 },
                { "major", "Raise Dead", raiseDead(),
                  {{P::Death, 3}}, S::Conjuration, 3, 26, 2, castRaiseDead,     nullptr,
                  EnchantAim::None, 0, nullptr,
                  TargetKind::Adjacent, TargetPick::First, false,
                  SPELL_PRECISE, SPELLRANGE,
                  AreaMode::None, 0,
                  ResistKind::None, 0, 0 },
            }},
            // The symmetric one: an Everyone aim presses on both lines at once,
            // and only once however many instances stand.
            { "leaden_air", {
                { "battlefield", "Leaden Air", leadenAir(),
                  {{P::Death, 2}}, S::Enchantment, 2,
                  LEADEN_AIR_FATIGUE, 2, castLeadenAir, nullptr,
                  EnchantAim::Everyone, LEADEN_AIR_POOL_COST, tickLeadenAir,
                  TargetKind::Battlefield, TargetPick::First, false,
                  SPELL_PRECISE, SPELLRANGE,
                  AreaMode::None, 0,
                  ResistKind::None, 0, 0 },
            }},
            // ── Holy — granted, not researched, so NO school gate (M-14) ─────
            { "bless", {
                { "minor", "Blessing", blessing(),
                  {{P::Holy, 1}}, S::None, 0, 10, 1, castBless,        nullptr,
                  EnchantAim::None, 0, nullptr,
                  TargetKind::AllyUnit, TargetPick::Broken, false,
                  SPELL_PRECISE, SPELLRANGE,
                  AreaMode::None, 0,
                  ResistKind::None, 0, 0 },
                { "major", "Greater Blessing", greaterBlessing(),
                  {{P::Holy, 3}}, S::None, 0, 24, 2, castGreaterBless, nullptr,
                  EnchantAim::None, 0, nullptr,
                  TargetKind::AllyTeam, TargetPick::First, false,
                  SPELL_PRECISE, SPELLRANGE,
                  AreaMode::None, 0,
                  ResistKind::None, 0, 0 },
            }},
            // ── Unholy — granted like Holy, and likewise ungated by school ───
            { "drain_life", {
                { "minor", "Drain Life", drainLife(),
                  {{P::Unholy, 1}}, S::None, 0, 14, 1, castDrainLife, nullptr,
                  EnchantAim::None, 0, nullptr,
                  // (bd) A DELIBERATE CHANGE, not a transcription: drain life
                  // used to ride the archer's pipeline and could take a
                  // bystander in the hex. Precise now — the life is pulled out
                  // of the man it was pulled out of.
                  TargetKind::EnemyUnit, TargetPick::Densest, false,
                  SPELL_PRECISE, SPELLRANGE,
                  AreaMode::None, 0,
                  ResistKind::Negates, 0, 0 },
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
            for (const auto& u : field.getTeam(3 - myTeam)) {
                if (!u || !spellInRange(caster, *u, myTeam, form.range)) continue;
                // T-5 widened A-8's refresh rule to BANES: a man already
                // carrying this spell is not a candidate for it again, whichever
                // side he stands on. Before TG-3 this branch had no such check,
                // because no enemy-targeted form was a standing effect.
                if (alreadyCarries(form, *u)) continue;
                out.push_back(u.get());
            }
            break;

        case TargetKind::AllyUnit:
        case TargetKind::AllyTeam: {
            // T-2: RANGE-CHECKED NOW, by the same predicate and the same
            // elevation clamp the enemy kinds use — one rule for range. A Ward
            // across the map was a hole, and closing it gives a priest a place
            // to stand. (Until TG-1 this branch checked no range and no hex at
            // all, which is the comment that used to sit here.)
            //
            // THE CASTER IS ALWAYS HIS OWN CANDIDATE, first in the list and
            // whether or not he stands anywhere: a boon on yourself crosses no
            // distance, so an unplaced caster still has himself. Everyone else
            // needs two placed bodies within the form's range.
            auto offer = [&](AUnit* u) {
                if (!u || !u->getAlive()) return;
                // A-8's refresh rule, and the whole of it: a man already
                // carrying this spell is not a candidate for it again.
                if (alreadyCarries(form, *u)) return;
                out.push_back(u);
            };
            // const_cast, and it is the honest one: the resolver takes its
            // caster BY CONST REF to advertise that asking changes nothing, and
            // the team vector it walks holds that very same body as a mutable
            // pointer. Every caller passes a unit it owns mutably.
            offer(const_cast<AUnit*>(&caster));
            for (const auto& u : field.getTeam(myTeam)) {
                if (!u || u.get() == &caster) continue;
                if (!withinRange(caster, *u, form.range)) continue;
                offer(u.get());
            }
            break;
        }

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
            const int range = form.range;   // T-2: the row's reach, not a constant
            // This pick walks the TEAM rather than candidates(), to keep
            // findTarget's tie-break — so the refresh rule has to be repeated
            // here or a standing bane would be re-aimed at the same man every
            // tick while candidates() quietly said he was not a candidate. The
            // two are the same predicate; only the walk differs.
            picked.unit = Utility::findTarget(
                field.getTeam(3 - myTeam),
                [&caster, &form, range](const AUnit& t, int team) {
                    return spellInRange(caster, t, team, range) && !alreadyCarries(form, t);
                },
                [&caster, &form, range](const AUnit& t, int team) {
                    return alreadyCarries(form, t) ? -1
                                                   : spellDensityScore(caster, t, team, range);
                },
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
        case TargetPick::Broken: {
            // bless: a broken man is taken first, and a wounded one is the
            // fallback — Utility::findTarget's two roles, walked here over the
            // CANDIDATES instead of over the whole team, because T-2 gave a boon
            // a range and this pick would otherwise reach past it. The walk is
            // otherwise findTarget's own, tie-break included: the first wounded
            // man holds the slot until one who sortsBefore him turns up.
            std::vector<AUnit*> pool = candidates(caster, form);
            AUnit* wounded = nullptr;
            for (AUnit* u : pool) {
                if (isBroken(*u, myTeam)) { picked.unit = u; break; }
                if (!isWounded(*u, myTeam)) continue;
                if (!wounded || u->sortsBefore(wounded)) wounded = u;
            }
            if (!picked.unit) picked.unit = wounded;
            break;
        }
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

    // ── Resistance: the contest, and the estimate of it (T-4) ────────────────
    //
    // Two functions saying the same thing to two different audiences. The first
    // ROLLS, once, for one body, at delivery time. The second is what the
    // scorer may ask as often as it likes and must never roll — A-1's rule, and
    // the reason the estimate is an approximation rather than the exact
    // distribution of two exploding dice.

    // How far past the form's own requirement the caster has taken its PRIMARY
    // path (M-20 again: the primary is what a spell is cast WITH). The user's
    // "+1 per extra path" — mastery beyond what the spell needs is what pushes
    // it through a will. Never negative: a caster who does not meet the
    // requirement cannot cast the form at all, so there is no case to model.
    static int pathMastery(const AUnit& caster, const SpellForm& form)
    {
        if (form.paths.empty()) return 0;
        const PathRequirement& primary = form.paths.front();
        return std::max(0, caster.getPathLevel(primary.path) - primary.level);
    }

    bool resisted(const AUnit& caster, const SpellForm& form, AUnit& target)
    {
        // An untagged form draws NOTHING. Not "rolls and always wins" — a draw
        // here would eat a mock roll a combat test seeded for the shot itself,
        // and most of the roster is untagged, so this is the common path.
        if (form.resist == ResistKind::None) return false;

        // Caster first, then target, both through the exploding die — so a test
        // pins the contest with four pushes: caster face, caster explode-check,
        // target face, target explode-check.
        const int casterTotal = RESIST_BASE + pathMastery(caster, form)
                              + caster.getPenetration() + Utility::throwDice();
        const int targetTotal = target.getResistance() + form.resistMod
                              + Utility::throwDice();
        // STRICTLY higher: a tie goes to the body. The spell has to beat the
        // will, not merely match it.
        if (casterTotal > targetTotal) return false;

        Utility::getBattlefield().logEvent(LogTier::Detail,
            target.logName() + " shrugs off " + std::string(form.label));
        return true;
    }

    int landChancePct(const AUnit& caster, const SpellForm& form, const AUnit& target)
    {
        // A flat certainty rather than "don't ask", so a caller can multiply
        // unconditionally. SPELL_PRECISE is the top of the same 0..100 scale a
        // percentage lives on — the constant's own comment says so — and an
        // untagged form is exactly as certain as a precise one is to arrive.
        if (form.resist == ResistKind::None) return SPELL_PRECISE;

        // The dice are dropped because they CANCEL in expectation — both sides
        // throw the same die — so what is left is the difference between the two
        // fixed totals. An even chance at parity (the 2 below is not a tunable:
        // two equal totals are two equal totals), RESIST_PCT_PER_POINT per point
        // from there, and clamped short of both ends.
        const int expectedCaster = RESIST_BASE + pathMastery(caster, form)
                                 + caster.getPenetration();
        const int expectedTarget = target.getResistance() + form.resistMod;
        return std::clamp(SPELL_PRECISE / 2
                              + (expectedCaster - expectedTarget) * RESIST_PCT_PER_POINT,
                          RESIST_CHANCE_MIN_PCT, RESIST_CHANCE_MAX_PCT);
    }

    // ── the scorer (A-1..A-7) ────────────────────────────────────────────────

    int scoreOf(const AUnit& caster, const SpellForm& form, const Target& target)
    {
        if (!form.worth) return 0;
        int worth = form.worth(caster, form, target);
        if (worth <= 0) return 0;
        // T-4: expected effect × the chance it lands. Applied HERE rather than
        // inside each estimator, so a new resistible spell gets it for free and
        // cannot forget it — and applied to the WORTH, before the divider, so
        // the ratio A-4 compares forms on is a ratio of expected value.
        //
        // For a form with a unit target only. An AREA body would resist per
        // body covered (that is what RangedShot::resisted does), and the
        // estimator does not model that — no area form is tagged today, and the
        // day one is, worthArea() is where the per-body chance belongs rather
        // than this single multiplier.
        if (target.unit)
            worth = worth * landChancePct(caster, form, *target.unit) / 100;
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

    bool awaitsRange(const AUnit& caster, const Spell& spell)
    {
        bool qualified = false;
        for (const SpellForm& form : spell.forms) {
            if (!qualifies(caster, form)) continue;
            qualified = true;
            if (form.target != TargetKind::EnemyUnit) return false;
            if (!candidates(caster, form).empty()) return false;
        }
        return qualified;
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
                    // T-1/T-2, and on EVERY row for the same reason as the two
                    // above: `accuracy` is the row's signed modifier (100 on a
                    // precise row), `precise` is that same fact as the boolean a
                    // reader actually wants, and `range` is how far the form
                    // reaches. The Study prints all three (S3-4) — they are the
                    // first delivery numbers a player has ever been shown.
                    {"accuracy",    form.accuracy},
                    {"precise",     spellPrecise(form)},
                    {"range",       form.range},
                    // T-6/T-7 (TG-2), and on every row for the same reason: how
                    // the form's blast spreads and how much ground it covers, in
                    // hex size points (640 = one whole hex). "none" and 0 on
                    // everything that is not an area spell — the pair is a
                    // biconditional, pinned on both sides of the wire.
                    {"areaMode",    std::string(areaModeName(form.areaMode))},
                    {"area",        form.area},
                    // T-4/T-5 (TG-3), and on every row for the same reason as
                    // everything above: `resist` is "none" or "negates",
                    // `resistMod` the signed number on the target's side of the
                    // contest, and `duration` how many ticks what the form
                    // leaves behind stands — 0 being the whole battle. The
                    // Study prints the last two as words (S3-4).
                    {"resist",      std::string(resistKindName(form.resist))},
                    {"resistMod",   form.resistMod},
                    {"duration",    form.duration},
                });
            }
        }
        return json{{"spells", spells}}.dump();
    }
}
