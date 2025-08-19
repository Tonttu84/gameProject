/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Battlefield.cpp                                    :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@student.hive.fi>        +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/16 11:09:45 by jrimpila          #+#    #+#             */
/*   Updated: 2025/08/18 17:39:12 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#include "../HDRS/Battlefield.hpp"
#include <random>
#include "../HDRS/Cell.hpp"
#include "../HDRS/Human.hpp"

#define RED "\033[31m"
#define BLUE "\033[34m"
#define RESET "\033[0m"

class Human;


int getRandomNumber(int min = 0, int max = (Battlefield::height - 1)) {
	static std::random_device rd;  // Non-deterministic seed
	static std::mt19937 gen(rd()); // Mersenne Twister engine
	std::uniform_int_distribution<> dist(min, max);
	return dist(gen);
}


void Battlefield::placeTeam(std::vector<std::unique_ptr<AUnit>>& team)
{
	int safeguard = 0;
	for (auto& unit : team)
	{
		int HIter = 1;
		if (safeguard == 0)
			HIter = getRandomNumber(1, height - 2);
		int WIter = 1;
		if (safeguard == 0)
			WIter = getRandomNumber(1, width - 2);
	   while(_battlefield[HIter][WIter].getUnit() != nullptr && HIter < height -2)
	   {
			while (_battlefield[HIter][WIter].getUnit() != nullptr && WIter < width -2)
			{
				WIter++;
			}
			WIter = 1;
			HIter++;
			
		}
		if (_battlefield[HIter][WIter].getUnit() == nullptr)
		   {
			_battlefield[HIter][WIter].setUnit(unit.get());
		
			std::cout << "Created unit" << std::endl;    
			safeguard = 0;
		}
		else if (safeguard == 20)
		{
			
			std::cout << "Map is full" << std::endl;
			exit(1);
		}
		else 
		{
			HIter = 1;
			safeguard++;
		}
		if (HIter == height -1)
		{
			HIter = 1;
		}
	}
} 

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
	for(int i = 0; i < height; i++)
	{
		for (int k = 0; k < width; k++)
		{
			if (_battlefield[i][k].getUnit() == nullptr)
				std::cout << ".";
			else if( _battlefield[i][k].getUnit()->getTeam() == 1)
				std::cout << RED "X" RESET;
			else if( _battlefield[i][k].getUnit()->getTeam() == 2)
				std::cout << BLUE "X" RESET;
			else 
				std::cout << "?";
				
		}
		std::cout << "\n";
	}
	std::cout << std::endl;
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
	if (red != teamRED.end() && ((getRandomNumber(1, 2) == 1) || blue == teamBLUE.end()))
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

void Battlefield::createTeam(size_t amount, int team)
{
    for (size_t i = 0; i < amount; ++i)
    {
        if (team == 1)
            teamRED.push_back(std::make_unique<Human>(team));
        else if (team == 2)
            teamBLUE.push_back(std::make_unique<Human>(team));
    }
}

std::vector<std::unique_ptr<AUnit>>& Battlefield::getTeamRED()
{
	return teamRED;
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

void Battlefield::moveOne(std::unique_ptr<AUnit> &unit, const Cell* const cellptr)
{
	
	
	if (cellptr == nullptr || unit == nullptr || unit->getCell() == nullptr)
	{
		return;
	}
	assert(unit->getCell() != nullptr);
	Cell &myCell = *unit->getCell();
	
	int wDelta = cellptr->wLoc - (myCell.wLoc);
	int hDelta = cellptr->hLoc - (myCell.hLoc);
	if (wDelta > 1 && hDelta > 1)
	{
		if (enter(*unit, myCell.wLoc + 1, myCell.hLoc + 1) == 0)
			return;
		else if (enter(*unit, myCell.wLoc + 1, myCell.hLoc) == 0)
			return;
		else if (enter(*unit, myCell.wLoc, myCell.hLoc) == 0)
			return; 
	}
	else if (wDelta > 1 && hDelta < -1)
	{
		if (enter(*unit, myCell.wLoc + 1, myCell.hLoc - 1) == 0)
			return;	
		else if (enter(*unit, myCell.wLoc + 1, myCell.hLoc ) == 0)
			return;	
		else if (enter(*unit, myCell.wLoc + 1, myCell.hLoc -1 ) == 0)
			return;	
	}
	else if (wDelta > 1)
	{
		if (enter(*unit, myCell.wLoc + 1, myCell.hLoc) == 0)
			return;
		else if (myCell.hLoc > 0 && (enter(*unit, myCell.wLoc + 1, myCell.hLoc -1) == 0))
			return;
		else if (myCell.hLoc < height -2 && (enter(*unit, myCell.wLoc + 1, myCell.hLoc +1) == 0))
			return;
		
	}
	else if (wDelta < -1 && hDelta > 1)
	{
		if (enter(*unit, myCell.wLoc -1 , myCell.hLoc + 1) == 0)
			return;	
		else if (enter(*unit, myCell.wLoc, myCell.hLoc + 1) == 0)
			return;
		else if (enter(*unit, myCell.wLoc -1 , myCell.hLoc) == 0)
			return;	
	}
	else if (wDelta < -1 && hDelta < -1)
	{
		if (enter(*unit, myCell.wLoc -1 , myCell.hLoc -1) == 0)
			return;	
		else if (enter(*unit, myCell.wLoc, myCell.hLoc - 1) == 0)
			return;
		else if (enter(*unit, myCell.wLoc -1 , myCell.hLoc) == 0)
			return;	
	}
	else if (wDelta < -1)
	{
		if (enter(*unit, myCell.wLoc -1 , myCell.hLoc) == 0)
			return;	
		else if (myCell.hLoc > 0 && (enter(*unit, myCell.wLoc -1 , myCell.hLoc -1) == 0))
			return;
		else if (myCell.hLoc < height -2 && (enter(*unit, myCell.wLoc -1 , myCell.hLoc +1) == 0))
			return;
	}
	else if (hDelta > 1)
	{
		if (enter(*unit, myCell.wLoc , myCell.hLoc + 1) == 0)
			return;	
		else if (wDelta > 0 && (enter(*unit, myCell.wLoc -1 , myCell.hLoc +1) == 0))
			return;	
		else if (wDelta < width -2 && (enter(*unit, myCell.wLoc +1 , myCell.hLoc +1) == 0))
			return;	
	}
	else if (hDelta < -1)
	{
		if (enter(*unit, myCell.wLoc , myCell.hLoc - 1) == 0)
			return;	
		else if (wDelta > 0 && (enter(*unit, myCell.wLoc -1 , myCell.hLoc - 1) == 0))
			return;	
		else if (wDelta < width -2 && (enter(*unit, myCell.wLoc +1 , myCell.hLoc - 1) == 0))
			return;	
	}
		
}

void Battlefield::moveTeam(std::vector<std::unique_ptr<AUnit>> &team)
{
	for (auto IT = team.begin(); IT != team.end(); IT++)
	{
		if ((*IT)->getBroken() == true)
		{
			flee(*IT);
			continue;	
		}
		Cell *target = findTarget(**IT);
		if (target == nullptr)
			return;
		moveOne(*IT, target);
	}
}


int Battlefield::enter(AUnit &unit, int w, int h)
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
	Cell *myCell = unit->getCell();
	if (!myCell)
		return; 
	if (myCell->hLoc == 0 || myCell->wLoc == 0 || myCell->hLoc == height -1 || myCell->wLoc == width - 1)
		{
			std::cout << "A soldier fled the battlefield and turns to banditry" << std::endl;
			unit->setAlive(0); //For the purpose of the battlefield he died
		}
	if (myCell->hLoc < myCell->wLoc && myCell->hLoc < height - myCell -> hLoc && myCell->hLoc < width - myCell->wLoc)
		enter(*unit, myCell->wLoc, myCell->hLoc - 1);
	else if (myCell->wLoc < height - myCell -> hLoc && myCell->wLoc < width - myCell->wLoc)
		enter(*unit , myCell->wLoc - 1, myCell->hLoc);
	else if (width - myCell->wLoc < height - myCell->hLoc)
		enter(*unit, myCell->wLoc + 1, myCell->hLoc );
	else 
		enter(*unit, myCell->wLoc, myCell->hLoc +1);
	
	



		
	
	
}