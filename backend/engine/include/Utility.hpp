#pragma once
#include "Defines.hpp"
#include <vector>
#include <memory>

#include <random>
#ifdef TESTING
#include <queue>
#endif
#include "Battlefield.hpp"
#include <iostream>
#include <functional>



class Utility
{
public:
        static int throwDice();

        static AUnit* findTarget(const std::vector<std::unique_ptr<AUnit>>& targets, const std::function<bool(const AUnit&, int)>& validPriorityTarget, \
        const std::function<int(const AUnit&, int)>& validTarget, int myTeam);
        static Battlefield &getBattlefield();
        static Hex* Deviate(const Hex& source, int targetQ, int targetR, int accuracy);
        static int getRandom(int lowerBound, int upperBound);
        static int calcDistance(const Hex* a, const Hex* b);

#ifdef TESTING
        static void pushDiceRoll(int value);
        static void clearDiceRolls();
#endif

    private:
        static std::mt19937 gen;
#ifdef TESTING
        static std::queue<int> mockValues;
#endif
        Utility() = delete;
        ~Utility() = delete;
};

