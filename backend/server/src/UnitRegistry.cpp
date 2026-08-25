#include "server/UnitRegistry.hpp"
#include "AUnit.hpp"
#include "UnitCatalog.hpp"
#include "Squad.hpp"

#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wshadow"
#pragma GCC diagnostic ignored "-Wformat"
#pragma GCC diagnostic ignored "-Wformat-nonliteral"
#pragma GCC diagnostic ignored "-Wformat-security"
#include "extern/json.hpp"
#pragma GCC diagnostic pop

#include <cstdio>
#include <map>
#include <memory>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

using json = nlohmann::json;

// ── Tiny JSON helpers ─────────────────────────────────────────────────────────

static std::string jsonStr(const char* s) {
    return std::string("\"") + s + "\"";
}

static std::string jsonTerrainEntry(int idx)
{
    const TerrainMeta& m = TERRAIN_META[idx];
    char buf[128];
    std::snprintf(buf, sizeof(buf),
        "{\"id\":%d,\"name\":%s,\"color\":\"#%02x%02x%02x\"}",
        idx,
        jsonStr(m.name).c_str(),
        m.r, m.g, m.b);
    return buf;
}

// ── Public API ────────────────────────────────────────────────────────────────

std::string buildInfoJson()
{
    // Unit types available for player placement — the catalog's Player-role
    // entries, with every value read off a live instance so this can never
    // drift from the unit constructors (see UnitCatalog.hpp).
    json unitsJson = json::array();
    for (const auto& entry : unitCatalog()) {
        if (!hasRole(entry.roles, UnitRole::Player)) continue;
        auto u = entry.make(BLUETEAM);
        json forbidden = json::array();
        for (TerrainType t : forbiddenTerrainForCategory(u->getCategory()))
            forbidden.push_back(terrainMeta(t).name);
        unitsJson.push_back({
            {"type",             entry.typeName},
            {"symbol",           std::string(1, u->getPrintSymbol())},
            {"placementSize",    static_cast<int>(u->getSize())},
            {"category",         categoryName(u->getCategory())},
            {"forbiddenTerrain", forbidden},
            // The campaign client needs per-unit speed (raid party costs).
            {"speed",            u->getMovementSpeed()},
        });
    }
    std::string units = unitsJson.dump();

    // Terrain metadata — indices match TerrainType enum values.
    std::string terrains =
        "[" +
        jsonTerrainEntry(static_cast<int>(TerrainType::Open))   + "," +
        jsonTerrainEntry(static_cast<int>(TerrainType::Forest)) + "," +
        jsonTerrainEntry(static_cast<int>(TerrainType::Marsh))  + "," +
        jsonTerrainEntry(static_cast<int>(TerrainType::Rubble)) +
        "]";

    char buf[2048];
    std::snprintf(buf, sizeof(buf),
        "{"
        "\"grid\":{\"width\":%d,\"height\":%d,\"hexCapacity\":%d},"
        "\"playerZone\":{\"rowMin\":0,\"rowMax\":%d},"
        "\"enemyZone\":{\"rowMin\":%d,\"rowMax\":%d},"
        "\"units\":%s,"
        "\"terrain\":%s"
        "}",
        Battlefield::width,
        Battlefield::height,
        Hex::CAPACITY,
        Battlefield::height / 4,
        Battlefield::height * 3 / 4,
        Battlefield::height - 1,
        units.c_str(),
        terrains.c_str());

    return buf;
}

// ── buildArmyFromPlacement ────────────────────────────────────────────────────

// Upper bound on total requested unit size, in the same hex-capacity size-points
// Hex::CAPACITY is measured in (NOT a unit/entry count — see SECURITY_NOTES.md #4). A
// single unit can be as large as an entire hex (640 size-points), so a flat count of
// "units" doesn't bound resource usage the way a size-points budget does. Scales with
// whatever map is loaded: the whole grid could never legitimately hold more than
// hexCount() * Hex::CAPACITY size-points total, so nothing beyond that is worth
// processing regardless of team/zone. Every entry with a valid type counts toward this
// total as soon as it's constructed, even if it's later rejected for that specific hex
// (capacity/terrain/zone) — otherwise a flood of entries all targeting one full hex would
// bypass the budget entirely.
static size_t placementSizeBudget(const HexGrid& grid)
{
    return static_cast<size_t>(grid.hexCount()) * static_cast<size_t>(Hex::CAPACITY);
}

