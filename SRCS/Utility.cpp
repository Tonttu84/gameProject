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



ssize_t Utility::calcDistance(const Cell *target,const Cell *source)
{
    if (!target || !source)
        return -1;
    ssize_t hDist = std::abs(target->hLoc - source->hLoc);
    ssize_t wDist = std::abs(target->wLoc - source->wLoc);
    if (hDist > wDist)
        return hDist;
    return wDist;
}

int Utility::throwDice()
{
   
    int result = getRandom(1, 6);

    if (getRandom(1, 6) == 6)
        return result += throwDice();
    
    return result;
}

    std::mt19937 Utility::gen(std::random_device{}());

    int Utility::getRandom(int lowerBound, int upperBound) 
    {
        assert(lowerBound <= upperBound && "lowerBound must be <= upperBound");
        std::uniform_int_distribution<int> dist(lowerBound, upperBound);
        return dist(gen);
    }

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
    
    Cell *Utility::Deviate(const Cell &source, int targetH, int targetW, int accuracy)
    {
        int distance;
        int hDiff = std::abs(targetH - source.hLoc);
        int wDiff = std::abs(targetW - source.wLoc);
        int deviation = 40;

        if (hDiff > wDiff)
            distance = hDiff;
        else 
            distance = wDiff;
        if (accuracy > 0)
            deviation = distance / accuracy;
        if (deviation > 40)
            deviation = 40;
        while (deviation)
        {
            targetH = targetH + getRandom(-1, 1);
            targetW = targetW + getRandom(-1, 1);
            deviation--;
        }

        return (getBattlefield().safeGetCell(targetH, targetW));    
    }

    sf::Font Utility::font;
    void Utility::load()
    {
        if (!font.loadFromFile("assets/fonts/DejaVuSans.ttf")) // or any placeholder
        {std::cerr << "Fatal: Could not load font\n";
        std::exit(EXIT_FAILURE);
        }
    }
    
     Cell *Utility::FindPriorityTarget(const std::vector<std::unique_ptr<AUnit>>& targetTeam, const std::function<int(const AUnit&, int)>& validPriorityTarget, int myTeam)
    {
        if (targetTeam.begin() == targetTeam.end())
        {
                    return nullptr;
        }
        
        auto it = targetTeam.begin();
        int castValue = -1;
        Cell *targetPtr = nullptr;
        
        while (it != targetTeam.end())
        {
            // std::cout << "Checking unit: "  << " Team: " << (*it)->getTeam() << " Value: " << (*it)->getValue() << " Alive is :" << (*it)->getAlive() << std::endl;
            int value = validPriorityTarget(*(*it), myTeam);
            if (value > castValue)
            {
                castValue = value;
                targetPtr = (*it)->getCell();
            }
            it++;
        }
        if (castValue > 0)
            return targetPtr;
        return nullptr;
    }