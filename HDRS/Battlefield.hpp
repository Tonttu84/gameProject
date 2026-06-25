#pragma once
#include "Defines.hpp"
#include "HexGrid.hpp"
#include "AUnit.hpp"
#include <array>
#include <unistd.h>
#include <iostream>
#include <vector>
#include <climits>
#include "Utility.hpp"
#include <SFML/Graphics.hpp>

using Army = std::vector<std::unique_ptr<AUnit>>;

struct BattleResult
{
    int winner;
    Army redSurvivors;
    Army blueSurvivors;
    size_t corpses;
};

class Battlefield
{
    public:
        sf::RenderWindow *window = nullptr;
        HexGrid hexGrid;

        Battlefield();
        ~Battlefield() = default;
        Battlefield(Battlefield &cpy) = delete;
        Battlefield &operator=(Battlefield &target) = default;

        void print(void);
        void printText(int turn = -1) const;
        static constexpr int height = BATTLEFIELD_HEIGHT;
        static constexpr int width  = BATTLEFIELD_WIDTH;

        size_t countTeam(const int team) const;
        void moveUnits(void);
        void makeBattle(void);

        void loadArmies(Army red, Army blue);
        void reset(); // clear hex occupancy and corpse count between battles
        bool tick();
        BattleResult extractResult();

        std::vector<std::unique_ptr<AUnit>> &getTeam(int team);
        Hex* findTarget(const AUnit &searcher) const;

        int  moveAUnit(AUnit &unit, HexCoord target);
        void moveToward(std::unique_ptr<AUnit> &unit, const Hex* target);
        void moveTeam(std::vector<std::unique_ptr<AUnit>> &team);
        void flee(std::unique_ptr<AUnit> &unit);
        void swapOut(std::unique_ptr<AUnit> &unit);
        void retreatToRange(std::unique_ptr<AUnit> &unit);
        void cleanup();
        void triggerSpecialPhase();
        void resolveEngagements();

        size_t getCorpses();
        void   setCorpses(size_t setCorpses);

    private:
        std::vector<std::unique_ptr<AUnit>> teamRED;
        std::vector<std::unique_ptr<AUnit>> teamBLUE;
        size_t corpses = 0;
};
