#pragma once
#include "Defines.hpp"
#include <string>
#include <string_view>
#include <vector>
#include <array>

class AUnit;
class Battlefield;
struct Spell;   // SpellForm carries a back-pointer to the spell it belongs to

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

// ── Targeting as data (A-1, A-8) ─────────────────────────────────────────────
//
// Slice AI-1 of "THE CASTING AI" in docs/CAMPAIGN_PLAN.md. Before this, every
// body found its own target: seven hand-rolled patterns and no way to ask, from
// the outside, whom a spell WOULD hit. A-1 makes that question answerable —
// targeting is declared on the form, one resolver in SpellList.cpp answers it
// with NO state change and NO dice, and the bodies became effect-only. AI-2's
// scorer is the caller that needs the question; nothing about the priority walk
// changes here.
//
// What is deliberately NOT here (A-8, and the deferred targeting front behind
// it): resistance, durations, AoE shapes, friendly fire and the delivery model.
// The buff-refresh rule below is the ONE rule this slice adds.

// The SET of legal candidates for a form — range-checked by ONE rule since T-2:
// the form's own `range`, elevation-adjusted, on the boon kinds as much as on
// the offensive one. (Until TG-1 a boon checked no range at all, which is how a
// Ward reached a man across the map.)
enum class TargetKind {
    EnemyUnit,    // one living enemy within the form's range, elevation-adjusted
    AllyUnit,     // one living ally in range — the caster always included (T-2)
    AllyTeam,     // the whole living ally line IN RANGE — greater_bless walks it
    Adjacent,     // no unit target: the body scans the caster's own neighbours
    Battlefield,  // no unit target: the spell stands over the field (E-4/E-5)
    None          // no target of any kind
};

// WHICH candidate the body is handed. Every value is named after behaviour that
// already existed — a pick is a description of today's choice, never a new
// preference. (AI-2 replaces the choosing, not the enumerating.)
enum class TargetPick {
    Densest,    // the offensive spells' scoreTarget: sizeUsed*10/(dist+1)
    Wounded,    // findAllyToAid: the first wounded ally, else the first ally
    Fatigued,   // soothing_current: the most exhausted body, none at fatigue 0
    Broken,     // bless: a broken ally first, else a wounded one
    First       // the candidate list as it stands
};

// What the resolver hands a body. `unit` for the single-target kinds, `units`
// for AllyTeam; both empty when nothing qualifies, and a body that needs a unit
// then returns false and costs nothing (M-23).
struct Target {
    AUnit*              unit = nullptr;
    std::vector<AUnit*> units;
};

