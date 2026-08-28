#pragma once
#include <string>
#include <string_view>
#include <vector>
#include <array>

class AUnit;
class Battlefield;

// A castable spell — roster data one level up from Weapon: the unit provides
// the body (path levels, the channel slot), the spell provides everything that
// is delivered. See "THE MAGIC SYSTEM" in docs/CAMPAIGN_PLAN.md, which is the
// authority for every rule referenced by number below, and Stage R4 of
// docs/UNITS_AS_DATA_PLAN.md, which this supersedes.

// ── The ten paths (M-3) ──────────────────────────────────────────────────────
// The four elements are the spine; High is studied and Low is bargained (M-4);
// Holy/Unholy carry the light-versus-dark axis. Blood and Glamour are
// deliberately NOT here — in Dominions each is a subsystem rather than a name,
// and a path with no subsystem behind it is empty content.
enum class SpellPath : int {
    Fire = 0, Earth, Water, Air, High, Low, Nature, Death, Holy, Unholy,
    Count
};
constexpr int SPELL_PATH_COUNT = static_cast<int>(SpellPath::Count);

// Paths run 1-9, Dominions' full scale (M-16). Act one reaching only the low
// end is headroom, not dead range.
constexpr int SPELL_PATH_MAX_LEVEL = 9;

std::string_view spellPathName(SpellPath p);
// Returns SpellPath::Count for a name the engine does not know — callers at the
// JSON boundary skip rather than throw, like every other field there.
SpellPath        spellPathFromName(std::string_view name);

// ── The four schools (M-8/M-9) ───────────────────────────────────────────────
// Orthogonal to paths, so a spell is gated TWICE: by the army's school level
// and by the caster's path level. Construction ships empty by the user's call —
// it is the home for magic-item crafting, which has its own interview pending.
enum class SpellSchool : int {
    Evocation = 0, Conjuration, Enchantment, Construction,
    Count,
    None      // pure-Holy spells carry no school gate at all (M-14)
};
constexpr int SPELL_SCHOOL_COUNT = static_cast<int>(SpellSchool::Count);

// Slice 1 defaults the school gate WIDE OPEN. The engine owns the gate from the
// start (M-14 asks for exactly that, so slice 2 retrofits nothing), but until
// the campaign layer is sending real research numbers an absent `magic` block
// must not remove magic from a battle that already has it. Slice 2 starts
// sending real — and lower — values.
constexpr int SPELL_SCHOOL_OPEN_DEFAULT = 9;
constexpr std::array<int, SPELL_SCHOOL_COUNT> spellSchoolsOpen()
{
    std::array<int, SPELL_SCHOOL_COUNT> levels{};
    for (int& lvl : levels) lvl = SPELL_SCHOOL_OPEN_DEFAULT;
    return levels;
}

std::string_view spellSchoolName(SpellSchool s);
SpellSchool      spellSchoolFromName(std::string_view name);

// ── Requirements (M-14, M-20) ────────────────────────────────────────────────

// One entry of a spell's requirement list.
struct PathRequirement {
    SpellPath path;
    int       level;
};

// ── Battlefield-wide enchantments (E-4, E-5) ─────────────────────────────────
// A form whose aim is not None is not delivered at a target and then finished:
// it is SUSTAINED. One standing instance, tagged with the caster holding it up
// and the side that paid for it, lasting until the battle ends or until that
// caster stops being alive.
//
// E-5 fixes what each aim means:
//   Friendly — the instance benefits ITS OWN side. Both sides may hold one of
//              the same spell at once, and both then benefit from their own.
//   Everyone — the effect is symmetric, so it applies ONCE while any instance
//              stands, whoever cast it. Two instances never press twice on the
//              same body; a symmetric spell would otherwise reward whichever
//              side called it second. Each side's cast is still its OWN
//              instance, so killing one sustainer ends only that copy.
enum class EnchantAim { None, Friendly, Everyone };

