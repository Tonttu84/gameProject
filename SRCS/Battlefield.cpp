/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Battlefield.cpp                                    :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@hive.fi>                +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/16 11:09:45 by jrimpila          #+#    #+#             */
/*   Updated: 2025/10/06 10:58:13 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#include "../HDRS/Battlefield.hpp"

Battlefield::Battlefield()
{
	for (int yIT = 0; yIT < height; yIT++)
	{
		for (int xIT = 0; xIT < width; xIT++)
		{
			_battlefield[yIT][xIT].wLoc = xIT;
			_battlefield[yIT][xIT].hLoc = yIT;
		}
	}
}

void Battlefield::print()
{
	window->clear(); // Clear previous frame

	for (int i = 0; i < height; ++i) {
		for (int k = 0; k < width; ++k) {
			_battlefield[i][k].render(*window); // Each cell queues its own drawables
		}
	}

window->display(); // Flush and show everything
}

size_t Battlefield::countTeam(const int team) const
{
	size_t retval = 0;
	for(int i = 0; i < height ; i++)
	{
		for (int k = 0; k < width ; k++)
		{
		   if( _battlefield[i][k].getUnit() && _battlefield[i][k].getUnit()->getTeam() == team)
			   retval++;
		}
	}
	return retval;
}

void Battlefield::moveUnits()
{
	moveTeam(teamRED);
	moveTeam(teamBLUE);
}

void Battlefield::makeBattle()
{
	auto red = teamRED.begin();
	auto blue = teamBLUE.begin();
	
	while (red != teamRED.end() || blue != teamBLUE.end())
	{
		if (red != teamRED.end() && ((Utility::getRandom(1, 2) == 1) || blue == teamBLUE.end()))
		{
			(*red)->battle(*this);
			red++;
		}
		else if (blue != teamBLUE.end())
		{
			(*blue)->battle(*this);
			blue++;
		}
	}
}

void Battlefield::debugPrint()
{
	for(int i = 0; i < height; i++)
	{
		for (int k = 0; k < width; k++)
		{
			
			std::cout <<"(" << _battlefield[i][k].hLoc << "|" << _battlefield[i][k].wLoc << ")";
				
		}
		std::cout << "\n";
	}
	std::cout << std::endl;
}





static Cell *searchCell(const AUnit &Searcher, const std::vector<std::unique_ptr<AUnit>> &team)
{
	int ClosestDistance = std::numeric_limits<int>::max();
	int W;
	int H;
	Cell *finalTarget = nullptr;
	if (Searcher.getCell())
	{
		W = Searcher.getCell()->wLoc;
		H = Searcher.getCell()->hLoc;
	}
	else
		return nullptr;

	for (auto it = team.begin(); it != team.end(); ++it) {
    if (*it) { 
			const AUnit& unit = **it;
			if (unit.getTeam() == Searcher.getTeam())
			{
				return nullptr; // We are looking for an enemy
			}
			Cell *targetCell = unit.getCell();
			if (targetCell)
			{
				int Distance = std::abs(targetCell->wLoc - W);
				if (Distance < std::abs(targetCell->hLoc - H))
					Distance = std::abs(targetCell->hLoc - H);
				if (ClosestDistance > Distance)
				{
					ClosestDistance = Distance;
					finalTarget = targetCell;
				}
			}
    	}
	}
	return finalTarget;
}

Cell *Battlefield::findTarget(const AUnit &Searcher) const
{
	if (Searcher.getCell() == nullptr)
		return nullptr;
	int X = Searcher.getCell()->wLoc;
	int Y = Searcher.getCell()->hLoc;
		
	
	Cell *OptionA = searchCell(Searcher, teamBLUE);
	Cell *OptionB = searchCell(Searcher, teamRED);
	
	
	if (OptionA && OptionB)
	{
		int ADistance = std::abs(OptionA->wLoc - X);
				if (ADistance > std::abs(OptionA->hLoc - Y))
					ADistance = std::abs(OptionA->hLoc - Y);
		int BDistance = std::abs(OptionB->wLoc - X);
				if (BDistance > std::abs(OptionB->hLoc - Y))
					BDistance = std::abs(OptionB->hLoc - Y);;
		

		if (ADistance < BDistance)
			return OptionA;
		else
			return OptionB;
		
	}
	if (OptionA)
		return OptionA;
	return OptionB;
	
}
//0 on success, 1 on fail

int  Battlefield::moveN(AUnit &unit, Cell &myCell)
{
	if (moveAUnit(unit, myCell.wLoc , myCell.hLoc - 1) == 0)
		return 0;	
	else if (myCell.wLoc > 0 && (moveAUnit(unit, myCell.wLoc -1 , myCell.hLoc - 1) == 0))
		return 0;	
	else if (myCell.wLoc < width -2 && (moveAUnit(unit, myCell.wLoc +1 , myCell.hLoc - 1) == 0))
		return 0;
	return 1;		
}

int  Battlefield::moveNE(AUnit &unit, Cell &myCell)
{
	if (moveAUnit(unit, myCell.wLoc + 1, myCell.hLoc -1) == 0)
		return 0;	
	else if ((moveAUnit(unit, myCell.wLoc, myCell.hLoc -1) == 0))
		return 0;	
	else if ((moveAUnit(unit, myCell.wLoc +1  , myCell.hLoc ) == 0))
		return 0;
	return 1;
	
}

int  Battlefield::moveE(AUnit &unit, Cell &myCell)
{
	if (moveAUnit(unit, myCell.wLoc + 1, myCell.hLoc) == 0)
		return 0;
	else if (myCell.hLoc > 0 && (moveAUnit(unit, myCell.wLoc + 1, myCell.hLoc -1) == 0))
		return 0;
	else if (myCell.hLoc < height -2 && (moveAUnit(unit, myCell.wLoc + 1, myCell.hLoc +1) == 0))
		return 0;

	return 1;
}


int  Battlefield::moveSE(AUnit &unit, Cell &myCell)
{
	if (moveAUnit(unit, myCell.wLoc + 1, myCell.hLoc + 1) == 0)
			return 0;
	else if (moveAUnit(unit, myCell.wLoc + 1, myCell.hLoc) == 0)
		return 0;
	else if (moveAUnit(unit, myCell.wLoc, myCell.hLoc +1) == 0)
		return 0;
	return 1; 
}

int  Battlefield::moveS(AUnit &unit, Cell &myCell)
{
	if (moveAUnit(unit, myCell.wLoc , myCell.hLoc + 1) == 0)
		return 0;	
	else if (myCell.wLoc > 0 && (moveAUnit(unit, myCell.wLoc -1 , myCell.hLoc +1) == 0))
		return 0;	
	else if ((myCell.wLoc < width -2 && moveAUnit(unit, myCell.wLoc +1 , myCell.hLoc +1) == 0))
		return 0;
	return 1;	
}

int  Battlefield::moveSW(AUnit &unit, Cell &myCell)
{
	if (moveAUnit(unit, myCell.wLoc -1 , myCell.hLoc + 1) == 0)
		return 0;	
	else if (moveAUnit(unit, myCell.wLoc, myCell.hLoc + 1) == 0)
		return 0;
	else if (moveAUnit(unit, myCell.wLoc -1 , myCell.hLoc) == 0)
		return 0;

	return 1;
}

int  Battlefield::moveW(AUnit &unit, Cell &myCell)
{
	if (moveAUnit(unit, myCell.wLoc -1 , myCell.hLoc) == 0)
		return 0;	
	else if (myCell.hLoc > 0 && (moveAUnit(unit, myCell.wLoc -1 , myCell.hLoc -1) == 0))
		return 0;
	else if (myCell.hLoc < height -2 && (moveAUnit(unit, myCell.wLoc -1 , myCell.hLoc +1) == 0))
		return 0;

	return 1;
}

int  Battlefield::moveNW(AUnit &unit, Cell &myCell)
{
	if (moveAUnit(unit, myCell.wLoc -1 , myCell.hLoc -1) == 0)
		return 0;	
	else if (moveAUnit(unit, myCell.wLoc, myCell.hLoc - 1) == 0)
		return 0;
	else if (moveAUnit(unit, myCell.wLoc -1 , myCell.hLoc) == 0)
		return 0;
	return 1;	
}

void Battlefield::moveOne(std::unique_ptr<AUnit> &unit, const Cell* cellptr)
{
	
	
	if (cellptr == nullptr || unit == nullptr || unit->getCell() == nullptr)
	{
		return;
	}
	assert(unit->getCell() != nullptr);
	Cell &myCell = *unit->getCell();
	
	if (unit->getSpentMove())
	{
		unit->setSpentMove(unit->getSpentMove() - 1);
		return;
	}

	int wDelta = cellptr->wLoc - (myCell.wLoc);
	int hDelta = cellptr->hLoc - (myCell.hLoc);
	if (wDelta > 1 && hDelta > 1)
	{
		moveSE(*unit, myCell);
		return;
	}
	else if (wDelta > 1 && hDelta < -1)
	{
		moveNE(*unit, myCell);
		return;
	}
	else if (wDelta > 1)
	{
		moveE(*unit, myCell);
		return;
		
	}
	else if (wDelta < -1 && hDelta > 1)
	{
		moveSW(*unit, myCell);
		return;
	}
	else if (wDelta < -1 && hDelta < -1)
	{
		moveNW(*unit, myCell);
		return;
	}
	else if (wDelta < -1)
	{
		moveW(*unit, myCell);
		return;
	}
	else if (hDelta > 1)
	{
		moveS(*unit, myCell);
		return;
	}
	else if (hDelta < -1)
	{
		moveN(*unit, myCell);
		return;
	}
		
}

void Battlefield::moveTeam(std::vector<std::unique_ptr<AUnit>> &team)
{
	for (auto IT = team.begin(); IT != team.end(); IT++)
	{
		AUnit &unit = **IT;
		if (unit.getBroken() == true)
		{
			flee(*IT);
			continue;	
		}
		if (unit.getFatigue() >= 100 || unit.getCast()> 0 || (unit.getFatigue() > 30 && unit.getEngaged(*this) == false)) // units wants to rest
		{
		
			unit.recover();
			continue;
		} 
	
		Cell *target = findTarget(unit);
		if (target == nullptr)
			continue;
		moveOne(*IT, target);
	}
}


int Battlefield::moveAUnit(AUnit &unit, int w, int h)
{
	if (_battlefield[h][w].getUnit())
		return 1;
	unit.getCell()->reset();
	unit.reset();
	_battlefield[h][w].setUnit(&unit);
	return 0;
}


void Battlefield::cleanup()
{
    auto it = teamBLUE.begin();
    while (it != teamBLUE.end())
    {
		assert((*it).get() != nullptr && "Unexpected nullptr in teamBLUE");
        if (!(*it) || (*it)->getAlive() == 0) 
        {
			if ((*it)->getUndead() == false)
				corpses++;
            it = teamBLUE.erase(it); // erase returns the next valid iterator
        }
        else
        {
            ++it;
        }
    }
	auto itred = teamRED.begin();
    while (itred != teamRED.end())
    {
		assert((*itred).get() != nullptr && "Unexpected nullptr in teamRED");
        if (!(*itred) ||(*itred)->getAlive() == 0) 
        {
            itred = teamRED.erase(itred); // erase returns the next valid iterator
        }
        else
        {
            ++itred;
        }
    }
}

void Battlefield::flee(std::unique_ptr<AUnit> &unit)
{
	if (!unit->getAlive())
		return;
	if (unit->getFatigue() > 100)
	{
		unit->recover();
		return;
	}

	Cell *myCell = unit->getCell();
	if (!myCell)
		return; 
	if (myCell->hLoc == 0 || myCell->wLoc == 0 || myCell->hLoc == height -1 || myCell->wLoc == width - 1)
	{
		std::cout << "A soldier fled the battlefield and turns to banditry" << std::endl;
		unit->setAlive(false);
		return; // unit is gone, skip movement
	}
	if (unit->getTeam() == 1)
	{
		if (moveE(*unit, *unit->getCell()) == 1)
			unit->rally();
	}
	else if (unit->getTeam() == 2)
	{
		if (moveW(*unit, *unit->getCell()) == 1)
			unit->rally();
	}
	else 
	{
		if (moveS(*unit, *unit->getCell()) == 1)
			unit->rally();
	}
}

std::vector<std::unique_ptr<AUnit>> &Battlefield::getTeam(int team)
{
	if (team == BLUETEAM)
		return teamBLUE;
	if (team == REDTEAM)
		return teamRED;
	throw std::runtime_error("getTeam request is invalid");
}







void Battlefield::loadArmies(Army red, Army blue)
{
    teamRED = std::move(red);
    teamBLUE = std::move(blue);
}

bool Battlefield::tick()
{
    triggerSpecialPhase();
    moveUnits();
    makeBattle();
    cleanup();
    return countTeam(REDTEAM) > 0 && countTeam(BLUETEAM) > 0;
}

BattleResult Battlefield::extractResult()
{
    BattleResult result;
    result.corpses = corpses;
    result.winner = (countTeam(REDTEAM) > 0) ? REDTEAM :
                    (countTeam(BLUETEAM) > 0) ? BLUETEAM : 0;

    for (auto& unit : teamRED)
        if (unit && unit->getAlive() && !unit->getBattleSummon())
            result.redSurvivors.push_back(std::move(unit));

    for (auto& unit : teamBLUE)
        if (unit && unit->getAlive() && !unit->getBattleSummon())
            result.blueSurvivors.push_back(std::move(unit));

    teamRED.clear();
    teamBLUE.clear();
    return result;
}

void Battlefield::triggerSpecialPhase()
{
    for (auto& unit : teamRED)
    {
        if(unit && unit->getFatigue() < 100 && unit->getAlive()) 
			unit->special();
    }

    for (auto& unit : teamBLUE)
    {
        if(unit && unit->getFatigue() < 100 && unit->getAlive()) 
			unit->special();
    }
}

Cell* Battlefield::safeGetCell(int h, int w)
{
	if (h < 0 || h >= height)
		return nullptr;	
	if (w < 0 || w >= width)
		return nullptr;
	return &_battlefield[h][w];
}

size_t Battlefield::getCorpses()
{
	return corpses;
}

void Battlefield::setCorpses(size_t setCorpses)
{
	corpses = setCorpses;
}