// The JSON name of a target kind ("enemy_unit", "ally_unit", ...), for the
// catalog export. One direction only: nothing reads a target kind back in — the
// C++ roster is the single source of truth for what a spell targets.
std::string_view targetKindName(TargetKind k);

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

    // EFFECT ONLY, since AI-1: the target was already resolved by
    // Spells::chooseTarget() from the three fields at the bottom of this
    // struct, and the body applies what it does to what it was handed. Returns
    // true if the spell actually fired; only then is fatigue paid, which is the
    // whole of M-23's rule that fatigue POWERS the spell, so no spell means no
    // fatigue — a body handed an empty Target returns false and costs nothing.
    // TG-1 added the form itself to the signature: a shot body has to read its
    // own row's accuracy to know whether it is precise (T-1), and TG-2/TG-3 will
    // want the area and the resist tag off the same row. A body that needs
    // neither takes it as `const SpellForm& /*form*/` and says so.
    bool (*cast)(AUnit& caster, const SpellForm& form, const Target& target);

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

    // ── The targeting fields (A-1/A-8) ───────────────────────────────────────
    // Defaulted and appended for the same reason the three above are: every
    // roster row is aggregate-initialised positionally, so declaring targeting
    // costs no existing line.

    // The SET of legal candidates. None means the body needs no target at all.
    TargetKind target = TargetKind::None;

    // WHICH of them the body receives. Ignored for the kinds that hand over no
    // unit (Adjacent, Battlefield, None) and for AllyTeam, which hands over all.
    TargetPick pick = TargetPick::First;

    // A-8's refresh rule: a standing effect the target KEEPS, so the resolver
    // excludes a unit already carrying it. Without it "Stoneskin every tick" is
    // the right answer forever — applyStatMod was written for gear (9-5) and
    // clamps each delta on its own, never the total. The body marks its target
    // on success; the mark is per battle (AUnit::_activeBuffs).
    bool buff = false;

    // ── Delivery (T-1, T-2 — slice TG-1) ─────────────────────────────────────
    // Immediately after the targeting trio on purpose: a row names WHOM it may
    // hit, then how well and how far it reaches.

    // T-1: a SIGNED modifier on the caster's own accuracy stat, clamped to
    // 0..100 (spellAccuracy() below). The user's call was additive — the man
    // casting is in the number, and the form only says how forgiving the spell
    // is. Written as SPELL_PRECISE the form is PRECISE instead: no roll, no
    // scatter, no elevation or forest adjustment, it lands on the resolved
    // target. Balance-deferred like every other number on a row.
    int accuracy = 0;

    // T-2: how far this form reaches, in hexes, elevation-adjusted exactly as
    // the enemy rule always was — and BOONS ARE CHECKED TOO now, which is the
    // hole T-2 closed (a Ward used to reach a man across the map).
    int range = SPELLRANGE;

    // The spell this form belongs to, wired once at the end of roster(). A form
    // can therefore name itself: the resolver needs the id to ask the buff
    // registry about it, and AI-2's one-line-per-decision log needs it to say
    // WHICH spell scored what.
    const Spell* spell = nullptr;

    // ── The casting AI's fields (A-3/A-4, slice AI-2) ────────────────────────

    // What this form is WORTH, in unit-value units, for the target it would be
    // handed — Dominions' per-spell AI evaluation, authored per form because a
    // body's magnitude lives inside the body. PURE: no dice, no state change
    // (test_scoring.cpp's sweep holds every one to it). Returns 0 for "nothing
    // worth doing" (no target, no corpses). nullptr means the AI never chooses
    // this form — and the roster sweep fails a form left without one, so a new
    // spell cannot silently become one the AI ignores.
    int (*worth)(const AUnit& caster, const SpellForm& form, const Target& target) = nullptr;

    // A-4: a manual override of the auto divider (see spellDivider()); 0 = auto.
    // The user's knob for playtesting and modding — authored, never computed.
    int aiDivider = 0;
};

// ── T-1's two questions, asked of a row ──────────────────────────────────────
// Pure, and implemented beside the roster in SpellList.cpp.

// Does this form just hit? A row written at SPELL_PRECISE says it does.
bool spellPrecise(const SpellForm& form);

// The form's EFFECTIVE accuracy for this caster: 100 when precise, otherwise
// the caster's own stat plus the row's signed modifier, clamped to 0..100. The
// elevation adjustment an arrow gets is NOT here — that is per shot and belongs
// to delivery, which knows the two hexes.
int spellAccuracy(const AUnit& caster, const SpellForm& form);

// A-4: score = worth * AI_SCORE_SCALE / spellDivider(form). The auto divider
// grows with the authored fatigue, the pool cost and the casting time, so a
// cheap fast spell competes on ratio with a big slow one, and M-13's "spend
// cheap" falls out of the arithmetic rather than needing a per-form control.
int spellDivider(const SpellForm& form);

// One thing a caster could do this tick: a form, the target the resolver would
// hand it, and what the scorer makes of that. The lottery (A-2) draws over
// these; the script (A-6) takes the max.
struct CastOption {
    const Spell*     spell = nullptr;
    const SpellForm* form  = nullptr;
    Target           target;
    int              score = 0;
};

struct Spell {
    std::string_view id;   // "fireball" | "bless" | "raise_dead" | ...
    // forms[0] is the minor form, forms[1] the major one where a spell has it.
    // M-18 authors one minor per path so no hire roll is a dud, plus major
    // forms for the three spells that already existed.
    std::vector<SpellForm> forms;
};
