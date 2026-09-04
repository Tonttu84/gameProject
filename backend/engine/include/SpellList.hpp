#pragma once
#include "Spell.hpp"
#include <string>
#include <vector>

class AUnit;

class Battlefield;
struct Reinforcement;

// The requirement-gated spell roster — mirrors WeaponList's role for weapons.
// Effect bodies live in SpellList.cpp as free functions; the engine stays a
// self-contained subprocess (no scripting layer, by decision in
// docs/UNITS_AS_DATA_PLAN.md).
namespace Spells
{
    const std::vector<Spell>& roster();

    // Can this caster cast this form right now? Checks BOTH gates a spell
    // passes (M-9): every path requirement against the caster's own levels, and
    // the school requirement against the ARMY's level for that side. Evaluated
    // per cast rather than once at construction, because research (M-6) and the
    // encounter (M-19) can both move the school line while the unit is alive.
    bool qualifies(const AUnit& caster, const SpellForm& form);

    // ── The resolver (A-1/A-8, slice AI-1) ───────────────────────────────────
    //
    // Targeting, separated from effect. Both functions below are PURE in the
    // only two senses that matter to AI-2's scorer: they change nothing on the
    // field, and they draw no dice — so "whom would this form hit" can be asked
    // as often as a scorer likes, and under TESTING it cannot eat a mock roll a
    // combat test seeded (Utility::getRandom consumes that queue).

    // Every legal target for this form's kind, in TEAM ORDER:
    //   EnemyUnit — living enemies with a hex, within the FORM's range (T-2)
    //               after the elevation tiers are clamped, exactly as the old
    //               findEnemyInRange predicate had it. Empty for an unplaced
    //               caster, who has no position to measure a range from.
    //   AllyUnit / AllyTeam — the caster ALWAYS, first and hexless (a boon on
    //               yourself crosses no distance), then every other living
    //               PLACED ally within the form's range of a PLACED caster.
    //               T-2 put a boon under the same range rule as a bolt; before
    //               TG-1 this kind checked no range at all and a Ward reached a
    //               man across the map.
    //   Adjacent / Battlefield / None — empty. These bodies need no unit
    //               target; the neighbour scan and the standing instance are
    //               the body's own business, as they have always been.
    // A-8's refresh rule lands here: for a `buff` form, a unit already carrying
    // this spell's id is NOT a candidate.
    std::vector<AUnit*> candidates(const AUnit& caster, const SpellForm& form);

    // The candidate the body is handed, by the form's pick policy. Each policy
    // reproduces exactly what the body it was lifted from used to do — the
    // offensive one still runs through Utility::findTarget so the tie-break is
    // the same one, down to the sort key.
    Target chooseTarget(const AUnit& caster, const SpellForm& form);

    // ── The scorer (A-1..A-7, slice AI-2) ────────────────────────────────────
    // worth * AI_SCORE_SCALE / divider, or 0 when the form is worth nothing here.
    // Pure, like everything the resolver does.
    int scoreOf(const AUnit& caster, const SpellForm& form, const Target& target);

    // Every option ONE spell offers this caster right now, with the BEST form
    // per target — form choice is by max, never by lottery (A-6). One option per
    // candidate for the single-unit kinds, so a lottery can pick WHICH enemy
    // (A-5's supercombatant is exactly a target that scores higher); one option
    // for the kinds that hand over no unit. Anything scoring below `floor` is
    // dropped. Pure.
    std::vector<CastOption> optionsFor(const AUnit& caster, const Spell& spell, int floor);

    // A-6 amended (AI-3's finding): a scripted line the caster is HOLDING for
    // the enemy to arrive. True when he qualifies for at least one form, every
    // qualifying form targets an EnemyUnit, and none has a single candidate —
    // nobody in range yet. Such a line is not worthless, it is early: the loop
    // keeps the cursor on it and improvises meanwhile, instead of spending the
    // whole script on the approach march before a shot was ever possible.
    // Anything else empty (nobody to skin, no corpses, a form he cannot cast)
    // stays what it was: a dead line, skipped in the same tick.
    bool awaitsRange(const AUnit& caster, const Spell& spell);

    // Look a spell up by its roster id ("fireball", "bless", ...). Returns
    // nullptr for an id the roster does not carry — the chosen-spells list
    // arrives over the wire (slice 4) and skips what it cannot resolve rather
    // than rejecting the whole entry.
    const Spell* findSpell(std::string_view id);

    // Does this spell carry a battlefield-wide enchantment form? Asked of the
    // SPELL rather than the form because everything that governs one — the
    // once-per-side-per-battle register, the exclusion from the default walk —
    // is decided per spell, and a spell that carried one sustained form among
    // ordinary ones would still be that kind of spell.
    bool isBattlefieldSpell(const Spell& s);

    // The caster's ordered default list — every roster entry, in roster order,
    // EXCEPT the battlefield-wide enchantments, which are script-only.
    // M-22: this walk IS a script, so slice 4 replaces the list rather than
    // adding a second selection path. Resolved once at unit construction
    // (AUnit::assignSpells).
    const std::vector<const Spell*>& defaultScript();

    // The roster as JSON, one row per FORM — the campaign server imports this
    // at boot the way it imports `dump-units`, so the C++ table stays the single
    // source of truth for what a spell costs and what it requires (slice 3,
    // S3-1). Pure-Holy and pure-Unholy forms export `school: null` rather than
    // being dropped: the whole roster crosses, and deciding which rows a screen
    // shows is the reader's business.
    std::string spellCatalogJson();

    // The garrison sally: a casterless reinforcement spell, modelled on
    // raise_dead. Summons `r.count` allied units of `r.unitType` (marked
    // battleSummon, so they never cross back as survivors) at the enemy's rear
    // edge and logs `r.message`. Unlike the roster spells above it takes no
    // AUnit caster — Battlefield::tick() invokes it on schedule. Written as a
    // free function so a future manual-cast path can call the same body.
    // Returns how many units were actually placed.
    int castGarrisonSally(Battlefield& field, const Reinforcement& r);
}
