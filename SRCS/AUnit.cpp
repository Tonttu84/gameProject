/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   AUnit.cpp                                          :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@hive.fi>                +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/16 11:46:16 by jrimpila          #+#    #+#             */
/*   Updated: 2025/10/06 10:57:37 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#include "../HDRS/AUnit.hpp"



AUnit::AUnit(const int newTeam)
:team(newTeam)
{
	
}

AUnit::~AUnit()
{
	if (getCell())
		getCell() -> reset();
	currentCell = nullptr;
}

void AUnit::setCell(Cell* cell) {
	if (cell && cell->getUnit() && cell->getUnit() != this) {
		assert(currentCell && currentCell->getUnit() == this && "Unit's current cell doesn't match!");
	}
	currentCell = cell;
}

Cell* AUnit::getCell() const {
	return currentCell;
}

void AUnit::reset()
{
	currentCell = nullptr;
}


int AUnit::getTeam() const
{
	assert(team != 0);
	return team;
}

int AUnit::getFatigue() const
{
	return fatigue;
}


int AUnit::getShield() const
{
	return shield;
}

bool AUnit::getEngaged(Battlefield &myBattlefield) const
{

	if (getCell() == nullptr)
		return false;
	int W = getCell()->wLoc;
	int H = getCell()->hLoc;

	Cell *targetCell = nullptr;

	for (int it = W-1; it <= W+1; it++)
	{
		for (int it2 = H-1; it2 <= H+1; it2++)
		{
			targetCell = myBattlefield.safeGetCell(it2, it);
			if (targetCell && targetCell->getUnit() && targetCell->getUnit()->getTeam() != getTeam())
				return true;
		}
	} 
	return false;
}

int AUnit::defend(int AttackAttempt, int damage)
{

	int defenceroll = Utility::throwDice();

	if (defence - fatiguelvl * 2 + defenceroll >= AttackAttempt)
		return 0;
	
	
	int resultDMG = damage + Utility::throwDice() - Utility::throwDice();

	if (resultDMG >0 && shield > 0 && (defence + shield - fatiguelvl * 2 + defenceroll >= AttackAttempt)) //Result is not completely dodged and hits the shield
	{
		resultDMG = resultDMG - SHIELDREDUCTION - shield * 2; //Shields have a basic reduction but bigger shields block more
		if (resultDMG > 0)
		{
			shield--; //If shield fails to stop the blow, its quality suffers
			std::cout << "Shield damaged by a strong blow" << std::endl;
		}	
	}
	if (resultDMG > 0)
	{
		testMorale(resultDMG);
		hitpoints = hitpoints - resultDMG;
		if (hitpoints < 1)
			alive = false;
		return resultDMG;
	}
	return 0;
}



void AUnit::attack(AUnit &target, const Weapon &attackWeapon)
{   
	int HitResult = attackPWR - fatiguelvl + attackWeapon.getAttack() + Utility::throwDice();
	
	target.defend(HitResult, attackWeapon.getDamage() + strength / attackWeapon.getStrDivider());
	
}

AUnit *AUnit::find_target(Battlefield &myBattlefield)
{
	if (!getCell())
		return nullptr;
	int H = getCell()->hLoc;
	int W = getCell()->wLoc;

	for (int dh = -1; dh <= 1; ++dh)
	{
		for (int dw = -1; dw <= 1; ++dw)
		{
			if (dh == 0 && dw == 0)
				continue;
			Cell *c = myBattlefield.safeGetCell(H + dh, W + dw);
			if (c && c->getUnit() && c->getUnit()->getTeam() != team && c->getUnit()->getAlive())
				return c->getUnit();
		}
	}
	return nullptr;
}

	void AUnit::battle(Battlefield &myBattlefield)
	{
		if (broken || !getCell())
			return;
		if (fatigue > 100)
		{
			recover();
			return;
		}
		bool attacked = false;
		auto it = _attacks.begin();
		while (it != _attacks.end())
		{
			AUnit *target = find_target(myBattlefield);
			if (!target)
				break;
			while (it != _attacks.end() && target->getAlive())
			{
				attack(*target, *it);
				attacked = true;
				++it;
			}
		}
		if (attacked)
			increaseFatigue();
	}

	bool AUnit::getAlive() const
	{
		return alive;
	}

	bool AUnit::getBroken() const
	{
		return broken;
	}

	void AUnit::setAlive(bool newAlive)
	{
		alive = newAlive;
	}

	void AUnit::setShield(int newVal)
	{
		shield = newVal;
	}


	bool AUnit::rally()
	{
		if (broken == false)
			return false;
		if ((morale + Utility::throwDice() - Utility::throwDice()) >= 12)
		{
			std::cout << "With nowhere to flee to a soldier rallies" << std::endl;
			broken = false;
			return true;
		}
		return false;
	}

	int AUnit::getHp() const
	{
		return hitpoints; 
	}
	int AUnit::getmaxHP() const
	{
		return maxHP;
	}

	void AUnit::setBroken(bool value)
	{
	broken = value;
	}
	void  AUnit::heal(int value)
	{
		if (value < 0)
			return;
		if (value + hitpoints > maxHP)
			hitpoints = maxHP;
		else
			hitpoints = hitpoints + value;
	}

	void AUnit::setSpellcaster(bool value)
	{
	spellcaster = value;
	}

	bool AUnit::getSpellCaster() const
	{
	return spellcaster;
	}

	int AUnit::getCast() const{
	return cast;
	}

	void AUnit::setCast(int setCast)
	{
		cast = setCast;
	}

	void AUnit::setPlaced(bool value)
	{
		placed = value;
	}
	bool AUnit::getPlaced() const{
		return placed;
	}

	void AUnit::setBattleSummon(bool value)
	{
		battleSummon = value;
	}
	bool AUnit::getBattleSummon() const{
		return battleSummon;
	}

	char  AUnit::getPrintSymbol(){
		return printSymbol;
	}

	int AUnit::getArmour() const{
		return armour;
	}

	int AUnit::getValue() const{
		return unitValue;
	}
	int AUnit::takeDamage(int amount)
	{
		if (amount - armour <= 0)
			return 0;
		hitpoints = hitpoints - (amount - armour);
		if (hitpoints <= 0)
		{
			alive = false;
		}
		else 
			testMorale(amount - armour);
		return (amount - armour);
		
	}

	//returns true if the test is passed
	bool AUnit::testMorale(int damage)
	{
		if (damage <= 0)
			return true;
		if (morale + Utility::throwDice() - Utility::throwDice() > damage)
			return true;
		setBroken(true);
		std::cout << "One coward valued his life more than his honor" << std::endl;
		return false;
	}

	void AUnit::recover()
	{
		if (fatigue - FATIGUERECOVERY <= 0)
			fatigue = 0; 
		else
			fatigue = fatigue - FATIGUERECOVERY;
		fatiguelvl = fatigue / 20;
	}

	void AUnit::increaseFatigue()
	{
		fatigue = fatigue + fatigueCost;
		fatiguelvl = fatigue / 20;
	}

	bool AUnit::getUndead() const
	{
		return undead;
	}


	size_t AUnit::getSpentMove()
	{
		return spentMove;
	}

	void AUnit::setSpentMove(size_t setMove)
	{
		spentMove = setMove;
	}

	void AUnit::addWeapon(Weapon newWeapon)
	{
		_attacks.push_back(newWeapon);
		defence = defence + newWeapon.getDefence();
		shield = shield + newWeapon.getShield();
	}