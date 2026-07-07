#pragma once

#include "AUnit.hpp"
#include "Utility.hpp"
#include "Human.hpp"

class Priest : public Human
{
    public:
        static constexpr int SIZE = 10;

        Priest(int setTeam) noexcept;
        Priest() noexcept;
        ~Priest() noexcept = default ;
};
