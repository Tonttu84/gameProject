#pragma once

#include "AUnit.hpp"
#include "vector"
#include "Utility.hpp"
#include "Human.hpp"


class Soldier : public Human
{
    public:
        static constexpr int SIZE = 10;

        Soldier(int setTeam) noexcept;
        ~Soldier() noexcept = default ;

};