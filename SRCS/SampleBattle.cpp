#include "../HDRS/SampleBattle.hpp"
#include "../HDRS/BattleSetup.hpp"
#include "../HDRS/Soldier.hpp"
#include "../HDRS/Archer.hpp"
#include "../HDRS/Mage.hpp"
#include "../HDRS/Priest.hpp"
#include "../HDRS/Necromancer.hpp"

void setupSampleBattle(Battlefield& field)
{
    // Red: undead horde — soldiers, archers, necromancers raising zombies
    Army red;
    appendArmy<Soldier>     (red, 500, REDTEAM);
    appendArmy<Archer>      (red, 150, REDTEAM);
    appendArmy<Necromancer> (red,  10, REDTEAM);
    randomPlaceArmy(red, field, {0, field.width - 1, field.height * 3/4, field.height - 1});

    // Blue: holy order — soldiers, archers, mages and priests
    Army blue;
    appendArmy<Soldier>(blue, 450, BLUETEAM);
    appendArmy<Archer> (blue, 150, BLUETEAM);
    appendArmy<Mage>   (blue,  7, BLUETEAM);
    appendArmy<Priest> (blue,  7, BLUETEAM);
    randomPlaceArmy(blue, field, {0, field.width - 1, 0, field.height / 4});

    field.loadArmies(std::move(red), std::move(blue));
}
