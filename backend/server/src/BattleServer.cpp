#include "server/BattleServer.hpp"
#include "server/UnitRegistry.hpp"
#include "scenarios/SampleBattle.hpp"
#include "BattleSetup.hpp"
#include "hex/HexGrid.hpp"
#include "units/Soldier.hpp"
#include "units/Archer.hpp"
#include "units/Mage.hpp"
#include "units/Priest.hpp"
#include "units/Cavalry.hpp"
#include "units/Necromancer.hpp"

#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wshadow"
#pragma GCC diagnostic ignored "-Wformat"
#pragma GCC diagnostic ignored "-Wformat-nonliteral"
#pragma GCC diagnostic ignored "-Wformat-security"
#include "extern/json.hpp"
#pragma GCC diagnostic pop

#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wshadow"
#pragma GCC diagnostic ignored "-Wnull-dereference"
#pragma GCC diagnostic ignored "-Wformat"
#pragma GCC diagnostic ignored "-Wformat-nonliteral"
#pragma GCC diagnostic ignored "-Wformat-security"
#include "extern/httplib.h"
#pragma GCC diagnostic pop

#include <iostream>
#include <sstream>
#include <fstream>
#include <cstdio>
#include <cstdlib>
#include <unistd.h>

using json = nlohmann::json;

// ── Helpers ───────────────────────────────────────────────────────────────────

static PlacementZone zoneFromRows(int minRow, int maxRow, int cols)
{
    // Bounding columns across all rows: visual col = 0..cols-1 in all rows.
    return {0, cols - 1, minRow, maxRow};
}

static std::string survivorJson(const Army& army)
{
    std::unordered_map<std::string, int> counts;
    for (const auto& u : army) {
        if (!u) continue;
        switch (u->getPrintSymbol()) {
            case 'X': counts["Soldier"]++;     break;
            case 'A': counts["Archer"]++;      break;
            case 'M': counts["Mage"]++;        break;
            case 'P': counts["Priest"]++;      break;
            case 'C': counts["Cavalry"]++;     break;
            case 'N': counts["Necromancer"]++; break;
            case 'S': counts["Skeleton"]++;    break;
            case 'Z': counts["Zombie"]++;      break;
            default: break;
        }
    }
    std::string out = "{";
    bool first = true;
    for (const auto& [k, v] : counts) {
        if (!first) out += ",";
        out += "\"" + k + "\":" + std::to_string(v);
        first = false;
    }
    return out + "}";
}

static std::string resultToJson(const BattleResult& r)
{
    const char* winner = (r.winner == BLUETEAM) ? "blue"
                       : (r.winner == REDTEAM)  ? "red"
                       :                          "draw";
    std::string out = std::string("{\"winner\":\"") + winner + "\","
                    + "\"blue_survivors\":" + survivorJson(r.blueSurvivors) + ","
                    + "\"red_survivors\":"  + survivorJson(r.redSurvivors)  + "}";
    return out;
}

// ── Battle-from-JSON ──────────────────────────────────────────────────────────

