#pragma once
#include "unistd.h"
#include <memory>

class Armor;

class BodyPart
{
    public:
    BodyPart();
    ~BodyPart() = default;


    private:
        size_t maxDamage;
        std::shared_ptr<Armor> armor;
        
    
};