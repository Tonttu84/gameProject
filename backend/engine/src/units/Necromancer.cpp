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

#include "units/Necromancer.hpp"



Necromancer::Necromancer(int setTeam) noexcept: Human::Human(setTeam, MeleeWeapons::Dagger)
{
    setSpellcaster(true);
    printSymbol    = 'N';
    preferredRange = 3;
    size = SIZE;
}

Necromancer::Necromancer() noexcept {
        setSpellcaster(true);
        printSymbol = 'N';
}

bool Necromancer::placeZombie(Hex* targetHex)
{
    if (!targetHex) return false;
    std::unique_ptr<AUnit> Bob = std::make_unique<Zombie>(getTeam());
    if (targetHex->sizeUsed + static_cast<int>(Bob->getSize()) > Hex::CAPACITY) return false;
    for (AUnit* u : targetHex->units)
        if (u && u->getAlive() && u->getTeam() != getTeam()) return false;

    if (Utility::getBattlefield().getCorpses())
        Utility::getBattlefield().setCorpses(Utility::getBattlefield().getCorpses() - 1);
    Bob->setBattleSummon(true);
    Bob->setHex(targetHex);
    Utility::getBattlefield().getTeam(team).push_back(std::move(Bob));
    return true;
}


bool Necromancer::placeSkeleton(Hex* targetHex)
{
    if (!targetHex) return false;
    std::unique_ptr<AUnit> sk = std::make_unique<Skeleton>(getTeam());
    if (targetHex->sizeUsed + static_cast<int>(sk->getSize()) > Hex::CAPACITY) return false;
    for (AUnit* u : targetHex->units)
        if (u && u->getAlive() && u->getTeam() != getTeam()) return false;
    sk->setBattleSummon(true);
    sk->setHex(targetHex);
    Utility::getBattlefield().getTeam(team).push_back(std::move(sk));
    return true;
}

void Necromancer::raiseDead()
{
    if (getCast() > 0)
    {
        setCast(getCast() - 1);
        return;
    }

    if (mana <= 0 || broken || !alive || !getHex())
        return;

    Battlefield& myBattle = Utility::getBattlefield();
    mana--;

    auto nbCoords = myBattle.hexGrid.neighbors(getHex()->coord);

    if (myBattle.getCorpses() == 0) {
        // No fresh corpses — conjure a skeleton from ancient bones at no corpse cost
        for (const HexCoord& nc : nbCoords) {
            if (placeSkeleton(myBattle.hexGrid.getHex(nc))) break;
        }
    } else {
        size_t summons = (myBattle.getCorpses() >= 3) ? 3 : 1;
        if (myBattle.getCorpses() >= 3)
            myBattle.setCorpses(myBattle.getCorpses() - 3);

        for (const HexCoord& nc : nbCoords) {
            if (!summons) break;
            if (placeZombie(myBattle.hexGrid.getHex(nc))) summons--;
        }
    }
    setCast(6);
}

void Necromancer::special()
{
    raiseDead();
}
