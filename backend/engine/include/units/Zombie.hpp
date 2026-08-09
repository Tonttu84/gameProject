#pragma once
#include <unistd.h>
#include "BodyPart.hpp"
#include "AUnit.hpp"

class TODO;
class Hittable;

class Zombie : public AUnit
{

    public:
        static constexpr int SIZE = 10;

        size_t takeHit(TODO source, TODO type);
        void attacks(); //  cycles through all attacks
        ~Zombie() noexcept = default;
        Zombie(const Zombie &target) = default;
        
        Zombie(int team);

    protected:

        
    
};