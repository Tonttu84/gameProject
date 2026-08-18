#pragma once

#include "AUnit.hpp"
#include "Human.hpp"

// A Soldier taken into the king's own: the same drilled foot, re-armed with a
// halberd (reach 2, damage 8) and no shield. The campaign's royal_guard squad
// upgrade converts a whole line cohort into these — there is no recruit row and
// no other way one comes to exist (docs/CAMPAIGN_PLAN.md, slice 4d).
//
// WHY the defensive stats sit so far above a Soldier's, and why they are not
// padding: in MELEE, `armour` only blunts Piercing hits (AUnit::defend's
// `resultDMG -= armour / 2` branch) — the full figure applies in takeDamage,
// i.e. to arrows and spells. Against an ordinary blade the SHIELD is a
// soldier's entire mitigation: a second save at defence + shield, and
// SHIELDREDUCTION + shield * 2 off the blow when it lands. Trading sword and
// shield for a halberd therefore costs nearly all of his melee protection and
// none of his missile protection, and the +4 HP and +2 defence buy that back.
// Trim them as flat power creep and these "elites" die faster than the men they
// replaced.
//
// The downsides are deliberate: fatigue stays a Soldier's (elite drill is what
// bearing the halberd means), and unitValue 15 makes a guard the obvious spell
// target — a caster-heavy host is the counter, without weakening them in a fair
// melee.
class RoyalGuard : public Human
{
    public:
        // The same body as the Soldier it replaces (4d): a guard squad measures
        // exactly what a line squad measures, so the hex budget and the
        // packing/formation-fighters arithmetic are untouched.
        static constexpr int SIZE = 10;

        explicit RoyalGuard(int setTeam) noexcept;
        ~RoyalGuard() noexcept = default;
};
