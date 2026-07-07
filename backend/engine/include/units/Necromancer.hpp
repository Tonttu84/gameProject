#pragma once

#include "AUnit.hpp"
#include "Utility.hpp"
#include "Human.hpp"

class Necromancer : public Human
{
    public:
        static constexpr int SIZE = 10;

        Necromancer(int setTeam) noexcept;
        Necromancer() noexcept;
        ~Necromancer() noexcept = default ;
};
