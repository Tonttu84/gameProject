/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Necromancer.cpp                                           :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@student.hive.fi>        +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/28 17:18:44 by jrimpila          #+#    #+#             */
/*   Updated: 2025/08/29 13:02:29 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#include "../HDRS/Necromancer.hpp"
#include "Cell.hpp"



Necromancer::Necromancer(int setTeam) noexcept: Human::Human(setTeam, MeleeWeapons::Dagger)
{
    setSpellcaster(true);
    printSymbol = 'N';
} 

Necromancer::Necromancer() noexcept {
        setSpellcaster(true);
        printSymbol = 'N';
}

//returns true on success
bool Necromancer::placeZombie(Cell *targetCell)
{
    if (targetCell && targetCell->getUnit() == nullptr)
    {
        if (Utility::getBattlefield().getCorpses())
            Utility::getBattlefield().setCorpses(Utility::getBattlefield().getCorpses() - 1);
        std::unique_ptr<AUnit> Bob = std::make_unique<Zombie>(getTeam());
        Bob->setBattleSummon(true);
        targetCell->setUnit(&(*Bob));
        Bob->setCell(targetCell);
        Utility::getBattlefield().getTeam(team).push_back(std::move(Bob));

        return true;
    }
    return false;
}


void Necromancer::raiseDead()
{
    if (getCast() > 0)
    {
        setCast(getCast() - 1);
        return;
    }

    if (mana <= 0 || broken || !alive || !getCell())
        return;

    Battlefield &myBattle = Utility::getBattlefield();
    int wLoc = getCell()->wLoc;
    int hLoc = getCell()->hLoc;
    mana--;

    size_t summons = (myBattle.getCorpses() >= 3) ? 3 : 1;
    if (myBattle.getCorpses() >= 3)
        myBattle.setCorpses(myBattle.getCorpses() - 3);

    // Spiral outward from necromancer: front row first, then sides, then behind
    const int offsets[][2] = {
        {1, 1}, {1, 0}, {1, -1},
        {0, 1}, {0, -1},
        {-1, 1}, {-1, 0}, {-1, -1}
    };
    for (auto &off : offsets)
    {
        if (!summons)
            break;
        Cell *targetCell = myBattle.safeGetCell(hLoc + off[0], wLoc + off[1]);
        if (placeZombie(targetCell))
            summons--;
    }
    setCast(6);
}

void Necromancer::special()
{
    raiseDead();
}