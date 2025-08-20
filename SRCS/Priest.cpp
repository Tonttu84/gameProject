


#include "../HDRS/Priest.hpp"

Priest::Priest(int setTeam) noexcept: AUnit::AUnit(setTeam)
{
    setSpellcaster(true);
} 

Priest::Priest() noexcept {
        setSpellcaster(true);
}

static bool isWounded(const AUnit &unit)
{
    if (unit.getHp() < unit.getmaxHP())
        return 1;
    return 0;

}

static bool isBroken(const AUnit &unit)
{
    if (unit.getBroken())
        return 1;
    return 0;
    
}


void Priest::castBless(void)
{
    if (mana <= 0 || broken || alive == false)
        return;
   
    
   AUnit *target = nullptr;
    if (getTeam() == 1)
        target = Utility::findTarget(Utility::getBattlefield().getTeamRED(), isBroken, isWounded);
    else if (getTeam() == 2) 
        target = Utility::findTarget(Utility::getBattlefield().getTeamBLUE(),isBroken ,isWounded);

    if (target == nullptr)
        return;
    mana--;

    if (target->getBroken() == true)
    {   std::cout << "The divine healing helps a soldier find his courage" << std::endl;
        target->setBroken(false);
        target->heal(1 + Utility::throwDice());
    } 
    else 
    {
        std::cout << "The divine healing helps a soldier" << std::endl;
        target->heal(1 + Utility::throwDice());
    }
    
}

void Priest::special()
{
    castBless();
}