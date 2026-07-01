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

#include "AUnit.hpp"
#include "MeleeCombat.hpp"
#include "Squad.hpp"
#include "WeaponEffects.hpp"
#include <algorithm>



AUnit::AUnit(const int newTeam)
: team(newTeam), sortKey(Utility::getRandom(0, 1000000))
{
}

bool AUnit::biggerThan(const AUnit* other) const {
	if (size != other->size) return size > other->size;
	return sortKey < other->sortKey;
}

bool AUnit::sortsBefore(const AUnit* other) const {
	return sortKey < other->sortKey;
}

static void removeFromHex(Hex* hex, AUnit* unit) {
	if (!hex) return;
	auto& v = hex->units;
	v.erase(std::remove(v.begin(), v.end(), unit), v.end());
	hex->sizeUsed -= static_cast<int>(unit->getSize());
	if (hex->sizeUsed < 0) hex->sizeUsed = 0;
}

AUnit::~AUnit()
{
	leaveSquad();
	removeFromHex(currentHex, this);
	currentHex = nullptr;
}

void AUnit::setHex(Hex* hex) {
	removeFromHex(currentHex, this);
	currentHex = hex;
	if (hex) {
		hex->units.push_back(this);
		hex->sizeUsed += static_cast<int>(size);
	}
}

Hex* AUnit::getHex() const {
	return currentHex;
}

void AUnit::reset()
{
	removeFromHex(currentHex, this);
	currentHex = nullptr;
}

size_t AUnit::getSize() const { return size; }


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

void AUnit::addShield(int v)
{
	if (v > 0) _extraShields.push_back(v);
}

void AUnit::popShield()
{
	if (!_extraShields.empty()) _extraShields.pop_back();
}

bool AUnit::tryBlockExtraShield()
{
	for (int i = static_cast<int>(_extraShields.size()) - 1; i >= 0; --i) {
		if (Utility::throwDice() <= _extraShields[i]) {
			_extraShields.erase(_extraShields.begin() + i);
			return true;
		}
	}
	return false;
}

bool AUnit::rollTerrainRangedBlock(ArmorPen pen) const
{
	// Bypass ignores forest cover entirely (armor-negating attacks aren't
	// stopped by foliage). Piercing rolls at the same chance as Normal —
	// it halves the *protection* once blocked (see RangedCombat::applyHit),
	// not the chance of being blocked.
	if (!currentHex || pen == ArmorPen::Bypass) return false;
	switch (currentHex->terrain) {
		case TerrainType::Forest:
			return Utility::throwDice() <= FOREST_COVER_DEF_BONUS;
		default:
			return false;
	}
}

bool AUnit::getEngaged(Battlefield &myBattlefield) const
{
	if (!currentHex) return false;
	auto nbCoords = myBattlefield.hexGrid.neighbors(currentHex->coord);
	for (const HexCoord& nc : nbCoords) {
		Hex* nh = myBattlefield.hexGrid.getHex(nc);
		if (!nh) continue;
		for (AUnit* u : nh->units)
			if (u && u->getAlive() && u->getTeam() != team)
				return true;
	}
	return false;
}

int AUnit::defend(int AttackAttempt, int damage, ArmorPen pen, int /*attackerReach*/, bool repelCounter)
{
	int defenceroll = Utility::throwDice();

	int crampedPenalty = 0;
	if (engagedSide) {
		int eff = effectiveFrontage(*engagedSide);
		if (eff < HexSide::FRONTAGE) {
			int threshold = eff * 2 / 3;
			int remaining = static_cast<int>(size);
			while (remaining > threshold) {
				crampedPenalty += CRAMPED_COMBAT_PENALTY;
				remaining      -= threshold;
			}
		}
	}

	if (defence - fatiguelvl * 2 + defenceroll + cohesionStatBonus() - crampedPenalty
	    - _attacksReceivedThisTurn * MULTI_ATTACK_DEFENCE_PENALTY >= AttackAttempt)
		return 0;

	int d1 = Utility::throwDice(), d2 = Utility::throwDice();
	int resultDMG = damage + d1 - d2;

	// Extra shields (force fields): skill-independent flat roll, consumed on block.
	// Bypass attacks are fully deflected by a force field (magical barriers stop ethereal);
	// Piercing attacks halve the shield protection; Normal gets full SHIELDREDUCTION.
	if (resultDMG > 0 && tryBlockExtraShield()) {
		if (pen == ArmorPen::Bypass)
			resultDMG = 0; // force field fully absorbs the ethereal strike
		else if (pen == ArmorPen::Piercing)
			resultDMG -= SHIELDREDUCTION / 2;
		else
			resultDMG -= SHIELDREDUCTION;
	}
	// Physical shield: cannot stop Bypass attacks (ethereal passes straight through).
	// Piercing attacks halve the total shield protection (SHIELDREDUCTION + shield bonus).
	else if (pen != ArmorPen::Bypass && resultDMG > 0 && shield > 0
	         && (defence + shield - fatiguelvl * 2 + defenceroll >= AttackAttempt))
	{
		int shieldProt = SHIELDREDUCTION + shield * 2;
		if (pen == ArmorPen::Piercing)
			shieldProt /= 2;
		resultDMG -= shieldProt;
		if (resultDMG > 0)
		{
			shield--;
			std::cout << "Shield damaged by a strong blow" << std::endl;
		}
	}

	// Piercing weapons partially bypass melee armor.
	if (resultDMG > 0 && pen == ArmorPen::Piercing)
		resultDMG -= armour / 2;

	if (resultDMG > 0)
	{
		// A repel counter-hit is capped at 1 raw point and never triggers a
		// morale check — the attacker already passed one to even take this hit.
		if (repelCounter)
			resultDMG = 1;
		else
			testMorale(resultDMG);
		hitpoints -= resultDMG;
		if (hitpoints < 1)
			setAlive(false);
		return resultDMG;
	}
	return 0;
}




