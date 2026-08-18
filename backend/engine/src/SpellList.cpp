#include "SpellList.hpp"
#include "AUnit.hpp"
#include "Battlefield.hpp"
#include "BattleSetup.hpp"
#include "RangedCombat.hpp"
#include "UnitCatalog.hpp"
#include "Utility.hpp"
#include "units/Zombie.hpp"
#include "units/Skeleton.hpp"
#include <algorithm>

// Effect bodies moved verbatim from Mage::special(), Priest::castBless() and
// Necromancer::raiseDead()/placeZombie()/placeSkeleton() in Stage R0
// (docs/UNITS_AS_DATA_PLAN.md). Common gating — alive/broken/hex checks, mana
// affordability, cooldown ticking, mana spend, setCast() — lives in
// AUnit::castSpells(); each body only targets and applies.

// ── fireball ──────────────────────────────────────────────────────────────────

// Find the highest-value enemy within spell range, preferring dense hexes.
static AUnit* findFireballTarget(AUnit& caster)
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

static bool castFireball(AUnit& caster)
{
    if (!caster.getHex()) return false;
    AUnit* aimUnit = findFireballTarget(caster);
    if (!aimUnit || !aimUnit->getHex()) return false;

    RangedShot shot;
    shot.baseDamage      = FIREBALL_CENTRE;
    shot.accuracy        = caster.getAccuracy();
    shot.pen             = ArmorPen::Normal;
    // Secondary blast hits: shrapnel from the detonation, landing on the same
    // hex as the primary shot regardless of whether the primary found a target.
    shot.secondaryHits   = FIREBALL_SECONDARY;
    shot.secondaryDamage = FIREBALL_BLAST;

    RangedCombat::fire(&caster, aimUnit, shot);
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

static bool castRaiseDead(AUnit& caster)
{
    if (!caster.getHex()) return false;
    Battlefield& myBattle = Utility::getBattlefield();

    auto nbCoords = myBattle.hexGrid.neighbors(caster.getHex()->coord);

    if (myBattle.getCorpses() == 0) {
        // No fresh corpses — conjure a skeleton from ancient bones at no corpse cost
        for (const HexCoord& nc : nbCoords) {
            if (placeSkeleton(caster, myBattle.hexGrid.getHex(nc))) break;
        }
    } else {
        size_t summons = (myBattle.getCorpses() >= 3) ? 3 : 1;
        if (myBattle.getCorpses() >= 3)
            myBattle.setCorpses(myBattle.getCorpses() - 3);

        for (const HexCoord& nc : nbCoords) {
            if (!summons) break;
            if (placeZombie(caster, myBattle.hexGrid.getHex(nc))) summons--;
        }
    }
    // The old raiseDead() paid mana and cooldown even when no placement
    // succeeded — casting happened, the grave soil just didn't cooperate.
    return true;
}

// ── the roster ────────────────────────────────────────────────────────────────

namespace Spells
{
    const std::vector<Spell>& roster()
    {
        static const std::vector<Spell> table = {
            // id            mana  cooldown  requirement          effect
            { "fireball",    1,    0,        {"Mage"},            castFireball  },
            { "bless",       1,    2,        {"Priest"},          castBless     },
            { "raise_dead",  1,    6,        {"Necromancer"},     castRaiseDead },
        };
        return table;
    }

    std::vector<const Spell*> forUnitType(std::string_view unitTypeName)
    {
        std::vector<const Spell*> known;
        for (const Spell& s : roster())
            if (s.requirement.exactUnitType.empty()
                || s.requirement.exactUnitType == unitTypeName)
                known.push_back(&s);
        return known;
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
}
