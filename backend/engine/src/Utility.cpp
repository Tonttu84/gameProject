#include <algorithm>
#include "Utility.hpp"
#include "Battlefield.hpp"



int Utility::calcDistance(const Hex* a, const Hex* b)
{
    if (!a || !b) return -1;
    return HexGrid::distance(a->coord, b->coord);
}

int Utility::throwDice()
{
   
    int result = getRandom(1, 6);

    if (getRandom(1, 6) == 6)
        return result += throwDice();
    
    return result;
}

    // Random per run by default — a fixed seed would make the suite green and
    // blind, hiding exactly the rare-draw bugs it is there to catch. But the
    // seed is chosen ONCE, here, and kept, so a failure is replayable:
    // GAME_RNG_SEED=<value> repeats the entire draw sequence.
    //
    // Caveat worth knowing before chasing a CI failure locally: mt19937 is
    // portable, but std::uniform_int_distribution is not specified to give the
    // same mapping across standard-library implementations. Same seed + same
    // toolchain reproduces; a different libstdc++ may not.
    static unsigned int resolveSeed()
    {
        if (const char* env = std::getenv("GAME_RNG_SEED")) {
            errno = 0;
            char* end = nullptr;
            const unsigned long v = std::strtoul(env, &end, 10);
            if (end != env && errno == 0)
                return static_cast<unsigned int>(v);
            std::cerr << "GAME_RNG_SEED is not a number, ignoring: " << env << '\n';
        }
        return std::random_device{}();
    }

    unsigned int Utility::seed = resolveSeed();
    std::mt19937 Utility::gen(Utility::seed);

    unsigned int Utility::rngSeed() { return seed; }
#ifdef TESTING
    std::queue<int> Utility::mockValues;
    std::queue<int> Utility::lotteryValues;
#endif

    int Utility::lotteryRoll(int total)
    {
        if (total < 1) total = 1;
#ifdef TESTING
        if (!lotteryValues.empty()) {
            int val = lotteryValues.front();
            lotteryValues.pop();
            return std::clamp(val, 1, total);
        }
#endif
        std::uniform_int_distribution<int> dist(1, total);
        return dist(gen);
    }

    int Utility::getRandom(int lowerBound, int upperBound)
    {
        assert(lowerBound <= upperBound && "lowerBound must be <= upperBound");
#ifdef TESTING
        if (!mockValues.empty()) {
            int val = mockValues.front();
            mockValues.pop();
            return val;
        }
#endif
        std::uniform_int_distribution<int> dist(lowerBound, upperBound);
        return dist(gen);
    }

#ifdef TESTING
    void Utility::pushDiceRoll(int value)
    {
        mockValues.push(value);
    }

    void Utility::pushLotteryRoll(int value)
    {
        lotteryValues.push(value);
    }

    void Utility::clearLotteryRolls()
    {
        while (!lotteryValues.empty()) lotteryValues.pop();
    }

    void Utility::clearDiceRolls()
    {
        while (!mockValues.empty())
            mockValues.pop();
    }
#endif

AUnit* Utility::findTarget(const std::vector<std::unique_ptr<AUnit>>& targets, const std::function<bool(const AUnit&, int)>& validPriorityTarget, const std::function<int(const AUnit&, int)>& validTarget,
    int myTeam)
   {
      
        if (targets.begin() == targets.end())
        {
            return nullptr;
        }

        AUnit* secondary = nullptr;
        int maxScore = 0;

        for (auto it = targets.begin(); it != targets.end(); ++it)
        {
            if (!(*it)->getAlive()) continue;
            if (validPriorityTarget(*(*it), myTeam))
                return &*(*it);
            int score = validTarget(*(*it), myTeam);
            if (score > maxScore) {
                maxScore  = score;
                secondary = &*(*it);
            } else if (score == maxScore && score > 0 && (*it)->sortsBefore(secondary)) {
                secondary = &*(*it);
            }
        }
        return secondary;
    }

    Battlefield &Utility::getBattlefield()
    {
        static Battlefield myBattlefield;
        return myBattlefield;

    }
    
    Hex* Utility::Deviate(const Hex& source, int targetQ, int targetR, int accuracy)
    {
        int dist = HexGrid::distance(source.coord, {targetQ, targetR});
        int deviation = (accuracy > 0) ? dist / accuracy : MAX_DEVIATION;
        if (deviation > MAX_DEVIATION) deviation = MAX_DEVIATION;
        while (deviation) {
            targetQ += getRandom(-1, 1);
            targetR += getRandom(-1, 1);
            --deviation;
        }
        return getBattlefield().hexGrid.safeGetHex(targetQ, targetR);
    }

