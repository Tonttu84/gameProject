#include "units/LightCavalry.hpp"
#include "units/Horse.hpp"
#include "units/Human.hpp"
#include "units/Soldier.hpp"

namespace {

// Rider-only kit — never placed or cataloged on its own, so it lives here
// rather than in the unit catalog. Light loadout: spear, light armour, no
// shield; javelin-trained (the composite copies this ballistic skill).
class LightRider : public Human
{
public:
    explicit LightRider(int setTeam) : Human(setTeam, MeleeWeapons::Spear)
    {
        armour    = LIGHTARMOUR;
        attackPWR = 10;
        defence   = 11; // unburdened — harder to pin down than a mailed Soldier
        setBallisticSkill(8);
        size = Soldier::SIZE;
    }
};

} // namespace

LightCavalry::LightCavalry(int setTeam)
: Cavalry(setTeam, std::make_unique<LightRider>(setTeam), std::make_unique<Horse>(setTeam))
{
    printSymbol   = 'l';
    movementSpeed = 3; // light load — outpaces heavy Cavalry's 2
}
