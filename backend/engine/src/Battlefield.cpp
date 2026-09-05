// ─── Battlefield: the owner and coordinator ──────────────────────────────────
// One of three translation units that make up Battlefield. The other two are
// the tick phases that had grown large enough to want their own files:
//   - BattlefieldMovement.cpp    — moveUnits() and everything under it
//   - BattlefieldEngagements.cpp — resolveEngagements() and its seating passes
// Split out 2026-08-25 (docs/CAMPAIGN_PLAN.md, restructuring candidate 1),
// before DESIGN.md's frontage/formation work lands in the engagement phase.
// Nothing moved between the phases and no behaviour changed; the boundaries
// follow tick()'s own phase order, so the file a change belongs in is the
// phase it happens in.
//
// Owns: the battle's lifecycle and the state both phases read — construction
// and reset, loadArmies/extractResult (the engine's entry and exit points),
// tick() and its turn hooks, the special/casting phase, melee resolution and
// cleanup, target search, the corpse count, and the per-side magic state.
#include "Battlefield.hpp"
#include "RangedCombat.hpp"
#include "SpellList.hpp"
#include "UnitCatalog.hpp"
#include <algorithm>
#include <climits>


Battlefield::Battlefield()
{
    hexGrid.buildRect(width, height);
}

void Battlefield::printText(int turn) const
{
    if (turn >= 0) std::cout << "--- turn " << turn << " ---\n";
    for (int r = 0; r < height; ++r) {
        if (r % 2 == 1) std::cout << "  ";
        for (int q = 0; q < width; ++q) {
            const Hex* h = hexGrid.getHex({q, r});
            int aliveR = 0, aliveB = 0;
            if (h) {
                for (const AUnit* u : h->units)
                    if (u && u->getAlive())
                        (u->getTeam() == REDTEAM ? aliveR : aliveB)++;
            }
            int total = aliveR + aliveB;
            if (total == 0) {
                std::cout << ".. ";
            } else {
                char t = (aliveR > 0) ? 'R' : 'B';
                if (total < 10) std::cout << t << ' ' << total << ' ';
                else            std::cout << t << total << ' ';
            }
        }
        std::cout << '\n';
    }
    std::cout << '\n';
}

size_t Battlefield::countTeam(const int team) const
{
    size_t count = 0;
    const auto& t = (team == REDTEAM) ? _red.units : _blue.units;
    for (const auto& u : t)
        if (u && u->getAlive()) ++count;
    return count;
}

Hex* Battlefield::findTarget(const AUnit& searcher) const
{
    if (!searcher.getHex()) return nullptr;
    HexCoord myCoord = searcher.getHex()->coord;

    const auto& enemyTeam = (searcher.getTeam() == REDTEAM) ? _blue.units : _red.units;
    bool mounted = (searcher.getCategory() == UnitCategory::Mounted);
    int bestDist = std::numeric_limits<int>::max();
    const AUnit* bestEnemy = nullptr;
    Hex* bestHex = nullptr;

    for (const auto& enemy : enemyTeam) {
        if (!enemy || !enemy->getAlive() || !enemy->getHex()) continue;
        int d = HexGrid::distance(myCoord, enemy->getHex()->coord);
        // Cavalry prefers open-ground targets over forest-sheltered ones —
        // still goes there if it's the only option, just not the first choice.
        if (mounted && enemy->getHex()->terrain == TerrainType::Forest)
            d += CAVALRY_FOREST_TARGET_PENALTY;
        if (d < bestDist || (d == bestDist && enemy->sortsBefore(bestEnemy))) {
            bestDist  = d;
            bestEnemy = enemy.get();
            bestHex   = enemy->getHex();
        }
    }
    return bestHex;
}


void Battlefield::makeBattle()
{
    auto red  = _red.units.begin();
    auto blue = _blue.units.begin();

    while (red != _red.units.end() || blue != _blue.units.end()) {
        if (red != _red.units.end()
            && ((Utility::getRandom(1, 2) == 1) || blue == _blue.units.end())) {
            (*red)->battle(*this);
            ++red;
        } else if (blue != _blue.units.end()) {
            (*blue)->battle(*this);
            ++blue;
        }
    }
}

