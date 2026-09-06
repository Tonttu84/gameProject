#pragma once

// WHO a spell touches, of the bodies it reaches (P-8, slice NP-2).
//
// A shared header of its own, for the same reason AreaMode.hpp and
// ResistKind.hpp are ones: a SpellForm names its side tag as roster data
// (Spell.hpp), while the delivery layer is what carries it to a body
// (RangedCombat.hpp puts it on the shot), and neither should have to pull in
// the other to say one word about itself.
//
// The tag is about BEING TOUCHED, never about coverage. An area covers the
// ground it covers whoever is standing on it — the arc is a fact about where a
// blast fell, not about whose men were lucky — and the tag is then asked of
// each body the coverage found. That separation is the whole of P-8: a
// friendly-only bark scattered onto the enemy's hex still covers that hex and
// touches nobody there, which is also exactly what the scorer prices it at.
enum class Affects {
    // The default, and what T-7 wrote for fireball: everyone the shot reaches
    // is touched, the caster's own line included.
    Everyone,
    // Only bodies on the SHOOTER's own side. Boons are written this way.
    Friendly,
    // Only bodies on the other side.
    Enemy
};

// The ONE predicate both halves read — delivery in RangedCombat::applyHit and
// the estimator in SpellList's area pricer — so the two can never disagree
// about whom a form touches. Pure, tiny, and inline in the header for the same
// reason: there is nothing here to keep in a translation unit.
inline constexpr bool affectsTouches(Affects a, int shooterTeam, int targetTeam)
{
    switch (a) {
    case Affects::Friendly: return shooterTeam == targetTeam;
    case Affects::Enemy:    return shooterTeam != targetTeam;
    case Affects::Everyone: break;
    }
    return true;
}
