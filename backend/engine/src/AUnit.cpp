#include "AUnit.hpp"
#include "MeleeCombat.hpp"
#include "SpellList.hpp"
#include "Squad.hpp"
#include "WeaponEffects.hpp"
#include "UnitCatalog.hpp"
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
	hex->sizeUsed -= static_cast<int>(unit->getPackingSize());
	if (hex->sizeUsed < 0) hex->sizeUsed = 0;
}

AUnit::~AUnit()
{
	leaveSquad();
	removeFromHex(currentHex, this);
	currentHex = nullptr;
}

void AUnit::setHex(Hex* hex) {
	if (hex != currentHex) _engagedRank = 0;
	removeFromHex(currentHex, this);
	currentHex = hex;
	if (hex) {
		hex->units.push_back(this);
		// PACKING size, and it must stay paired with removeFromHex's subtraction
		// above: a unit whose formationFighter changed while it stood on a hex
		// would be removed for a different number than it was added for, and
		// leak capacity. Nothing does that today — the campaign sets the value
		// at placement, before setHex — and nothing should start.
		hex->sizeUsed += static_cast<int>(getPackingSize());
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

// The room this body takes when packed, as opposed to the body itself — see
// the header for which callers want which. Floored at 1: a packing size of 0
// passes every `used + size > cap` gate for ever, which is unlimited stacking
// rather than tight drill.
size_t AUnit::getPackingSize() const
{
	int packed = static_cast<int>(size) - formationFighter;
	return static_cast<size_t>(std::max(1, packed));
}

int AUnit::getFormationFighter() const { return formationFighter; }


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

std::string AUnit::logName() const
{
	std::string who = unitNameForSymbol(printSymbol);
	if (who.empty()) who = std::string(1, printSymbol);
	return who + (team == REDTEAM ? " (red)" : " (blue)");
}

int AUnit::defend(int AttackAttempt, int damage, ArmorPen pen, int /*attackerReach*/, bool repelCounter)
{
	int defenceroll = Utility::throwDice();

	int crampedPenalty = 0;
	if (engagedSide) {
		int eff = effectiveFrontage(*engagedSide);
		if (eff < HexSide::FRONTAGE) {
			int threshold = eff * 2 / 3;
			// PACKING size: this measures the room the unit needs on a narrow
			// side, which is exactly what formation drill changes.
			int remaining = static_cast<int>(getPackingSize());
			while (remaining > threshold) {
				crampedPenalty += CRAMPED_COMBAT_PENALTY;
				remaining      -= threshold;
			}
		}
	}

	// TRACE (L-4): the to-hit contest, both sides of it, at the one place melee
	// is actually decided. `defend` is the DEFENDER's method and never learns who
	// swung, so the line names the man who stood — which is the half a failing
	// test usually needs, since the assertion is nearly always about him.
	const int defenceTotal = defence - fatiguelvl * 2 + defenceroll + cohesionStatBonus()
	                       - crampedPenalty
	                       - _attacksReceivedThisTurn * MULTI_ATTACK_DEFENCE_PENALTY;
	if (defenceTotal >= AttackAttempt) {
		Utility::getBattlefield().logEvent(LogTier::Trace,
			logName() + " turns the blow — defence " + std::to_string(defenceTotal)
			+ " vs " + std::to_string(AttackAttempt));
		return 0;
	}

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
			Utility::getBattlefield().logEvent(LogTier::Detail, "Shield damaged by a strong blow");
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
		// M-23: a wound threatens a channel rather than ending it outright.
		// No-op for anyone not currently casting.
		testConcentration(resultDMG);
		hitpoints -= resultDMG;
		// The raw roll is logged beside what actually landed, because the gap
		// between them IS the armour and shield arithmetic above — a test that
		// expected a kill and got a scratch is nearly always reading that gap.
		Utility::getBattlefield().logEvent(LogTier::Trace,
			logName() + " is hit for " + std::to_string(resultDMG)
			+ " (raw " + std::to_string(damage) + ", defence " + std::to_string(defenceTotal)
			+ " vs " + std::to_string(AttackAttempt) + ") — "
			+ std::to_string(hitpoints > 0 ? hitpoints : 0) + " hp left");
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
						int remaining = static_cast<int>(getPackingSize());
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
	// (after accounting for rank — see below) gets an opposed roll to
	// interrupt it before damage lands. The original target always gets first
	// try (regardless of its own repelMalus); if it doesn't win, any other
	// alive, non-broken enemy sharing the same formation side (or, if the
	// target itself was undefended, anyone else in its hex) with
	// repelMalus==0 and enough reach gets pulled in next, in sortKey order.
	// The first defender to win the opposed roll decides the outcome for this
	// attack; everyone who attempted (win or lose) pays a stacking -1 malus
	// to their own future repels this turn.
	//
	// Support ranks: a defender standing in rank 2/3 (behind the man actually
	// holding the boundary) fights from further back, so its weapon's reach
	// is reduced by (rank - 1) for repel purposes — both for qualifying at
	// all and for the reach bonus added to its own roll. A reach-3 spear can
	// still repel from rank 1, but only a reach-4 pike reaches far enough to
	// repel from rank 2. Unseated units (rank 0 — a loner not yet seated in
	// any formation, e.g. a hand-built test defender) are treated as rank 1:
	// no reduction. This same rank check applies to originalTarget as much as
	// to cascade candidates — before this, a rank-2/3 unit that became the
	// primary target via find_target()'s undefended-hex fallback could repel
	// at its full, un-reduced weapon reach, the one way the front-rank-only
	// repel ability could leak onto support ranks.
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

		// Pairs a repel-eligible sub-unit with the *composite's* engaged rank
		// (MountedUnit's syncTacticalState() doesn't copy rank onto rider/mount,
		// so it's carried alongside rather than read back off the part).
		struct RepelCandidate { AUnit* unit; int rank; };

		// A broken primary target doesn't fight back, but the cascade to other
		// eligible defenders sharing its formation side (or hex, if undefended)
		// is still open — see the "others" loop below, which already excludes
		// broken candidates the same way. getBroken() is read at the composite
		// level so a MountedUnit reports correctly: it defers to the rider
		// while mounted, so a panicking mount under a calm rider's control is
		// NOT considered broken here, and a calm mount under a broken rider IS
		// — see MountedUnit::getBroken()/effectTarget().
		std::vector<RepelCandidate> candidates;
		if (!originalTarget->getBroken()) {
			int rank = originalTarget->getEngagedRank();
			for (AUnit* part : originalTarget->repelParts())
				candidates.push_back({part, rank});
		}

		std::vector<RepelCandidate> others;
		for (AUnit* u : hex->units) {
			if (!u || u == originalTarget || !u->getAlive() || u->getBroken()) continue;
			if (u->getTeam() == team) continue;
			// formationSide (set for every ranked unit) rather than
			// engagedSide (rank 1 only) — so a rank 2/3 teammate sharing the
			// same boundary is a valid cascade candidate too, not just
			// whoever is actually holding it. engagedSide is also checked so
			// a hand-built defender with only engagedSide set (no formation
			// at all) still matches, same as before this change.
			if (side && u->getEngagedSide() != side && u->getFormationSide() != side) continue;
			int rank = u->getEngagedRank();
			for (AUnit* part : u->repelParts())
				if (part->getRepelMalus() == 0) others.push_back({part, rank});
		}
		std::sort(others.begin(), others.end(),
		          [](const RepelCandidate& a, const RepelCandidate& b) { return a.unit->sortsBefore(b.unit); });
		candidates.insert(candidates.end(), others.begin(), others.end());

		for (RepelCandidate& cand : candidates) {
			AUnit* def = cand.unit;
			if (def->_attacks.empty()) continue;
			// A defender with several weapons of differing reach repels with
			// whichever one reaches furthest, not just its first weapon — but
			// still only one attempt total, same as a single-weapon defender.
			const Weapon* defWeaponPtr = &def->_attacks.front();
			for (const Weapon& w : def->_attacks)
				if (w.getReach() > defWeaponPtr->getReach()) defWeaponPtr = &w;
			const Weapon& defWeapon = *defWeaponPtr;

			int rankDepth = std::max(cand.rank, 1) - 1; // rank 1 (or unseated) -> 0, rank 2 -> 1, rank 3 -> 2
			int effReach  = defWeapon.getReach() - rankDepth;
			if (effReach <= attackerReach) continue;

			int attackerRoll = attackPWR - fatigue + attackerHitBonus + attackerReach + Utility::throwDice();
			int defenderRoll = def->attackPWR - def->fatigue + def->computeMeleeAttackBonus()
			                  + effReach + Utility::throwDice() - def->repelMalus;
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
			Utility::getBattlefield().logEvent(LogTier::Detail,
				"With nowhere to flee to a soldier rallies");
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

	void AUnit::assignSpells(std::string_view unitTypeName)
	{
		(void) unitTypeName;
		// The default list is the whole roster in priority order — the implicit
		// script of M-22. What this unit may actually cast is decided per cast
		// against its paths and the army's school level, NOT filtered here:
		// research (M-6) and the encounter (M-19) both move that line while the
		// unit is alive, and paths arrive from the placement entry after
		// construction anyway.
		_spells = Spells::defaultScript();
	}

	void AUnit::setChosenSpells(const std::vector<std::string>& spellIds)
	{
		// S4-1: the chosen ones lead, the rest of the roster follows in its own
		// order. Rebuilt from the default list every call rather than shuffled
		// in place, so setting a list twice cannot compound.
		std::vector<const Spell*> ordered;
		for (const std::string& id : spellIds) {
			const Spell* s = Spells::findSpell(id);
			if (!s) continue;   // an id the roster does not know is skipped
			bool already = false;
			for (const Spell* seen : ordered)
				if (seen == s) { already = true; break; }
			if (!already) ordered.push_back(s);
		}
		for (const Spell* s : Spells::defaultScript()) {
			bool chosen = false;
			for (const Spell* seen : ordered)
				if (seen == s) { chosen = true; break; }
			if (!chosen) ordered.push_back(s);
		}
		_spells = std::move(ordered);
	}

	int AUnit::getPathLevel(SpellPath p) const
	{
		if (p == SpellPath::Count) return 0;
		return _pathLevels[static_cast<size_t>(p)];
	}

	void AUnit::setPathLevel(SpellPath p, int level)
	{
		if (p == SpellPath::Count) return;
		// Paths run 1-9 (M-16); clamp rather than reject, on the same
		// never-throw discipline the JSON boundary uses for every other field.
		if (level < 0) level = 0;
		if (level > SPELL_PATH_MAX_LEVEL) level = SPELL_PATH_MAX_LEVEL;
		_pathLevels[static_cast<size_t>(p)] = level;
	}

	bool AUnit::hasAnyPath() const
	{
		for (int lvl : _pathLevels)
			if (lvl > 0) return true;
		return false;
	}

	int AUnit::spellFatigueCost(const SpellForm& form) const
	{
		if (form.paths.empty()) return form.fatigue + fatigueCost;
		// M-20: the divide reads the PRIMARY path and nothing else. A Fire 5
		// casting a Fire 1 spell pays a fifth of what a Fire 1 pays.
		const PathRequirement& primary = form.paths.front();
		int excess = getPathLevel(primary.path) - primary.level + 1;
		if (excess < 1) excess = 1;   // cannot legally cast below the requirement anyway
		int cost = form.fatigue / excess;
		// M-21: Low pays HALF — the shortcut it exists to offer. Applied to the
		// spell's own term only, never to encumbrance: the body's burden is the
		// body's, not the bargain's. (Assistant's call; M-10 fixes the shape of
		// the formula but not which term the halving lands on.)
		if (primary.path == SpellPath::Low) cost /= 2;
		// M-10's additive floor — the unit's existing fatigueCost is Dominions'
		// encumbrance under a name we already have. Without it a high-level
		// caster spamming a cheap spell would pay almost nothing.
		return cost + fatigueCost;
	}

	bool AUnit::testConcentration(int damage)
	{
		if (!isChannelling()) return true;
		if (damage <= 0) return true;
		int focus = 0;
		if (!_channelForm->paths.empty())
			focus = getPathLevel(_channelForm->paths.front().path) * CONCENTRATION_PER_LEVEL;
		int m1 = Utility::throwDice(), m2 = Utility::throwDice();
		if (focus + m1 - m2 > damage) return true;
		Utility::getBattlefield().logEvent(LogTier::Detail,
			"A spell slips from a wounded caster's grasp");
		_channelSpell = nullptr;
		_channelForm  = nullptr;
		setCast(0);
		return false;
	}

	const SpellForm* AUnit::chooseSpellToCast(const Spell** outSpell) const
	{
		// M-22: walk the ordered list, take the most POWERFUL form qualified for
		// (M-13), skip what the gates disallow. No affordability test exists —
		// see the note on the declaration.
		for (const Spell* s : _spells) {
			if (!s) continue;
			// E-4: once per side PER BATTLE for a battlefield-wide enchantment. A
			// side that has already called one may not call it again, even
			// after the instance ended with its sustainer. The skip is of the
			// whole SPELL, not of a form, and it falls through to this
			// caster's next line — M-22's walk doing what it already does with
			// a line it cannot use, rather than a new kind of failure.
			if (Spells::isBattlefieldSpell(*s)
			    && Utility::getBattlefield().enchantmentCastAlready(getTeam(), *s))
				continue;
			const SpellForm* best = nullptr;
			for (const SpellForm& f : s->forms)
				if (Spells::qualifies(*this, f)) best = &f;  // later forms are stronger
			if (best) {
				if (outSpell) *outSpell = s;
				return best;
			}
		}
		return nullptr;
	}

	void AUnit::castSpells()
	{
		if (!alive || broken) {
			// A dropped channel is simply lost; nothing was paid for it (M-23).
			_channelSpell = nullptr;
			_channelForm  = nullptr;
			return;
		}
		if (_spells.empty() || !hasAnyPath()) return;

		// Already channelling: burn a tick, and fire when the last one is spent.
		if (isChannelling()) {
			if (cast > 0) setCast(cast - 1);
			if (cast > 0) return;
			completeCast();
			return;
		}

		// No hex gate here: spells that need the caster placed on the grid
		// (fireball's range check, raise_dead's neighbor scan) check it in
		// their own bodies — bless works from anywhere, as it always has.
		const Spell* chosen = nullptr;
		const SpellForm* form = chooseSpellToCast(&chosen);
		if (!form) return;
		_channelSpell = chosen;
		_channelForm  = form;
		// A caster BEGINNING to channel is Detail (L-2) — the user asked to see
		// "mages preparing to cast" a tier below the cast itself. The cast line
		// on completeCast() stays Basic, so a spell that fires is always visible
		// and only the wind-up needs the deeper setting.
		Utility::getBattlefield().logEvent(LogTier::Detail,
			logName() + " begins to channel " + std::string(form->label));
		// Minimum one turn (M-23) — nothing casts instantly, so even the
		// cheapest spell occupies its caster for a tick.
		setCast(form->castingTime > 1 ? form->castingTime : 1);
		// The tick that starts a channel is spent starting it; the spell fires
		// on a later tick, when the count runs out.
		if (cast > 0) setCast(cast - 1);
		if (cast == 0) completeCast();
	}

	void AUnit::completeCast()
	{
		const Spell*     spell = _channelSpell;
		const SpellForm* form  = _channelForm;
		_channelSpell = nullptr;
		_channelForm  = nullptr;
		if (!form) return;

		// Try the chosen form, then CYCLE DOWN through this spell's weaker forms
		// (user, 2026-08-25: "try major if gate closed for any reason, try
		// minor"). A form can fail for reasons selection cannot see — raise_dead's
		// major wants corpses the field has not produced yet — so the fallback
		// belongs here, at the moment of casting, and not in chooseSpellToCast.
		//
		// A body that finds no legal target reports false and costs NOTHING:
		// M-23's rule is that fatigue POWERS the spell, so no spell, no fatigue.
		// That is what makes cycling free rather than a way to burn a caster out.
		const SpellForm* fired = form->cast(*this) ? form : nullptr;
		if (!fired && spell) {
			size_t start = spell->forms.size();
			for (size_t i = 0; i < spell->forms.size(); ++i)
				if (&spell->forms[i] == form) { start = i; break; }
			// forms run weakest-first, so walking DOWN from the chosen one tries
			// the next-strongest each time.
			for (size_t i = start; i-- > 0; ) {
				const SpellForm& weaker = spell->forms[i];
				if (!Spells::qualifies(*this, weaker)) continue;
				if (weaker.cast(*this)) { fired = &weaker; break; }
			}
		}
		if (!fired) return;
		form = fired;   // everything below prices the form that ACTUALLY fired

		// S4-8: name the cast. Every spell effect logs its own flavour, but
		// nothing said WHO cast WHAT — and the damage spells resolve as an
		// ordinary RangedShot and so logged nothing at all, which left a player
		// with no way to tell whether their chosen spells did anything. Named
		// after the form that ACTUALLY fired, so M-26's fall-through reads
		// honestly: a major that degraded reports the minor.
		//
		// Same symbol->name lookup and (red)/(blue) tag Battlefield::logDeaths
		// uses, for one voice across the log. Tiered logging (L-1..L-6) shipped
		// after this line was written and the prediction held: the bare
		// logEvent() overload is Basic, so a spell that FIRES is visible at
		// every depth, while the wind-up above it sits a tier deeper.
		{
			Utility::getBattlefield().logEvent(
				logName() + " casts " + std::string(form->label));
		}

		int cost = spellFatigueCost(*form);
		// E-2: a battlefield-wide enchantment pays its poolCost IN FULL and takes
		// NO discount — poolCost is the pool's whole involvement in one of these,
		// so applying M-11's per-cast shave on top would spend the same
		// channels twice for one casting. The fatigue is paid in full too — the
		// pool buys the spell, not the caster's breath.
		if (form->enchantAim != EnchantAim::None) {
			Utility::getBattlefield().drawChannels(team, form->poolCost);
		}
		// M-11: banners are the allowance, and a caster draws from the ARMY-WIDE
		// pool rather than a squad's own. Capped at the caster's PRIMARY path
		// level, which is Dominions' "spend up to your path level in gems to cut
		// fatigue" — the shape M-11 says it is delivering. (Assistant's call:
		// M-11 fixes the pool and its scope, not the per-cast cap.)
		else if (!form->paths.empty()) {
			int cap = getPathLevel(form->paths.front().path);
			cost -= Utility::getBattlefield().drawChannels(team, std::min(cost, cap));
		}
		addFatigue(cost);
		// M-24: Low casts twice — once against them, once against you.
		if (form->price) form->price(*this);
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

	// One flat modifier onto one named stat — see the header for why this is
	// bounded and why an unknown name is inert.
	//
	// ballisticSkill goes through setBallisticSkill rather than the member,
	// because `accuracy` is DERIVED from it (accuracy = bs * 5) and writing the
	// member directly would leave the two disagreeing — the exact bug the
	// setter exists to prevent.
	//
	// Floors, not just clamps: a stat driven to or below zero by a hostile
	// request would make a unit behave in ways no balance pass has ever seen
	// (a speed of 0 never moves, a negative one moves backwards through the
	// movement bank). Attack and ballistic skill floor at 0 — harmless, just
	// useless — while speed floors at 1 so a unit always advances.
	bool AUnit::applyStatMod(const std::string& stat, int delta)
	{
		if (delta > MAX_STAT_MOD)  delta = MAX_STAT_MOD;
		if (delta < -MAX_STAT_MOD) delta = -MAX_STAT_MOD;

		if (stat == "attack") {
			attackPWR = std::max(0, attackPWR + delta);
			return true;
		}
		// ── The gear stat vocabulary (slice 9a, decision 9-5) ─────────────
		// "Values should be the stuff that we show as numbers on a character
		// sheet. Anything tricky is an ability." (user, 2026-08-24)
		//
		// maxHP is the sheet number; `hitpoints` is NOT a stat and can never be
		// modded directly. HP is REGENERATED from maxHP here, which is what
		// stops a suit of armour making its wearer start the battle already
		// wounded — the user's explicit call: "maxHP should of course be the one
		// that gets changed, not the HP".
		//
		// Floored at 1 rather than 0: a body whose maximum is zero is dead
		// before the first tick, and gear must never be able to kill its
		// bearer. MAX_STAT_MOD already bounds how far a legal one can push.
		if (stat == "maxHP") {
			maxHP = std::max(1, maxHP + delta);
			hitpoints = maxHP;
			return true;
		}
		if (stat == "defence") {
			defence = std::max(0, defence + delta);
			return true;
		}
		// >1 means "try to hold this hex distance"; 0/1 means "advance to
		// melee". A negative mod can therefore walk an archer INTO the line,
		// which is a legitimate thing for an item to do.
		if (stat == "preferredRange") {
			preferredRange = std::max(0, preferredRange + delta);
			return true;
		}
		if (stat == "armour") {
			armour = std::max(0, armour + delta);
			return true;
		}
		if (stat == "speed") {
			movementSpeed = std::max(1, movementSpeed + delta);
			return true;
		}
		if (stat == "ballisticSkill") {
			setBallisticSkill(std::max(0, ballisticSkill + delta));
			return true;
		}
		// No floor here: the floor belongs on the DERIVED figure, and
		// getPackingSize() applies it. Clamping the modifier instead would make
		// the cap depend on what the unit's real size happens to be, and would
		// quietly forbid the negative (packs looser) direction the split exists
		// to allow.
		if (stat == "formationFighter") {
			formationFighter += delta;
			return true;
		}
		return false;
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
		if (hasAbility(UnitAbility::Fearless)) return true;
		if (damage <= 0) return true;
		int m1 = Utility::throwDice(), m2 = Utility::throwDice();
		if (morale + cohesionStatBonus() + m1 - m2 > damage)
			return true;
		setBroken(true);
		Utility::getBattlefield().logEvent("One coward valued his life more than his honor");
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
	_formationSide   = nullptr;
	_engagedRank     = 0;
	spentMove        = 0;
	_movePoints      = 0;
}

	void AUnit::addFatigue(int amount)
	{
		fatigue = fatigue + amount;
		if (fatigue < 0) fatigue = 0;
		// M-2: the pool runs past the ordinary ceiling into BLOOD. This is the
		// single mutation site for fatigue, which is why the rule lands here and
		// reaches every unit for free — ordinary troops will never march
		// themselves this far, but a spell can put anyone here.
		if (fatigue > FATIGUE_HARD_MAX) {
			int overflow = fatigue - FATIGUE_HARD_MAX;
			fatigue      = FATIGUE_HARD_MAX;   // clamps, never above
			int wounds    = overflow / FATIGUE_PER_WOUND;
			int remainder = overflow % FATIGUE_PER_WOUND;
			// The fraction is rolled: 1 point over is a 25% chance of a wound.
			if (remainder > 0 && Utility::getRandom(1, FATIGUE_PER_WOUND) <= remainder)
				++wounds;
			if (wounds > 0) {
				hitpoints -= wounds;
				if (hitpoints < 1) setAlive(false);
			}
		}
		fatiguelvl = fatigue / FATIGUE_LEVEL_DIV;
	}

	UnitAbility AUnit::abilities() const
	{
		// Granted abilities apply only while the unit is IN the squad the
		// banner flies over (6-6). A fleeing unit has already left it
		// (Battlefield::flee -> leaveSquad), so it loses the gift by leaving
		// rather than by any strip step.
		UnitAbility set = _innateAbilities;
		if (_squad) set |= _grantedAbilities;
		// Gear's gift, unscoped — for exactly the reason gear's denial below is.
		// It is worn on the body, so a man who breaks and runs keeps it, and a
		// LOOSE unit that is in no squad at all still has it. Sharing a set with
		// the grant above is what used to drop a loose character's gear ability
		// in silence.
		set |= _carriedAbilities;
		// Gear's denial (9-4), applied BEFORE the closure and never after.
		// The order is the whole safety argument: a row that denies an implied
		// flag is legal to write and does nothing, because abilityClosure()
		// below puts it straight back. An undead that leaves a corpse stays
		// unwritable no matter what any future item says.
		//
		// Unscoped by squad, like the carried gift above and unlike the banner's
		// grant: gear is worn on the body, so a man who breaks and runs takes his
		// cursed helm with him. Subtracted AFTER the carried set is folded in, so
		// one item denying what another grants resolves as denial wins.
		set = withoutAbilities(set, _suppressedAbilities);
		return abilityClosure(set);
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