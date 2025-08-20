/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Utility.cpp                                        :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@student.hive.fi>        +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/17 13:00:08 by jrimpila          #+#    #+#             */
/*   Updated: 2025/08/20 12:10:59 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#include "../HDRS/Utility.hpp"

int Utility::throwDice()
{
    static std::mt19937 gen(std::random_device{}()); // seeded once
    static std::uniform_int_distribution<int> dist(1, 6); // dice range

    int result = dist(gen);

    if (dist(gen) == 6)
        return result += throwDice();
    
    return result;
}


   AUnit *Utility::findTarget(const std::vector<std::unique_ptr<AUnit>>& targets, bool (*validPriorityTarget)(const AUnit&), bool (*validTarget)(const AUnit&))
   {
      
        if (targets.begin() == targets.end())
            {
                return nullptr;
            }

        AUnit* secondary = nullptr;

        auto it = targets.begin();
        while (it != targets.end())
        {
            if (validPriorityTarget(*(*it)))
            {
                return (&*(*it));
            }
            if (secondary)
            {
                it++;
                continue;
            }
            if (validTarget(*(*it)))
                secondary = &*(*it);
            it++;
        }
        return secondary;
    }

    Battlefield &Utility::getBattlefield()
    {
        static Battlefield myBattlefield;
        return myBattlefield;

    }
    

    
