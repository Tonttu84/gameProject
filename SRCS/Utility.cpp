/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Utility.cpp                                        :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@hive.fi>                +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/17 13:00:08 by jrimpila          #+#    #+#             */
/*   Updated: 2025/10/04 17:23:16 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#include "../HDRS/Utility.hpp"
#include "../HDRS/Battlefield.hpp"



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

    std::mt19937 Utility::gen(std::random_device{}());
#ifdef TESTING
    std::queue<int> Utility::mockValues;
#endif

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

        auto it = targets.begin();
        while (it != targets.end())
        {
            if ((*it)->getAlive() == false)
            {
                it++;
                continue;
            }    
            if (validPriorityTarget(*(*it), myTeam))
            {
                return (&*(*it));
            }
            int targetValue = 0;
            if (validTarget(*(*it), myTeam) > targetValue)
                {
                    targetValue = (validTarget(*(*it), myTeam));
                    secondary = &*(*it);
                }
            it++;
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
        int deviation = (accuracy > 0) ? dist / accuracy : 40;
        if (deviation > 40) deviation = 40;
        while (deviation) {
            targetQ += getRandom(-1, 1);
            targetR += getRandom(-1, 1);
            --deviation;
        }
        return getBattlefield().hexGrid.safeGetHex(targetQ, targetR);
    }

    sf::Font Utility::font;
    void Utility::load()
    {
        if (!font.loadFromFile("assets/fonts/DejaVuSans.ttf")) // or any placeholder
        {std::cerr << "Fatal: Could not load font\n";
        std::exit(EXIT_FAILURE);
        }
    }
    