// Secondary, generous hard cap on raw entry count — defense in depth against a flood of
// minimum-size (currently as small as 10, but DESIGN.md plans size-1 creatures) units,
// which the size-points budget alone would process a lot of before exhausting.
static constexpr size_t MAX_PLACEMENT_ENTRIES = 50000;

Army buildArmyFromPlacement(const std::string& placementJson, int team, HexGrid& grid)
{
    Army army;

    json j;
    try {
        j = json::parse(placementJson);
    } catch (const json::parse_error&) {
        return army; // malformed JSON — treat as no placements rather than throwing
    }
    if (!j.is_array()) return army;

    // Track capacity used per hex during this placement pass (sizeUsed on the
    // Hex struct is only updated by setHex/clearHex during the battle itself).
    std::unordered_map<HexCoord, int, HexCoordHash> usedPerHex;

    const size_t sizeBudget = placementSizeBudget(grid);
    size_t totalRequestedSize = 0;
    size_t processed = 0;

    for (const auto& entry : j) {
        if (processed++ >= MAX_PLACEMENT_ENTRIES) break;

        // SECURITY (see SECURITY_NOTES.md #3): entry is attacker-controlled — validate
        // shape/types before touching a field, rather than letting operator[]/.get<T>()
        // throw on a missing key or wrong type.
        if (!entry.is_object()) continue;
        auto typeIt = entry.find("unit_type");
        auto qIt    = entry.find("q");
        auto rIt    = entry.find("r");
        if (typeIt == entry.end() || !typeIt->is_string()) continue;
        if (qIt == entry.end() || !qIt->is_number_integer()) continue;
        if (rIt == entry.end() || !rIt->is_number_integer()) continue;

        auto u = makeUnitByName(typeIt->get<std::string>(), team);
        if (!u) continue;

        // REAL size for the request budget, deliberately: this is the DoS guard
        // (SECURITY_NOTES.md #4), and charging it the PACKING size would let a
        // forged formationFighter buy a bigger request. What a unit occupies on
        // a hex is a separate question, asked below once the mods are applied.
        int unitSize = static_cast<int>(u->getSize());
        if (totalRequestedSize + static_cast<size_t>(unitSize) > sizeBudget) break;
        totalRequestedSize += static_cast<size_t>(unitSize);

        HexCoord coord{qIt->get<int>(), rIt->get<int>()};
        Hex* h = grid.getHex(coord);

        // Reject missing or impassable hexes.
        if (!h || h->impassable) continue;

        // Reject hexes outside the placing team's deployment zone (only
        // checked when that zone exists). BLUETEAM deploys in the player
        // zone, REDTEAM (enemy_placement, campaign armies) in the enemy zone
        // — before this was team-aware, every enemy_placement entry was
        // silently dropped for being outside the PLAYER zone, leaving an
        // empty red army.
        if (team == BLUETEAM && grid.hasPlayerZone()) {
            int r = coord.r;
            if (r < grid.playerZoneMinRow() || r > grid.playerZoneMaxRow()) continue;
        }
        if (team == REDTEAM && grid.hasEnemyZone()) {
            int r = coord.r;
            if (r < grid.enemyZoneMinRow() || r > grid.enemyZoneMaxRow()) continue;
        }

        // Reject forbidden terrain for this unit category.
        bool forbidden = false;
        for (TerrainType t : forbiddenTerrainForCategory(u->getCategory()))
            if (h->terrain == t) { forbidden = true; break; }
        if (forbidden) continue;

        // Optional squad_mods (campaign squad upgrades, docs/CAMPAIGN_PLAN.md
        // "SLICE 4", 4b): an object of stat name → flat integer modifier,
        // e.g. {"attack": 1, "armour": 1}. Attached SERVER-SIDE by the campaign
        // layer from the squad's taken upgrades — the browser never sends its
        // own, and this parser is what makes a forged one harmless rather than
        // what stops it.
        //
        // Same never-throw discipline as every other field here: a non-object,
        // a non-integer value or a stat name the engine does not know is
        // skipped rather than rejected, and applyStatMod bounds what a legal
        // one can do (see AUnit::MAX_STAT_MOD).
        //
        // Applied BEFORE the capacity check below, because "formationFighter"
        // changes how much room the unit takes (4c) — charging the hex the
        // unadjusted size would mean a drilled squad never actually fits the
        // extra bodies it just paid a permanent slot for.
        auto modsIt = entry.find("squad_mods");
        if (modsIt != entry.end() && modsIt->is_object()) {
            for (const auto& mod : modsIt->items()) {
                if (!mod.value().is_number_integer()) continue;
                u->applyStatMod(mod.key(), mod.value().get<int>());
            }
        }

        // Optional squad_abilities (slice 6, decision 6-7): an array of ability
        // names, e.g. ["fearless"], attached SERVER-SIDE by the campaign layer
        // from the banner bound to this unit's squad.
        //
        // The engine learns the word `fearless` and never the word `banner` —
        // campaign → engine, never back, the line UnitRole drew. What arrives
        // here IS granted by definition, so it lands in the GRANTED set and
        // needs no marker to distinguish it from what the creature innately is;
        // AUnit::abilities() then scopes it to squad membership (6-6).
        //
        // Same never-throw discipline as squad_mods above: a non-array, a
        // non-string entry or a name the engine does not know is skipped rather
        // than rejected, so a forged one is harmless rather than fatal.
        auto abilitiesIt = entry.find("squad_abilities");
        if (abilitiesIt != entry.end() && abilitiesIt->is_array()) {
            UnitAbility granted = UnitAbility::None;
            for (const auto& name : *abilitiesIt) {
                if (!name.is_string()) continue;
                granted |= abilityFromName(name.get<std::string>());
            }
            u->setGrantedAbilities(granted);
        }

        // Optional carried_abilities: the same array of ability names, but for
        // what this body's own GEAR gives it rather than what its squad does.
        // A separate field because the engine scopes the two differently —
        // AUnit::abilities() holds a grant only while the unit is in a squad
        // (6-6) and a carried ability always. A loose character carries their
        // gear's gift onto a field where no banner covers them; folding it onto
        // squad_abilities dropped it in silence.
        //
        // The engine still learns only the word `fearless` and never the word
        // `helm`: what the field name tells it is the SCOPE, not the source.
        //
        // Same never-throw discipline as everything else at this boundary.
        auto carriedIt = entry.find("carried_abilities");
        if (carriedIt != entry.end() && carriedIt->is_array()) {
            UnitAbility carried = UnitAbility::None;
            for (const auto& name : *carriedIt) {
                if (!name.is_string()) continue;
                carried |= abilityFromName(name.get<std::string>());
            }
            u->setCarriedAbilities(carried);
        }

        // Optional denied_abilities (slice 9a, decision 9-4): an array of
        // ability names this body's GEAR takes away, attached SERVER-SIDE by
        // the campaign layer from the items a character carries.
        //
        // The counterpart to squad_abilities, and parsed identically — but it
        // lands in the SUPPRESSED set, which AUnit::abilities() subtracts
        // BEFORE running the implication closure. That order is what makes a
        // fully general item system safe: a row denying an implied flag is
        // legal to author and simply does nothing, because the closure puts it
        // back. Nothing here needs to know which flags are implied, and nothing
        // breaks when the implication table grows.
        //
        // Same never-throw discipline as everything else at this boundary: a
        // non-array, a non-string entry or an unknown name is skipped.
        auto deniedIt = entry.find("denied_abilities");
        if (deniedIt != entry.end() && deniedIt->is_array()) {
            UnitAbility denied = UnitAbility::None;
            for (const auto& name : *deniedIt) {
                if (!name.is_string()) continue;
                denied |= abilityFromName(name.get<std::string>());
            }
            u->setSuppressedAbilities(denied);
        }

        // Reject if placement would exceed hex capacity — in PACKING size, the
        // room the body takes, which is what a hex measures.
        int packedSize = static_cast<int>(u->getPackingSize());
        int& used = usedPerHex[coord];
        if (used + packedSize > Hex::CAPACITY) continue;
        used += packedSize;

        // Optional hold_turns: integer >= 0. Non-integer or negative → 0.
        auto holdIt = entry.find("hold_turns");
        if (holdIt != entry.end() && holdIt->is_number_integer()) {
            int ht = holdIt->get<int>();
            if (ht > 0) u->setHoldTurns(ht);
        }

        // Optional persistent squad tag (campaign squads): squad_id is an
        // int > 0; squad_name is the display name buildSquadsFromArmy uses
        // when it first sees this id. Absent/mistyped → unassigned (0), same
        // as every other field here — never throws on attacker input.
        auto squadIdIt = entry.find("squad_id");
        if (squadIdIt != entry.end() && squadIdIt->is_number_integer()) {
            int sid = squadIdIt->get<int>();
            if (sid > 0) {
                u->setSquadId(sid);
                auto squadNameIt = entry.find("squad_name");
                if (squadNameIt != entry.end() && squadNameIt->is_string())
                    u->setSquadName(squadNameIt->get<std::string>());
            }
        }

        // Optional persistent CHARACTER tag (campaign characters, SLICE 5):
        // character_id is an int > 0 naming ONE individual, so the campaign can
        // tell which Mage came home rather than only how many did. avoids_melee
        // is the hang-back toggle (decision 5-8) — a bool, deliberately not a
        // squad_mods entry, because it seats a unit rather than changing a stat.
        // Both follow the same never-throw rule: absent or mistyped is simply
        // the default, never a rejected request.
        auto characterIdIt = entry.find("character_id");
        if (characterIdIt != entry.end() && characterIdIt->is_number_integer()) {
            int cid = characterIdIt->get<int>();
            if (cid > 0) u->setCharacterId(cid);
        }
        auto avoidsIt = entry.find("avoids_melee");
        if (avoidsIt != entry.end() && avoidsIt->is_boolean())
            u->setAvoidsMelee(avoidsIt->get<bool>());

        u->setHex(h);
        u->setPlaced(true);
        army.push_back(std::move(u));
    }
    return army;
}

