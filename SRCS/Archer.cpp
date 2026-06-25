#include "../HDRS/Archer.hpp"


Archer::Archer(int setTeam) noexcept: Human::Human(setTeam, MeleeWeapons::Shortsword)
{
    printSymbol = 'A';
    ammunition  = BOWAMMO;
    armour      = LIGHTARMOUR;
    // accuracy is used as a 0-100 percentage: aimed-shot success chance and
    // aimed range (accuracy/10 hexes). 50 → 50% chance, 5-hex aimed range.
    accuracy       = 50;
    preferredRange = 3; // hold bow range; drops to 1 when ammo runs out
}

Archer::Archer() noexcept {
    printSymbol = 'A';
    ammunition = BOWAMMO;
}

int Archer::calcUnitValue(const AUnit& targetUnit, int myTeam)
{
    if (!targetUnit.getAlive())
        return 0;

    int retval;
    if (BOWDAMAGE + 2 > targetUnit.getArmour())
    {
        int pen = BOWDAMAGE + 2 - targetUnit.getArmour();
        retval = (pen > targetUnit.getHp() ? targetUnit.getHp() + 2 : pen) * targetUnit.getValue();
    }
    else
        retval = targetUnit.getValue();

    return targetUnit.getTeam() == myTeam ? retval * -1 : retval;
}

int Archer::calcShot(const AUnit& target, int myTeam)
{
    assert(target.getHex() && "Input with a target that doesn't have a location");
    int distance = Utility::calcDistance(target.getHex(), getHex());

    if (distance > BOWMAXRANGE || !target.getAlive())
        return -1;

    Battlefield& myBattle = Utility::getBattlefield();
    int retval = calcUnitValue(target, myTeam) * 2;

    auto nbCoords = myBattle.hexGrid.neighbors(target.getHex()->coord);
    for (const HexCoord& nc : nbCoords) {
        Hex* nh = myBattle.hexGrid.getHex(nc);
        if (!nh) continue;
        for (AUnit* u : nh->units)
            if (u) retval += calcUnitValue(*u, myTeam);
    }

    if (retval <= 1)
        return retval;
    return retval * accuracy / distance + Utility::throwDice();
}


bool Archer::accurateShot(const AUnit &target, int myTeam)
{
    if (!target.getAlive() || target.getTeam() == myTeam)
        return false;
    return Utility::calcDistance(target.getHex(), getHex()) < accuracy;
}


AUnit* Archer::findArcherTarget()
{
    auto shotCalculator = [this](const AUnit& target, int myTeam) -> int {
        return this->calcShot(target, myTeam);
    };
    auto findShot = [this](const AUnit& target, int myTeam) -> bool {
        return this->accurateShot(target, myTeam);
    };

    return Utility::findTarget(
        Utility::getBattlefield().getTeam(3 - getTeam()),
        findShot, shotCalculator, getTeam());
}


// Slot table: built once per hex at the start of each archery phase and kept
// for the whole phase. Units that die during the phase stay in the table —
// arrows don't have infinite speed, so hitting a freshly-dead unit is fine.
struct SlotCache {
    std::vector<AUnit*> units; // units present when the phase began
};
static std::unordered_map<const Hex*, SlotCache> gSlotCache;

// Call once at the start of every archery phase to clear the previous phase's data.
void resetArcheryCache() { gSlotCache.clear(); }

// Return (or build) the slot list for a hex. Built at most once per phase.
static const SlotCache& getSlotCache(const Hex* hex)
{
    auto it = gSlotCache.find(hex);
    if (it != gSlotCache.end()) return it->second;

    SlotCache& sc = gSlotCache[hex];
    for (AUnit* u : hex->units)
        if (u) sc.units.push_back(u);
    return sc;
}

// Pick a random unit in a hex weighted by size.
// Treat the hex as a 640-slot pool: roll 1–640 and find which unit's
// cumulative size range covers the roll. A hex with 3 size-10 humans
// occupies slots 1-10, 11-20, 21-30; the remaining 610 slots are empty,
// so most rolls miss — modelling arrows flying past a thin line.
// Returns nullptr if the hex was empty at phase start, or the shot missed
// everyone (empty slots). Returns a dead unit if they died earlier this phase
// — the arrow still hits, it just does nothing.
static AUnit* pickHexTarget(const Hex* hex)
{
    const SlotCache& sc = getSlotCache(hex);
    if (sc.units.empty()) return nullptr;

    int roll = Utility::getRandom(1, Hex::CAPACITY);
    int cumulative = 0;
    for (AUnit* u : sc.units) {
        cumulative += static_cast<int>(u->getSize());
        if (roll <= cumulative) return u;
    }
    return nullptr; // arrow hit empty ground
}

// Returns the spentMove cost (3) if a shot was fired, 0 otherwise.
int Archer::fireBow()
{
    if (broken || !alive || spentMove || ammunition == 0)
        return 0;

    AUnit* aimUnit = findArcherTarget();
    if (!aimUnit || !aimUnit->getHex())
        return 0;

    int dist = Utility::calcDistance(getHex(), aimUnit->getHex());
    // Deviate may land the shot in an adjacent hex based on range and accuracy.
    Hex* targetHex = Utility::Deviate(*getHex(), aimUnit->getHex()->coord.q,
                                      aimUnit->getHex()->coord.r, accuracy);
    ammunition--;
    if (ammunition == 0) preferredRange = 1; // out of arrows — advance to melee

    if (!targetHex) return 3;

    AUnit* targetUnit = nullptr;

    // Aimed range scales with accuracy: accuracy/10 hexes.
    // A human archer (accuracy=50) can aim individually up to 5 hexes away.
    // A gaze/mind-blast unit (accuracy=99) covers nearly the full bow range.
    int aimedRange = accuracy / 10;

    if (dist <= aimedRange && Utility::getRandom(1, 100) <= accuracy) {
        // Aimed individual shot: accuracy is the percentage success chance.
        // If the target stepped out of the landed hex, fall back to a hex hit.
        targetUnit = (aimUnit->getAlive() && aimUnit->getHex() == targetHex)
                   ? aimUnit : pickHexTarget(targetHex);
    } else {
        // Normal range or failed aim: arrow lands in a hex and hits whoever
        // is there. Weighted random so larger units are harder to miss.
        targetUnit = pickHexTarget(targetHex);
    }

    if (!targetUnit || !targetUnit->getAlive()) return 3; // missed or hit a corpse

    if (targetUnit->getShield() > 0 && Utility::throwDice() <= targetUnit->getShield())
    {
        int damage = BOWDAMAGE - SHIELDREDUCTION + Utility::throwDice() - Utility::throwDice();
        if (damage > 0)
        {
            targetUnit->setShield(targetUnit->getShield() - 1);
            targetUnit->takeDamage(damage);
        }
    }
    else
        targetUnit->takeDamage(BOWDAMAGE + Utility::throwDice() - Utility::throwDice());

    return 3;
}

void Archer::special()
{
    spentMove = fireBow();
}
