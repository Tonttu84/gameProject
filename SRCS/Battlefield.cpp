/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Battlefield.cpp                                    :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@student.hive.fi>        +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/16 11:09:45 by jrimpila          #+#    #+#             */
/*   Updated: 2025/08/29 11:29:40 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#include "../HDRS/Battlefield.hpp"
#include <random>
#include "../HDRS/Cell.hpp"
#include "../HDRS/Human.hpp"
#include "../HDRS/Priest.hpp"




class Human;



int getRandomNumber(int min = 0, int max = (Battlefield::height - 1)) {
	static std::random_device rd;  // Non-deterministic seed
	static std::mt19937 gen(rd()); // Mersenne Twister engine
	std::uniform_int_distribution<> dist(min, max);
	return dist(gen);
}

void Battlefield::placeTeamRED(std::vector<std::unique_ptr<AUnit>>& team)
{
	int safeguard = 0;
	for (auto& unit : team)
	{
		int HIter = 1;
		if (safeguard == 0)
			HIter = getRandomNumber(1, height - 2);
		int WIter = width * 2 / 3;
		if (safeguard == 0)
			WIter = getRandomNumber(width * 2 / 3, width - 2);
	   while(_battlefield[HIter][WIter].getUnit() != nullptr && HIter < height -2)
	   {
			while (_battlefield[HIter][WIter].getUnit() != nullptr && WIter < width -2)
			{
				WIter++;
			}
			WIter = width * 2 / 3;
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

void Battlefield::placeTeamBLUE(std::vector<std::unique_ptr<AUnit>>& team)
{
	int safeguard = 0;
	for (auto& unit : team)
	{
		int HIter = 1;
		if (safeguard == 0)
			HIter = getRandomNumber(1, height - 2);
		int WIter = 1;
		if (safeguard == 0)
			WIter = getRandomNumber(1, width / 3);
	   while(_battlefield[HIter][WIter].getUnit() != nullptr && HIter < height -2)
	   {
			while (_battlefield[HIter][WIter].getUnit() != nullptr && WIter < (width / 3) - 1)
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
			{
				if (_battlefield[i][k].fire == true)
					std::cout << RED_ON_ORANGE << "."<< RESET;
				else
					std::cout << ".";
			}

				
			else if( _battlefield[i][k].getUnit()->getTeam() == 1)
			{
				if (_battlefield[i][k].fire == true)
					std::cout << RED_ON_ORANGE << _battlefield[i][k].getUnit()->getPrintSymbol() << RESET;
				else if (_battlefield[i][k].getUnit()->getCast() != 0)
					std::cout << RED_ON_YELLOW << _battlefield[i][k].getUnit()->getPrintSymbol() << RESET;
				else 
					std::cout << RED << _battlefield[i][k].getUnit()->getPrintSymbol() << RESET;

			}
			else if( _battlefield[i][k].getUnit()->getTeam() == 2)
			{
				if (_battlefield[i][k].fire == true)
					std::cout << BLUE_ON_ORANGE << _battlefield[i][k].getUnit()->getPrintSymbol() << RESET;
				else if (_battlefield[i][k].getUnit()->getCast() != 0)
					std::cout << BLUE_ON_YELLOW << _battlefield[i][k].getUnit()->getPrintSymbol() << RESET;
				else 
					std::cout << BLUE << _battlefield[i][k].getUnit()->getPrintSymbol() << RESET;

			}
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
		if ((*IT)->getBroken() == true)
		{
			flee(*IT);
			continue;	
		}
		if ((*IT)->getCast() > 0)
			continue;
		Cell *target = findTarget(**IT);
		if (target == nullptr)
			return;
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

std::vector<std::unique_ptr<AUnit>> &Battlefield::getTeamBLUE() { 
	return teamBLUE; 
}

void Battlefield::placeTeam(std::vector<std::unique_ptr<AUnit>>& team, size_t wStart, size_t wEnd, size_t hStart, size_t hEnd)
{


	 assert(wEnd >= wStart && "wEnd must be greater than wStart");
    assert(hEnd >= hStart && "hEend must be greater than or equal to hStart");
	
	int safeguard = 0;
	for (auto& unit : team)
	{
		if (unit->getPlaced() == true)
			continue;

		size_t HIter = hStart;
		if (safeguard == 0)
			HIter = getRandomNumber(hStart, hEnd);
		size_t WIter = wStart;
		if (safeguard == 0)
			WIter = getRandomNumber(wStart, wEnd);
	   while(_battlefield[HIter][WIter].getUnit() != nullptr && HIter < hEnd + 1)
	   {
			while (_battlefield[HIter][WIter].getUnit() != nullptr && WIter < wEnd + 1)
			{
				WIter++;
			}
			WIter = wStart;
			HIter++;
			
		}
		if(_battlefield[HIter][WIter].getUnit() == nullptr)
		   {
			_battlefield[HIter][WIter].setUnit(unit.get());
			unit->setPlaced(true);
			std::cout << "Created unit" << std::endl;    
			safeguard = 0;
		}
		else if(safeguard == 20)
		{
			
			std::cout << "Map is full" << std::endl;
			exit(1);
		}
		else 
		{
			HIter = hStart;
			safeguard++;
		}
		if (HIter == hEnd +1)
		{
			HIter = hStart;
		}
	}
}

void Battlefield::triggerSpecialPhase()
{
    for (auto& unit : teamRED)
    {
        if(unit) 
			unit->special();
    }

    for (auto& unit : teamBLUE)
    {
        if(unit) 
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