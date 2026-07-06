#pragma once

#include "Human.hpp"
#include "Defines.hpp"

class Mage : public Human
{
    public:
        static constexpr int SIZE = 10;

        Mage(int setTeam) noexcept;
        Mage() noexcept;
        ~Mage() noexcept = default;
};
