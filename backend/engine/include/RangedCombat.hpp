#pragma once

#include "Defines.hpp"
#include "hex/HexGrid.hpp"
#include <functional>
#include <unordered_map>

class AUnit;

// Describes a single ranged shot. Callers fill in the relevant fields and
// optionally provide callbacks for attack-specific effects.
//
// fire() handles the structural pipeline (elevation, accuracy, deviation,
// hit resolution, universal block checks, damage, callbacks). Everything
// specific to a particular attack type — dice variance pre-rolled into
// baseDamage, physical shield rolls, magic resistance, AoE, life drain —
// belongs in onHit or onDamage.
struct RangedShot {
    int      baseDamage  = 0;
    // 0–100 base; fire() adjusts for elevation. READ BY fire() ONLY: the spell
    // entry points below are told their accuracy outright (T-1), because a
    // form's number is a modifier on the caster's and the fold happens caller-side.
    int      accuracy    = 0;
    ArmorPen pen         = ArmorPen::Normal;

    // AoE splash: after the primary shot resolves (hit or miss), fire() picks
    // `secondaryHits` additional weighted-random units from the landed hex
    // (same pickHexTarget pool, same block/damage pipeline) and damages each
    // for `secondaryDamage` + elevation bonus. 0 means no splash (the default).
    int secondaryHits   = 0;
    int secondaryDamage = 0;

    // Called after the universal block checks (extraShield, terrain) for the
    // primary hit only. `blocked` is by reference so the callback can apply
    // additional block logic (physical shield, magic resist) and fire() will
    // apply SHIELDREDUCTION on the final value.
    // Both attacker and target are provided for stat-dependent effects
    // (magic penetration, life drain, etc.).
    std::function<void(AUnit* attacker, AUnit* target, bool& blocked)> onHit;

    // Called only when finalDamage > 0, after takeDamage.
    std::function<void(AUnit* attacker, AUnit* target, int damage)>    onDamage;
};

// All hit-resolution logic shared by ranged units (archers, mages, etc.).
//
// Slot-cache: the target hex is treated as a 640-slot pool keyed by unit size.
// The cache is built once per hex at the start of each special phase and reused
// for every shot that lands there. Units that die mid-phase stay in the table —
// arrows and spells don't have infinite speed.

class RangedCombat
{
public:
    // Call once at the start of every special phase to clear stale cache entries.
    static void resetCache();

    // Pick a random unit in a hex weighted by size (1–640 roll).
    // Returns nullptr if the hex was empty at phase start or the roll missed.
    static AUnit* pickHexTarget(const Hex* hex);

    // Resolve whether a shot hits the intended individual or a random unit in
    // the landed hex.
    //   - Aimed hit: intendedTarget is alive in landedHex, distance ≤ accuracy/10,
    //     and getRandom(1,100) ≤ accuracy.  Returns intendedTarget.
    //   - Otherwise: returns pickHexTarget(landedHex) — whoever the projectile
    //     finds in the formation.
    // Pass intendedTarget=nullptr to always get a random hex hit.
    static AUnit* resolveHit(AUnit* intendedTarget, Hex* landedHex,
                             int distance, int accuracy);

    // Full ranged attack pipeline: elevation, accuracy clamp, deviation,
    // hit resolution, universal block checks (extraShield + terrain),
    // onHit callback, damage, takeDamage, onDamage callback. If
    // shot.secondaryHits > 0, also splashes that many weighted-random hits
    // onto the landed hex (same pipeline, shot.secondaryDamage), regardless
    // of whether the primary shot found a target — a miss still lands
    // somewhere and the blast goes off there.
    //
    // Resource consumption (ammo, mana) and caller-specific accuracy
    // adjustments (e.g. forest aim penalty) are the caller's responsibility.
    static void fire(AUnit* shooter, AUnit* aimUnit, const RangedShot& shot);

    // ── Spell delivery (T-1, slice TG-1) ─────────────────────────────────────
    //
    // A spell is NOT an arrow any more. fire() above is the archer's pipeline
    // and stays exactly as it was; the two entry points below are the two
    // halves of T-1, and they share applyHit() and the secondary-hits loop with
    // it so what a hit DOES is the same wherever it came from.
    //
    // Neither reads `shot.accuracy`: the caller has already folded the form's
    // modifier into the caster's stat (spellAccuracy), so the argument — or, for
    // a precise strike, the absence of one — is the truth.

    // PRECISE (accuracy SPELL_PRECISE): it strikes the man it was aimed at. No
    // deviation, no aimed-hit roll, no accuracy read at all. What the hit DOES
    // is untouched — armour, the cover and shield block rolls and the elevation
    // DAMAGE bonus all still apply; "precise" is about arriving, not about
    // mattering more.
    static void strike(AUnit* shooter, AUnit* target, const RangedShot& shot);

    // IMPRECISE (assistant's call 1): scatter IS the miss. The shot deviates by
    // Utility::Deviate at `accuracy` — elevation adjusted in here, as fire()
    // does it — and whoever the landed hex holds takes it: the aimed man if the
    // shot stayed on his hex, otherwise one body there by size weight, which
    // may be the caster's own side (T-7 says that is intended). Nobody, if the
    // hex is empty. The archer's separate "roll <= accuracy to hit the aimed
    // man" is deliberately NOT applied to a spell.
    static void scatter(AUnit* shooter, AUnit* aimUnit, const RangedShot& shot,
                        int accuracy);

private:
    struct SlotCache {
        std::vector<AUnit*> units; // units present when the phase began
    };
    static std::unordered_map<const Hex*, SlotCache> cache;

    static const SlotCache& getSlotCache(const Hex* hex);

    // Block checks, onHit callback, damage, takeDamage, onDamage callback
    // for a single resolved target. Shared by the primary hit and every
    // secondary splash hit so they go through identical rules.
    static void applyHit(AUnit* shooter, AUnit* target, const RangedShot& shot,
                          int baseDamage, int elevDmgBonus);

    // The splash loop, shared by fire(), strike() and scatter(): shot.secondaryHits
    // weighted-random bodies out of the hex the shot landed on, each through
    // applyHit like the primary. One copy, so a blast is the same blast whoever
    // threw it.
    static void secondaryHitsOn(AUnit* shooter, Hex* landedHex, const RangedShot& shot,
                                 int elevDmgBonus);

    RangedCombat() = delete;
};
