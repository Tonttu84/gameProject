


#include "../HDRS/Priest.hpp"

Priest::Priest(int setTeam) noexcept: Human::Human(setTeam)
{
    setSpellcaster(true);
    printSymbol = 'P';
} 

Priest::Priest() noexcept {
        setSpellcaster(true);
}

static bool isWounded(const AUnit &unit, int myTeam)
{
    (void) myTeam;
    if (unit.getHp() < unit.getmaxHP())
        return 1;
    return 0;

}

static bool isBroken(const AUnit &unit, int myTeam)
{
    (void) myTeam;
    if (unit.getBroken())
        return 1;
    return 0;
    
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

    if (target->getBroken() == true)
    {   std::cout << "The divine healing helps a soldier find his courage" << std::endl;
        target->setBroken(false);
        target->heal(1 + Utility::throwDice());
        setCast(2);
    } 
    else 
    {
        std::cout << "The divine healing helps a soldier" << std::endl;
        target->heal(1 + Utility::throwDice());
        setCast(2);
    }
    
}

void Priest::special()
{
    castBless();
}