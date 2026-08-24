#pragma once
#include <unistd.h>
#include "BodyPart.hpp"
#include "AUnit.hpp"

class TODO;
class Hittable;

class Human : public AUnit
{

    public:
        size_t takeHit(TODO source, TODO type);
        void attacks(); //  cycles through all attacks
        Human() = default;
        ~Human() noexcept = default;
        Human(const Human &target) = default;
        
        Human(int team, Weapon weapon);

        // Body plan (5-6): the shared humanoid layout, declared ONCE here and
        // inherited by Soldier, RoyalGuard, Pikeman, Militia, Archer, Mage,
        // Priest and Necromancer. A humanoid subclass that wants a different
        // plan overrides this; none does today.
        const Anatomy& anatomy() const override { return anatomy::HUMANOID; }

    protected:
        Hittable HitTable();
        BodyPart Head;
        BodyPart Body;
        BodyPart leftArm;
        BodyPart rightArm;
        BodyPart leftLeg;
        BodyPart rightLeg;
        
        
    
};