AUnit *AUnit::find_target(Battlefield &myBattlefield)
{
	(void)myBattlefield;
	if (!currentHex || !engagedSide) return nullptr;
	Hex* enemyHex = (engagedSide->hexA == currentHex)
	              ? engagedSide->hexB : engagedSide->hexA;
	if (!enemyHex) return nullptr;

	// Fight the hexside, not the hex: prefer enemies actually seated on the
	// same contested boundary, so attackers spread across the defenders
	// holding each side instead of every attacker dogpiling whichever unit
	// in the whole hex happens to have the lowest sortKey.
	AUnit* best = nullptr;
	for (AUnit* u : enemyHex->units)
		if (u && u->getTeam() != team && u->getAlive() && u->getEngagedSide() == engagedSide)
			if (!best || u->sortsBefore(best))
				best = u;
	if (best) return best;

	// Nobody's holding this boundary — the attack lands on the hex directly.
	for (AUnit* u : enemyHex->units)
		if (u && u->getTeam() != team && u->getAlive())
			if (!best || u->sortsBefore(best))
				best = u;
	return best;
}

	int AUnit::computeMeleeAttackBonus() const
	{
		// Bonus if the enemy hex assigned no unit to defend this side.
		int attackBonus = cohesionStatBonus();
		if (engagedSide) {
			Hex* enemyHex = (engagedSide->hexA == currentHex)
			              ? engagedSide->hexB : engagedSide->hexA;
			if (enemyHex) {
				bool defended = false;
				for (AUnit* u : enemyHex->units)
					if (u && u->getAlive() && u->getEngagedSide() == engagedSide)
						{ defended = true; break; }
				if (!defended) attackBonus += UNDEFENDED_SIDE_BONUS;

				// Elevation: higher ground → +1 atk; lower ground → -1 atk (cap ±1)
				int elevDiff = std::min(1, std::max(-1,
				    currentHex->elevation - enemyHex->elevation));
				attackBonus += elevDiff * ELEV_MELEE_BONUS;

				// Fortified side: penalty for the unit crossing into the defender's work
				if (engagedSide->fortified && engagedSide->fortifiedDefender == enemyHex)
					attackBonus -= FORTIFIED_ATK_PENALTY;

				// Cramped: unit too large to maneuver in reduced frontage (forest/rubble).
				// Each tier of overhang past 2/3 of the effective frontage adds one penalty.
				{
					int eff = effectiveFrontage(*engagedSide);
					if (eff < HexSide::FRONTAGE) {
						int threshold = eff * 2 / 3;
						int remaining = static_cast<int>(size);
						while (remaining > threshold) {
							attackBonus -= CRAMPED_COMBAT_PENALTY;
							remaining   -= threshold;
						}
					}
				}
			}
		}
		return attackBonus;
	}

	// Repel: a defender with a strictly longer weapon than this attack's reach
	// gets an opposed roll to interrupt it before damage lands. The original
	// target always gets first try (regardless of its own repelMalus); if it
	// doesn't win, any other alive, non-broken enemy sharing the same engaged
	// hexside (or, if the target itself was undefended, anyone else in its
	// hex) with repelMalus==0 and a longer weapon gets pulled in next, in
	// sortKey order. The first defender to win the opposed roll decides the
	// outcome for this attack; everyone who attempted (win or lose) pays a
	// stacking -1 malus to their own future repels this turn.
	//
	// MountedUnit composites contribute up to two independent candidates
	// (rider, then mount) via repelParts() — each gets its own single
	// attempt, same as any other defender, so a long-reached mount (e.g. a
	// Scorpion's stinger) can repel even when its rider couldn't. This
	// resolves entirely before MountedUnit::defend() ever decides whether the
	// *original* hit lands on the rider or the mount — repel doesn't need to
	// know or care which sub-unit eventually takes that hit.
	void AUnit::resolveRepel(AUnit* originalTarget, bool& blocked, int attackerHitBonus, int attackerReach)
	{
		if (!originalTarget || !originalTarget->getHex()) return;

		Hex*     hex  = originalTarget->getHex();
		HexSide* side = originalTarget->getEngagedSide();

		// A broken primary target doesn't fight back, but the cascade to other
		// eligible defenders sharing its side (or hex, if undefended) is still
		// open — see the "others" loop below, which already excludes broken
		// candidates the same way. getBroken() is read at the composite level
		// so a MountedUnit reports correctly: it defers to the rider while
		// mounted, so a panicking mount under a calm rider's control is NOT
		// considered broken here, and a calm mount under a broken rider IS —
		// see MountedUnit::getBroken()/effectTarget().
		std::vector<AUnit*> candidates;
		if (!originalTarget->getBroken())
			candidates = originalTarget->repelParts();

		std::vector<AUnit*> others;
		for (AUnit* u : hex->units) {
			if (!u || u == originalTarget || !u->getAlive() || u->getBroken()) continue;
			if (u->getTeam() == team) continue;
			if (side && u->getEngagedSide() != side) continue;
			for (AUnit* part : u->repelParts())
				if (part->getRepelMalus() == 0) others.push_back(part);
		}
		std::sort(others.begin(), others.end(),
		          [](AUnit* a, AUnit* b) { return a->sortsBefore(b); });
		candidates.insert(candidates.end(), others.begin(), others.end());

		for (AUnit* def : candidates) {
			if (def->_attacks.empty()) continue;
			// A defender with several weapons of differing reach repels with
			// whichever one reaches furthest, not just its first weapon — but
			// still only one attempt total, same as a single-weapon defender.
			const Weapon* defWeaponPtr = &def->_attacks.front();
			for (const Weapon& w : def->_attacks)
				if (w.getReach() > defWeaponPtr->getReach()) defWeaponPtr = &w;
			const Weapon& defWeapon = *defWeaponPtr;
			if (defWeapon.getReach() <= attackerReach) continue;

			int attackerRoll = attackPWR - fatigue + attackerHitBonus + attackerReach + Utility::throwDice();
			int defenderRoll = def->attackPWR - def->fatigue + def->computeMeleeAttackBonus()
			                  + defWeapon.getReach() + Utility::throwDice() - def->repelMalus;
			++def->repelMalus;

			if (defenderRoll <= attackerRoll) continue; // attacker wins this round; try the next defender

			int wonBy = defenderRoll - attackerRoll;
			if (!testMorale(wonBy)) {
				blocked = true; // nerve breaks — the attack is aborted
				return;
			}

			// Morale held: the defender's counter lands, capped at 1, no further morale check.
			// Deliberately calls defend() directly rather than building a MeleeAttack and
			// going through MeleeCombat::engage() — engage() is the only place that fires
			// onAttack/onDamage and increments _attacksReceivedThisTurn, and a 1-hp capped
			// counter-jab should never trigger a weapon's special effects (fireball,
			// lifedrain, ...) any more than it should add a defence malus. If a future
			// weapon-effects system attaches such hooks elsewhere (e.g. to defend() itself),
			// repelCounter is the flag to gate them off too.
			int counterDamage = defWeapon.getDamage() + def->strength / defWeapon.getStrDivider()
			                   + def->cohesionDmgBonus();
			// The counter's ArmorPen is the defending weapon's own, not the attacker's —
			// e.g. a Bypass ("magical") weapon still gets its 1 capped point through even
			// against an attacker only vulnerable to Bypass damage.
			defend(defenderRoll, counterDamage, defWeapon.getPen(), defWeapon.getReach(), true);
			if (!alive) blocked = true; // died to the counter — can't land the original hit either
			return; // once a defender has won, there are no further repels for this attack
		}
	}

	void AUnit::attackWithWeapons(AUnit* target, int attackBonus)
	{
		if (!target) return;
		for (auto it = _attacks.begin(); it != _attacks.end() && target->getAlive() && alive; ++it)
		{
			MeleeAttack shot;
			shot.hitBonus = attackBonus;
			shot.damage   = it->getDamage() + strength / it->getStrDivider()
			                + cohesionDmgBonus();
			shot.pen      = it->getPen();
			shot.reach    = it->getReach();
			shot.onAttack = [this, hb = shot.hitBonus, rch = shot.reach, fx = it->getEffect()]
			                (AUnit* atk, AUnit* tgt, bool& blocked) {
				resolveRepel(tgt, blocked, hb, rch);
				if (!blocked && atk->getAlive())
					applyWeaponAttackEffect(fx, atk, tgt);
			};
			shot.onDamage = [fx = it->getEffect()](AUnit* atk, AUnit*, int damage) {
				applyWeaponDamageEffect(fx, atk, damage);
			};
			MeleeCombat::engage(this, target, shot);
		}
	}

	void AUnit::battle(Battlefield &myBattlefield)
	{
		if (!canFightThisTurn || !getHex())
			return;
		if (fatigue > FATIGUE_MAX)
		{
			recover();
			return;
		}

		int attackBonus = computeMeleeAttackBonus();

		bool attacked = false;
		auto it = _attacks.begin();
		while (it != _attacks.end() && alive)
		{
			AUnit *target = find_target(myBattlefield);
			if (!target)
				break;
			while (it != _attacks.end() && target->getAlive() && alive)
			{
				MeleeAttack shot;
				shot.hitBonus = attackBonus;
				shot.damage   = it->getDamage() + strength / it->getStrDivider()
				                + cohesionDmgBonus();
				shot.pen      = it->getPen();
				shot.reach    = it->getReach();
				shot.onAttack = [this, hb = shot.hitBonus, rch = shot.reach, fx = it->getEffect()]
				                (AUnit* atk, AUnit* tgt, bool& blocked) {
					resolveRepel(tgt, blocked, hb, rch);
					if (!blocked && atk->getAlive())
						applyWeaponAttackEffect(fx, atk, tgt);
				};
				shot.onDamage = [fx = it->getEffect()](AUnit* atk, AUnit*, int damage) {
					applyWeaponDamageEffect(fx, atk, damage);
				};
				MeleeCombat::engage(this, target, shot);
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

	void AUnit::leaveSquad()
	{
		if (_squad)
			_squad->removeMember(this);
	}

	void AUnit::setAlive(bool newAlive)
	{
		if (!newAlive)
			leaveSquad();
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
		int r1 = Utility::throwDice(), r2 = Utility::throwDice();
		if ((morale + r1 - r2) >= 12)
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
	int AUnit::takeDamage(int amount, ArmorPen pen)
	{
		int eff = (pen == ArmorPen::Piercing) ? armour / 2
		        : (pen == ArmorPen::Bypass)   ? 0
		        :                               armour;
		if (amount - eff <= 0)
			return 0;
		hitpoints -= (amount - eff);
		if (hitpoints <= 0)
			setAlive(false);
		else
			testMorale(amount - eff);
		return amount - eff;
	}

	//returns true if the test is passed
	bool AUnit::testMorale(int damage)
	{
		if (undead) return true;
		if (damage <= 0) return true;
		int m1 = Utility::throwDice(), m2 = Utility::throwDice();
		if (morale + cohesionStatBonus() + m1 - m2 > damage)
			return true;
		setBroken(true);
		std::cout << "One coward valued his life more than his honor" << std::endl;
		return false;
	}

	void AUnit::recover()
	{
		fatigue = (fatigue <= fatigueRecovery) ? 0 : fatigue - fatigueRecovery;
		fatiguelvl = fatigue / FATIGUE_LEVEL_DIV;
	}

	void AUnit::increaseFatigue()
	{
		fatigue = fatigue + fatigueCost;
		fatiguelvl = fatigue / FATIGUE_LEVEL_DIV;
	}

	int AUnit::getFatigueCost() const { return fatigueCost; }

void AUnit::restoreForNextBattle()
{
	reset();           // detach from hex
	hitpoints        = maxHP;
	fatigue          = 0;
	fatiguelvl       = 0;
	broken                = false;
	placed                = false;
	_tookLateralLastMove  = false;
	cast             = 0;
	canFightThisTurn = false;
	engagedSide      = nullptr;
	spentMove        = 0;
}

	void AUnit::addFatigue(int amount)
	{
		fatigue = fatigue + amount;
		if (fatigue < 0) fatigue = 0;
		fatiguelvl = fatigue / FATIGUE_LEVEL_DIV;
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