// Narrate deaths into the tick log before the dead are pruned, so a replay
// can show what was lost this tick. Uses the catalog symbol→name mapping;
// symbols outside the catalog (e.g. loose-horse 'H') fall back to the symbol.
void Battlefield::logDeaths(const Team& team)
{
    for (const auto& u : team.units) {
        if (!u || u->getAlive()) continue;
        std::string name = unitNameForSymbol(u->getPrintSymbol());
        if (name.empty()) name = std::string(1, u->getPrintSymbol());
        logEvent(name + (team.id == REDTEAM ? " (red)" : " (blue)") + " fell");
    }
}

void Battlefield::cleanup()
{
    logDeaths(_red);
    logDeaths(_blue);

    // Both teams' non-undead dead feed the one shared corpse pool that
    // raise_dead spends — a corpse is a corpse regardless of its banner.
    corpses += _blue.pruneDeadUnits();
    corpses += _red.pruneDeadUnits();
}

std::vector<std::unique_ptr<AUnit>>& Battlefield::getTeam(int team)
{
    if (team == BLUETEAM) return _blue.units;
    if (team == REDTEAM)  return _red.units;
    throw std::runtime_error("getTeam: invalid team");
}

Team& Battlefield::getTeamData(int team)
{
    if (team == REDTEAM)  return _red;
    if (team == BLUETEAM) return _blue;
    throw std::runtime_error("getTeamData: invalid team");
}

void Battlefield::reset()
{
    // Survivors had restoreForNextBattle() called (which unlinks them from hexes).
    // Dead units' destructors already cleaned their hexes during cleanup().
    // This call handles any residual pointers and resets state.
    hexGrid.clearUnits();
    _red.units.clear();
    _blue.units.clear();
    corpses = 0;
    _tickLog.clear();
    _reinforcements.clear();
    // Both, and both per battle: the standing instances point at units that are
    // being destroyed right now, and "once per side per battle" is spent when
    // the battle is.
    _enchantments.clear();
    _enchantmentsCast.clear();
    _ticksRun = 0;
    _maxTicks = DEFAULT_MAX_BATTLE_TICKS;
}

void Battlefield::loadArmies(Army red, Army blue)
{
    _red.units  = std::move(red);
    _blue.units = std::move(blue);
    // New battle, fresh day: zero every per-battle accumulator so the result
    // reflects THIS battle only. Production always reset()s first, but the
    // engine tests reuse the Utility::getBattlefield() singleton across cases
    // without one, so loadArmies must not inherit the prior battle's corpse
    // count / tick log (that leak surfaced as corpses==1 on empty armies).
    _ticksRun = 0;
    corpses   = 0;
    _tickLog.clear();
    _reinforcements.clear(); // per-battle; scheduled AFTER loadArmies by callers
    // Per-battle for the same reason the corpse count is, and load-bearing for
    // memory safety on top: an instance carried over from the previous battle
    // would hold a pointer to a caster this call has just replaced.
    _enchantments.clear();
    _enchantmentsCast.clear();
    // Red flees south (r = height-1); Blue flees north (r = 0).
    hexGrid.computeDistances(height - 1, 0);
}

void Battlefield::recomputeDistances()
{
    hexGrid.computeDistances(height - 1, 0);
}


void Battlefield::onTurnStart()
{
    for (auto& u : _red.units)  if (u && u->getAlive()) u->recover();
    for (auto& u : _blue.units) if (u && u->getAlive()) u->recover();

    // T-5: standing spell effects count down HERE — after the passive recovery
    // (which is about fatigue and has nothing to say to them) and BEFORE the
    // standing enchantments press. An expiring Stoneskin should be gone by the
    // time this turn's spells act, not still counted for one more tick because
    // the expiry happened to be swept later in the tick than the thing that
    // read it.
    for (auto& u : _red.units)  if (u && u->getAlive()) u->tickEffects();
    for (auto& u : _blue.units) if (u && u->getAlive()) u->tickEffects();

    // AFTER the passive recovery, never before it: a sustained spell's whole
    // effect is what it adds to or takes off a body that has already rested,
    // and running it first would let recover() wash the turn's relief away.
    applyEnchantments();

    for (auto& u : _red.units)  if (u) { u->resetAttacksReceived(); u->resetRepelMalus(); }
    for (auto& u : _blue.units) if (u) { u->resetAttacksReceived(); u->resetRepelMalus(); }

    RangedCombat::resetCache();

    debugAsserts();
}

