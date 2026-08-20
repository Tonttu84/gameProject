#pragma once

#include "Defines.hpp"

// The ability IMPLICATION closure (docs/CAMPAIGN_PLAN.md, slice 6 decision 6-3).
//
// Some abilities imply others, and the implications are DECLARED in one table
// rather than repeated at every site that assigns abilities. A type declares
// `Undead | Mindless` and RECEIVES `Fearless | NoCorpse` — nobody can forget the
// pairing, because nobody types it.
//
// The user's reason for the table, and the bug it exists to make unwritable:
// "I worry a bit if the nocorpse is split from undead we will accidentally
// create undead that leave a corpse at some point." A CI test asserting the
// pairing would only DETECT that; the closure makes it unrepresentable, and it
// covers abilities granted at runtime (a squad's banner) as well as declared
// ones, which no static check could.
//
// Declared today, and only these:
//     Mindless => Fearless   (the immunity comes from mindlessness, not undeath)
//     Undead   => NoCorpse
//
// Note what is deliberately ABSENT: Undead does NOT imply Fearless. A lich or a
// vampire is precisely an undead thing that CAN be rattled, and the implication
// would make it unexpressible.
//
// Idempotent and order-independent: applied to an already-closed set it returns
// that set unchanged, so a caller may run it as often as it likes.
UnitAbility abilityClosure(UnitAbility declared);
