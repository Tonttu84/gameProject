#pragma once

#include "AreaMode.hpp"
#include "Defines.hpp"
#include "hex/HexGrid.hpp"
#include <functional>
#include <unordered_map>
#include <vector>

class AUnit;

// Describes a single ranged shot. Callers fill in the relevant fields and
// optionally provide callbacks for attack-specific effects.
//
// fire() handles the structural pipeline (elevation, accuracy, deviation,
// hit resolution, universal block checks, damage, callbacks). Everything
// specific to a particular attack type — dice variance pre-rolled into
// baseDamage, physical shield rolls, life drain — belongs in onHit or onDamage.
// Two exceptions have since become fields of their own, because both are asked
// of bodies the callbacks never see: the AREA (T-6) and MAGIC RESISTANCE (T-4),
// which is contested once per body an area covers rather than once per shot.
struct RangedShot {
    int      baseDamage  = 0;
    // 0–100 base; fire() adjusts for elevation. READ BY fire() ONLY: the spell
    // entry points below are told their accuracy outright (T-1), because a
    // form's number is a modifier on the caster's and the fold happens caller-side.
    int      accuracy    = 0;
    ArmorPen pen         = ArmorPen::Normal;

    // AREA (T-6/T-7, slice TG-2). What TG-2 replaced the old `secondaryHits`
    // splash with: an area is a number of hex SIZE POINTS spread over hexes by
    // `areaMode`, and each hex covers what it received as ONE CONTIGUOUS ARC of
    // its 640 slots. A body whose slot range overlaps the arc is struck ONCE for
    // `areaDamage` — whichever side it is on, the caster included (T-7). The
    // primary body is excluded, having already taken `baseDamage`.
    //
    // The old splash rolled N independent weighted hits into the landed hex, so
    // enough hits eventually found every man in it; an arc finds the men who
    // stand where it falls. `areaPoints` 0 (the default) means no area, which is
    // every archer and every spell but fireball's major form.
    AreaMode areaMode   = AreaMode::None;
    int      areaPoints = 0;
    int      areaDamage = 0;

    // ── Magic resistance (T-4, slice TG-3) ───────────────────────────────
    //
    // Asked of EVERY body this shot would strike, before anything else happens
    // to it, and a body that answers true takes nothing: no damage, no onHit,
    // no onDamage. Empty on every archer's shot and on every untagged spell,
    // which is what makes it free — the check is the absence of a predicate.
    //
    // A PREDICATE rather than a flag on the shot, because the contest is per
    // TARGET BODY: an area that covered five men is five separate contests, one
    // per body, each rolling its own dice. The spell body fills this in with a
    // lambda closing over its caster and its own row (Spells::resisted), so the
    // ranged layer carries the question without knowing anything about spells.
    std::function<bool(AUnit* target)> resisted;

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
    // onHit callback, damage, takeDamage, onDamage callback. If the shot
    // carries an area it is covered afterwards from the landed hex, regardless
    // of whether the primary shot found a target — a miss still lands somewhere
    // and the blast goes off there. No archer sets one, so for fire() that call
    // is a no-op; it is ONE code path rather than an archer special case.
    //
    // Resource consumption (ammo, mana) and caller-specific accuracy
    // adjustments (e.g. forest aim penalty) are the caller's responsibility.
    static void fire(AUnit* shooter, AUnit* aimUnit, const RangedShot& shot);

    // ── Spell delivery (T-1, slice TG-1) ─────────────────────────────────────
    //
    // A spell is NOT an arrow any more. fire() above is the archer's pipeline
    // and stays exactly as it was; the two entry points below are the two
    // halves of T-1, and they share applyHit() and the area walk with it so what
    // a hit DOES is the same wherever it came from.
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

    // ── Area of effect (T-6, T-7 — slice TG-2) ───────────────────────────────
    //
    // Public rather than private, like pickHexTarget above it: the arc IS a
    // rule, and a rule the suite pins directly is a rule that cannot drift
    // behind a spell that happens to exercise it. SpellList.cpp's scorer walks
    // ringHexes() too, so the estimate and the explosion agree on which hexes an
    // area would reach by construction (assistant's call 2).

    // Spread shot.areaPoints out from `landedHex` per shot.areaMode and cover
    // each hex that receives points with one arc. `already` is the body the
    // primary hit struck: excluded, because a cast strikes a body ONCE (T-6).
    // Nothing happens when the shot carries no area.
    static void coverArea(AUnit* shooter, Hex* landedHex, const RangedShot& shot,
                          int elevDmgBonus, AUnit* already);

    // ONE hex, `points` of it. The bodies are laid out exactly as pickHexTarget
    // lays them out — the same slot cache, the same order, each body getSize()
    // slots wide from slot 1 — and the arc is `points` consecutive slots from a
    // rolled start, WRAPPING past 640 back to 1. Every body it overlaps is
    // struck for shot.areaDamage. points >= Hex::CAPACITY covers the hex whole
    // and rolls nothing. Appends whom it struck to `struck`, which is what keeps
    // "once per body per cast" true across the hexes of one area.
    static void coverHex(AUnit* shooter, Hex* hex, int points, const RangedShot& shot,
                         int elevDmgBonus, AUnit* already, std::vector<AUnit*>& struck);

    // The on-map hexes at EXACTLY distance k from `centre` (k = 0 is the centre
    // itself), found by BFS outward over HexGrid::neighbors and returned in
    // discovery order — which for k = 1 is neighbour order. Off-map hexes are
    // dropped, so a ring at the edge of the map is simply shorter.
    static std::vector<Hex*> ringHexes(const Hex* centre, int k);

private:
    struct SlotCache {
        std::vector<AUnit*> units; // units present when the phase began
    };
    static std::unordered_map<const Hex*, SlotCache> cache;

    static const SlotCache& getSlotCache(const Hex* hex);

    // Block checks, onHit callback, damage, takeDamage, onDamage callback
    // for a single resolved target. Shared by the primary hit and every body an
    // area covers so they go through identical rules — an area's hits are hits,
    // which is also why shot.onDamage fires once PER BODY the arc struck.
    static void applyHit(AUnit* shooter, AUnit* target, const RangedShot& shot,
                          int baseDamage, int elevDmgBonus);

    RangedCombat() = delete;
};