void Battlefield::onTurnEnd()
{
    // E-4 checks liveness ONCE at end of tick — no per-tick polling.
    // ORDER IS LOAD-BEARING: cleanup() erases the dead unit objects, and the
    // sweep reads each instance's sustainer to decide whether it still stands.
    // Swap these two and the sweep dereferences a unit that has just been
    // destroyed.
    sweepEnchantments();
    cleanup();
}

// ── Battlefield-wide enchantments (E-2, E-4, E-5) ────────────────────────────

bool Battlefield::enchantmentCastAlready(int team, const Spell& s) const
{
    for (const auto& called : _enchantmentsCast)
        if (called.first == team && called.second == &s) return true;
    return false;
}

bool Battlefield::beginEnchantment(AUnit& caster, std::string_view spellId)
{
    const Spell* spell = Spells::findSpell(spellId);
    if (!spell || spell->forms.empty()) return false;
    // forms.front(): every battlefield spell is single-form today. The
    // once-per-side register keys on the SPELL rather than the form, so the
    // form is carried only for its label and its standing effect — a second
    // form would change what the instance DOES, never how many a side may call.
    const SpellForm* form = &spell->forms.front();
    const int        team = caster.getTeam();

    if (enchantmentCastAlready(team, *spell)) {
        // Two casters on one side, both scripted for the same spell: the second
        // one fizzles unpaid (E-2, assistant's call, flagged there). Detail
        // tier — nothing happened on the field, and the
        // player who wrote both scripts is the only reader who wants the line.
        // Returning false costs the caster nothing (M-23).
        logEvent(LogTier::Detail, std::string(form->label)
            + " fizzles — it has already been called over this field");
        return false;
    }
    // Re-checked here and not only at selection: the pool is army-wide, so
    // another caster on this side may have drained it in the ticks this one
    // spent channelling.
    if (getChannels(team) < form->poolCost) return false;

    _enchantments.push_back({spell, form, &caster, team});
    _enchantmentsCast.push_back({team, spell});
    return true;
}

void Battlefield::applyEnchantments()
{
    // E-5: an Everyone-aim form applies ONCE per tick per spell however many
    // instances stand — the effect is symmetric, so pressing twice because both
    // sides called it would turn a decision into a race to call it second.
    std::vector<const Spell*> seen;
    for (const ActiveEnchantment& e : _enchantments) {
        if (!e.form || !e.form->tickEffect) continue;
        if (e.form->enchantAim == EnchantAim::Friendly) {
            e.form->tickEffect(*this, e.team);
            continue;
        }
        if (std::find(seen.begin(), seen.end(), e.spell) != seen.end()) continue;
        seen.push_back(e.spell);
        e.form->tickEffect(*this, 0);   // team is meaningless to a symmetric effect
    }
}

void Battlefield::sweepEnchantments()
{
    // Backwards, so an erase cannot move an instance past the cursor.
    for (size_t i = _enchantments.size(); i-- > 0; ) {
        const AUnit* caster = _enchantments[i].caster;
        if (caster && caster->getAlive()) continue;
        // Basic tier: the field visibly changes, and a player who watched a
        // spell go up is owed the moment it comes down.
        logEvent(std::string(_enchantments[i].form->label)
            + " fades — its sustainer is gone");
        _enchantments.erase(_enchantments.begin() + static_cast<std::ptrdiff_t>(i));
    }
}

void Battlefield::fireScheduledReinforcements()
{
    const int turn = _ticksRun + 1; // tick() has not yet incremented _ticksRun
    for (Reinforcement& r : _reinforcements)
        if (!r.fired && r.tick <= turn) {
            Spells::castGarrisonSally(*this, r);
            r.fired = true; // fires exactly once, even if its turn is overshot
        }
}

bool Battlefield::tick()
{
    // Turn header first, so the events of this tick follow it in the replay
    // log (and in the DB's per-tick log via ReplayRecorder).
    logEvent("Turn " + std::to_string(_ticksRun + 1));
    onTurnStart();
    // Reinforcements land BEFORE the acting phases, so a wave can move, cast
    // and fight on the very tick it arrives. Deliberate (asked and confirmed
    // 2026-08-09): a tick is an abstraction, not a stopwatch, and "it arrived
    // during the turn" is answer enough. Holding a wave for a tick would buy a
    // marginal bit of fiction for a real chunk of machinery — an arrival flag
    // to set, honour and clear across four phases. Don't add it.
    fireScheduledReinforcements();
    triggerSpecialPhase();
    moveUnits();
    resolveEngagements();
    makeBattle();
    onTurnEnd();
    ++_ticksRun;
    if (_ticksRun >= _maxTicks) {
        logEvent("The day is over — the battle ends as it stands");
        return false;
    }
    return countTeam(REDTEAM) > 0 && countTeam(BLUETEAM) > 0;
}