// SECURITY (see SECURITY_NOTES.md #1): `name` is attacker-controlled (GET /api/map?name=,
// POST /api/battle's "map" field) and is concatenated directly into a filesystem path with
// no sanitization here. Every caller MUST reject path separators/".." in `name` first.
static std::string readMapFile(const std::string& name)
{
    std::ifstream f("maps/" + name + ".json");
    if (!f) return {};
    return std::string((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
}

static Army buildDefaultPlayerArmy()
{
    Army blue;
    appendArmy<Soldier>(blue, 300, BLUETEAM);
    appendArmy<Archer> (blue,  50, BLUETEAM);
    appendArmy<Mage>   (blue,   3, BLUETEAM);
    appendArmy<Priest> (blue,   3, BLUETEAM);
    appendArmy<Cavalry>(blue,  10, BLUETEAM);
    return blue;
}

static Army buildDefaultEnemyArmy()
{
    Army red;
    appendArmy<Soldier>     (red, 540, REDTEAM);
    appendArmy<Archer>      (red, 150, REDTEAM);
    appendArmy<Necromancer> (red,  11, REDTEAM);
    return red;
}

// Entry point for `./game battle`, the subprocess POST /api/battle spawns per request.
// BOUNDARY: `input` (stdin) is the raw, fully untrusted HTTP request body. Every field read
// from `j` below must be treated as attacker-controlled — see SECURITY_NOTES.md #1, #3, #4.
void runBattleFromJson(Battlefield& field, BattleRenderer& renderer)
{
    std::istreambuf_iterator<char> begin(std::cin), end;
    std::string input(begin, end);

    if (input.empty()) {
        std::cerr << "battle: no JSON on stdin\n";
        std::cout << "{\"error\":\"no input\"}\n";
        return;
    }

    json j;
    try {
        j = json::parse(input);
    } catch (const std::exception& e) {
        std::cerr << "battle: JSON parse error: " << e.what() << "\n";
        std::cout << "{\"error\":\"parse error\"}\n";
        return;
    }

    // Load map terrain from maps/<name>.json into the grid.
    std::string mapName = j.value("map", "sample_battle");
    std::string mapContent = readMapFile(mapName);
    if (mapContent.empty()) {
        std::cerr << "battle: map not found: " << mapName << "\n";
        std::cout << "{\"error\":\"map not found\"}\n";
        return;
    }

    field.reset();
    field.hexGrid.fromJson(mapContent);

    // Build player army from explicit placement, or default if absent.
    Army player;
    if (j.contains("player_placement") && !j["player_placement"].empty()) {
        player = buildArmyFromPlacement(j["player_placement"].dump(), BLUETEAM, field.hexGrid);
    } else {
        player = buildDefaultPlayerArmy();
        PlacementZone pz = field.hexGrid.hasPlayerZone()
            ? zoneFromRows(field.hexGrid.playerZoneMinRow(),
                           field.hexGrid.playerZoneMaxRow(), field.width)
            : PlacementZone{0, field.width - 1, 0, field.height / 4};
        randomPlaceArmy(player, field, pz);
    }

    // Build enemy army from explicit placement, or default if absent.
    Army enemy;
    if (j.contains("enemy_placement") && !j["enemy_placement"].empty()) {
        enemy = buildArmyFromPlacement(j["enemy_placement"].dump(), REDTEAM, field.hexGrid);
    } else {
        enemy = buildDefaultEnemyArmy();
        PlacementZone ez = field.hexGrid.hasEnemyZone()
            ? zoneFromRows(field.hexGrid.enemyZoneMinRow(),
                           field.hexGrid.enemyZoneMaxRow(), field.width)
            : PlacementZone{0, field.width - 1, field.height * 3 / 4, field.height - 1};
        randomPlaceArmy(enemy, field, ez);
    }

    field.loadArmies(std::move(enemy), std::move(player));

    BattleResult result = runBattleLoop(field, renderer, "BATTLE");
    std::cout << resultToJson(result) << "\n";
}

// ── HTTP server ───────────────────────────────────────────────────────────────

void runServer(int port, const std::string& binaryPath)
{
    httplib::Server svr;

    svr.set_default_headers({{"Access-Control-Allow-Origin", "*"}});

    svr.Options(".*", [](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.set_header("Access-Control-Allow-Headers", "Content-Type");
        res.status = 204;
    });

    svr.Get("/api/info", [](const httplib::Request&, httplib::Response& res) {
        res.set_content(buildInfoJson(), "application/json");
    });

    // BOUNDARY: `name` is attacker-controlled — see readMapFile()'s comment and
    // SECURITY_NOTES.md #1 (path traversal).
    svr.Get("/api/map", [](const httplib::Request& req, httplib::Response& res) {
        std::string name = req.has_param("name") ? req.get_param_value("name") : "sample_battle";
        std::string path = "maps/" + name + ".json";
        std::ifstream f(path);
        if (!f) {
            res.status = 404;
            res.set_content("{\"error\":\"map not found\"}", "application/json");
            return;
        }
        std::string body((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
        res.set_content(body, "application/json");
    });

    // BOUNDARY: req.body is the fully untrusted request payload, piped as-is into the
    // ./game battle subprocess's stdin — see runBattleFromJson() for what happens to it.
    svr.Post("/api/battle", [&binaryPath](const httplib::Request& req, httplib::Response& res) {
        // Write input to a temp file, run ./game battle, read result.
        // NOTE: inFile/outFile are named only by server PID, not per-request — concurrent
        // requests (httplib may dispatch on multiple threads) can race on the same files.
        std::string inFile  = "/tmp/battle_in_"  + std::to_string(getpid()) + ".json";
        std::string outFile = "/tmp/battle_out_" + std::to_string(getpid()) + ".json";

        {
            std::ofstream f(inFile);
            f << req.body;
        }

        std::string cmd = binaryPath + " battle < " + inFile + " > " + outFile + " 2>/dev/null";
        int rc = std::system(cmd.c_str());
        (void)rc;

        std::ifstream f(outFile);
        if (!f) {
            res.status = 500;
            res.set_content("{\"error\":\"battle process failed\"}", "application/json");
        } else {
            std::string result((std::istreambuf_iterator<char>(f)),
                               std::istreambuf_iterator<char>());
            res.set_content(result, "application/json");
        }

        std::remove(inFile.c_str());
        std::remove(outFile.c_str());
    });

    std::cout << "Campaign server running on http://localhost:" << port << "\n";
    std::cout << "  GET  /api/info        — unit and grid metadata\n";
    std::cout << "  GET  /api/map[?name=] — map JSON (default: sample_battle)\n";
    std::cout << "  POST /api/battle      — run a battle from JSON\n";
    svr.listen("0.0.0.0", port);
}
