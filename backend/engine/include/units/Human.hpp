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

    protected:
        Hittable HitTable();
        BodyPart Head;
        BodyPart Body;
        BodyPart leftArm;
        BodyPart rightArm;
        BodyPart leftLeg;
        BodyPart rightLeg;
        
        
    
};