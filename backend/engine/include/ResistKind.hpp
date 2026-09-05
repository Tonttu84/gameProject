#pragma once

// Whether a spell form can be RESISTED, and how (T-4, slice TG-3).
//
// A shared header of its own, for the same reason AreaMode.hpp is one: a
// SpellForm names its resist kind as roster data (Spell.hpp), while the
// delivery layer is what carries the contest to a body (RangedCombat.hpp holds
// a per-shot predicate), and neither should have to pull in the other to say
// one word about itself.
//
// Dominions' shape, which is the shape the user asked for: the tag says a spell
// CAN be resisted, and the contest itself is one opposed throw per target body —
// the caster's base power, plus what he holds in the form's primary path above
// its requirement, plus his penetration, against the target's resistance and the
// form's own signed `resistMod`, both sides adding the engine's exploding die.
enum class ResistKind {
    // The default, and what most of the roster is: the spell simply happens.
    // A form left untagged cannot be resisted, and the contest is never rolled
    // for it — so an untagged form draws no dice at all.
    None,
    // Resisting NEGATES: the body that wins the contest takes nothing from this
    // cast. Not "half effect", not "shorter duration" — one outcome, because
    // the roster has nothing yet that would mean anything else, and a kind
    // nothing uses is a kind nobody can get right.
    Negates
};