BattleResult Battlefield::extractResult()
{
    BattleResult result;
    result.corpses = corpses;
    // Both sides still standing = draw (battle ended on the turn limit or an
    // aborted run, not by annihilation); otherwise the surviving side wins.
    size_t redLeft  = countTeam(REDTEAM);
    size_t blueLeft = countTeam(BLUETEAM);
    result.winner = (redLeft > 0 && blueLeft > 0) ? 0 :
                    (redLeft > 0)  ? REDTEAM :
                    (blueLeft > 0) ? BLUETEAM : 0;

    for (auto& unit : _red.units)
        if (unit && unit->getAlive() && !unit->getBattleSummon())
            result.redSurvivors.push_back(std::move(unit));

    for (auto& unit : _blue.units)
        if (unit && unit->getAlive() && !unit->getBattleSummon())
            result.blueSurvivors.push_back(std::move(unit));

    _red.units.clear();
    _blue.units.clear();
    return result;
}

void Battlefield::triggerSpecialPhase()
{
    // Spells first, then the remaining virtual special() hook (only Archer
    // until Stage R1 moves ranged attacks onto weapons). Casters have no
    // special() override and archers no spells, so no unit acts twice —
    // when a unit can eventually do both, priority is decided here.
    //
    // Act on a snapshot of the phase-start roster: summons (raise_dead)
    // push_back into the very vector being walked, which invalidates live
    // iterators — and units raised this phase must not act this phase.
    // Raw pointers stay valid; nothing is destroyed until cleanup().
    auto actPhaseStart = [](std::vector<std::unique_ptr<AUnit>>& units) {
        std::vector<AUnit*> roster;
        roster.reserve(units.size());
        for (auto& unit : units)
            if (unit) roster.push_back(unit.get());
        for (AUnit* unit : roster)
            if (unit->getFatigue() < FATIGUE_MAX && unit->getAlive()) {
                unit->castSpells();
                unit->special();
            }
    };
    actPhaseStart(_red.units);
    actPhaseStart(_blue.units);
}

size_t Battlefield::getCorpses()      { return corpses; }
void   Battlefield::setCorpses(size_t c) { corpses = c; }

// ── Per-side magic state ─────────────────────────────────────────────────────
// Team ids are REDTEAM/BLUETEAM (1/2); anything else is out of range and reads
// as "no magic" rather than throwing, matching the never-throw discipline the
// JSON boundary uses.
static bool magicSideIndex(int team, size_t& out)
{
    if (team != REDTEAM && team != BLUETEAM) return false;
    out = static_cast<size_t>(team - 1);
    return true;
}

int Battlefield::getSchoolLevel(int team, SpellSchool school) const
{
    // SpellSchool::None is what a pure-Holy spell carries (M-14): it has no
    // school gate at all, so it is never blocked by one.
    if (school == SpellSchool::None) return SPELL_SCHOOL_OPEN_DEFAULT;
    size_t side = 0;
    if (!magicSideIndex(team, side) || school == SpellSchool::Count) return 0;
    return _schoolLevels[side][static_cast<size_t>(school)];
}

void Battlefield::setSchoolLevel(int team, SpellSchool school, int level)
{
    size_t side = 0;
    if (!magicSideIndex(team, side)) return;
    if (school == SpellSchool::Count || school == SpellSchool::None) return;
    if (level < 0) level = 0;
    if (level > SPELL_SCHOOL_OPEN_DEFAULT) level = SPELL_SCHOOL_OPEN_DEFAULT;
    _schoolLevels[side][static_cast<size_t>(school)] = level;
}

int Battlefield::getChannels(int team) const
{
    size_t side = 0;
    if (!magicSideIndex(team, side)) return 0;
    return _channels[side];
}

void Battlefield::setChannels(int team, int channels)
{
    size_t side = 0;
    if (!magicSideIndex(team, side)) return;
    _channels[side] = channels < 0 ? 0 : channels;
}

int Battlefield::drawChannels(int team, int wanted)
{
    size_t side = 0;
    if (wanted <= 0 || !magicSideIndex(team, side)) return 0;
    int given = std::min(wanted, _channels[side]);
    _channels[side] -= given;
    return given;
}