// ── buildSquadsFromArmy ───────────────────────────────────────────────────────

std::vector<std::unique_ptr<Squad>> buildSquadsFromArmy(const Army& army)
{
    // Group key: (hex, squadId) for explicitly tagged campaign squads
    // (squadId > 0 — set from a placement entry's squad_id, see
    // buildArmyFromPlacement above), or (hex, printSymbol) as before for
    // untagged stacks (squadId == 0) — the original same-hex-same-type ad
    // hoc grouping. Keying tagged units by squadId rather than symbol is
    // what lets one campaign squad mix unit types.
    struct GroupKey {
        const Hex* hex;
        int        squadId; // 0 for the untagged/symbol-keyed path
        char       symbol;  // only meaningful when squadId == 0
        bool operator<(const GroupKey& o) const {
            if (hex != o.hex) return hex < o.hex; // ordered map -> deterministic palette colors
            if (squadId != o.squadId) return squadId < o.squadId;
            return symbol < o.symbol;
        }
    };
    std::map<GroupKey, std::vector<AUnit*>> groups;
    for (const auto& u : army) {
        if (!u || !u->getHex()) continue;
        int sid = u->getSquadId();
        groups[{u->getHex(), sid, sid == 0 ? u->getPrintSymbol() : '\0'}].push_back(u.get());
    }

    std::vector<std::unique_ptr<Squad>> squads;
    for (auto& [key, members] : groups) {
        // Untagged same-type stacks: a lone unit isn't worth forming a squad
        // for. An explicitly tagged campaign squad (squadId > 0) is honored
        // even down to one survivor — the player organized it on purpose,
        // and the campaign layer needs a live Squad here to detect "wiped"
        // (aliveCount() == 0) once the battle ends.
        if (key.squadId == 0 && members.size() < 2) continue;

        std::string name;
        if (key.squadId != 0 && !members.front()->getSquadName().empty()) {
            name = members.front()->getSquadName();
        } else {
            std::string type = unitNameForSymbol(key.symbol);
            if (type.empty()) type = std::string(1, key.symbol);
            char buf[64];
            std::snprintf(buf, sizeof(buf), "%s (%d,%d)",
                          type.c_str(), key.hex->coord.q, key.hex->coord.r);
            name = buf;
        }

        auto sq = std::make_unique<Squad>(name);
        bool anyMounted = false, allMounted = true;
        for (AUnit* m : members) {
            bool mounted = m->getCategory() == UnitCategory::Mounted;
            anyMounted |= mounted;
            allMounted &= mounted;
        }
        if (allMounted)      sq->setType(SquadType::Cavalry);
        else if (anyMounted) sq->setType(SquadType::Mixed);
        for (AUnit* m : members)
            sq->addMember(m);

        // Squad-level hold order: campaign squads carry one order for the
        // whole formation (buildArmyFromPlacement already set it per-unit
        // from the placement entry's hold_turns; every member of one
        // squad_id shares that value in the normal flow, so first-seen is
        // authoritative — Squad::setHoldTurns does not propagate back to
        // members, so the redundant per-unit value is simply unused while
        // the unit stays in the squad).
        if (key.squadId != 0)
            sq->setHoldTurns(members.front()->getHoldTurns());

        squads.push_back(std::move(sq));
    }
    return squads;
}
