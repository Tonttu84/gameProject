#pragma once

#include "Defines.hpp"

class AUnit;

// Dispatches a weapon's WeaponEffect tag (see Defines.hpp) to its actual
// behaviour. Kept separate from Weapon itself — and from any one weapon
// definition — so a new weapon "imports" an effect by tag instead of
// duplicating logic, and an effect can be reused across any number of
// weapons. Add new effects here, not as bespoke lambdas in AUnit.cpp.

// Fires from MeleeAttack::onAttack — i.e. on every attack attempt, before
// the normal to-hit/damage resolution (see [[design_repel]] for why onAttack
// fires there rather than only on a confirmed hit). Only MagicalChip
// currently hooks this; effects that should land regardless of whether the
// weapon's own swing connects belong here.
void applyWeaponAttackEffect(WeaponEffect effect, AUnit* attacker, AUnit* target);

// Fires from MeleeAttack::onDamage — only when the weapon's own swing dealt
// damage > 0. Only Lifedrain currently hooks this; effects that scale with
// (or require) actual damage dealt belong here.
void applyWeaponDamageEffect(WeaponEffect effect, AUnit* attacker, int damage);
