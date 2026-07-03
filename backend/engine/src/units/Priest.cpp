


#include "units/Priest.hpp"

Priest::Priest(int setTeam) noexcept: Human::Human(setTeam, MeleeWeapons::MaceAndShield)
{
    setSpellcaster(true);
    printSymbol    = 'P';
    preferredRange = 3;
    setBallisticSkill(4);
    size = SIZE;
} 

Priest::Priest() noexcept {
        setSpellcaster(true);
}

static bool isWounded(const AUnit &unit, int myTeam)
{
    (void) myTeam;
    return unit.getHp() < unit.getmaxHP();
}

static bool isBroken(const AUnit &unit, int myTeam)
{
    (void) myTeam;
    return unit.getBroken();
}


void Priest::castBless(void)
{
    if (mana <= 0 || broken || alive == false)
        return;
   
    if (getCast() > 0)
    {
        setCast(getCast() - 1);
        return;
    }    
    
   AUnit *target = nullptr;
    
    target = Utility::findTarget(Utility::getBattlefield().getTeam(getTeam()), isBroken, isWounded, getTeam());

    if (target == nullptr)
        return;
    mana--;

    if (target->getBroken())
    {
        Utility::getBattlefield().logEvent("The divine healing helps a soldier find his courage");
        target->setBroken(false);
    }
    else
        Utility::getBattlefield().logEvent("The divine healing helps a soldier");
    target->heal(1 + Utility::throwDice());
    target->recover();
    setCast(2);
    
}

void Priest::special()
{
    castBless();
}