// A single castable form. M-12 gives one spell a MINOR and a MAJOR form rather
// than a ladder of near-duplicates, so each form carries its own gates, price
// and effect — otherwise "the best form you qualify for" (M-13) has nothing to
// test.
struct SpellForm {
    // "minor" | "major". Addressable because slice 4's scripts name the form
    // deliberately, while the AI takes the best one the caster qualifies for.
    std::string_view name;

    // What the player is shown instead of the id (slice 3, S3-1). A form is the
    // row The Study draws, so the NAME belongs to the form and not to the spell
    // above it: "Ember" and "Fireball" are two rows, not one row with a rank.
    std::string_view label;

    // One paragraph on what the spell does, revealed when the player expands
    // the row (S3-4) — the menu itself carries only the label.
    //
    // BUILT from the same constants the effect body reads, never typed out as a
    // literal, so a retuned number moves the sentence with it. This screen is
    // the player's only written source on what a spell does, and a description
    // that said "4 damage" would start lying the day EMBER_DAMAGE changed.
    std::string description;

    // ORDERED, highest requirement first. paths[0] is the PRIMARY path (M-20):
    // it decides the fatigue divide, the effect scaling and the character of
    // the casting. Every later entry does exactly one thing — you cannot cast
    // without it. Ordered rather than a set precisely because [0] is
    // load-bearing. NEVER name this "major path": major is taken, see M-20's
    // naming note.
    std::vector<PathRequirement> paths;

    // SpellSchool::None means no school gate — what a pure-Holy blessing has
    // (M-14). A spell needing both Holy and an arcane path DOES carry one,
    // possibly at level 0.
    SpellSchool school;
    int         schoolLevel;

    // Authored cost, before M-10's divide and before Low's halving (M-21).
    // Balance-deferred like every number here.
    int fatigue;

    // Ticks the caster is occupied, MINIMUM 1 (M-23) — nothing casts instantly.
    // This replaces the old post-cast cooldown outright.
    int castingTime;

    // Targeting + effect. Returns true if the spell actually fired; only then
    // is fatigue paid, which is the whole of M-23's rule that fatigue POWERS
    // the spell, so no spell means no fatigue.
    bool (*cast)(AUnit& caster);

    // M-24: Low's bargain. A Low-primary spell is authored as TWO effects that
    // both resolve — the intended one aimed outward and this one aimed at your
    // own side (the caster bleeds, allies burn, an ally dies). nullptr for
    // every path that does not bargain. Runs only after cast() reports true.
    bool (*price)(AUnit& caster);

    // ── The battlefield-wide fields ──────────────────────────────────────────
    // Defaulted, and LAST in the struct on purpose: every ordinary roster row
    // is aggregate-initialised positionally, so a sustained spell adds three
    // fields without touching a single existing line.

    // None for every ordinary spell. Anything else marks this form as a
    // battlefield-wide enchantment, with the semantics above.
    EnchantAim enchantAim = EnchantAim::None;

    // E-2: channels drawn IN FULL from the side's army-wide pool — and it is
    // the EXISTING banner pool (M-11), not a new currency: the user's "gems"
    // was Dominions shorthand, dropped on purpose. Spent, not shaved off the
    // fatigue. A form the pool cannot cover does not qualify, so the walk falls
    // through to the caster's next line rather than stalling on it.
    int poolCost = 0;

    // The standing effect, applied once per tick for as long as the instance
    // stands. `team` is the side that benefits for a Friendly aim; for an
    // Everyone aim it is meaningless (0 is passed) and the body reads both
    // teams itself.
    void (*tickEffect)(Battlefield& field, int team) = nullptr;
};

struct Spell {
    std::string_view id;   // "fireball" | "bless" | "raise_dead" | ...
    // forms[0] is the minor form, forms[1] the major one where a spell has it.
    // M-18 authors one minor per path so no hire roll is a dud, plus major
    // forms for the three spells that already existed.
    std::vector<SpellForm> forms;
};
