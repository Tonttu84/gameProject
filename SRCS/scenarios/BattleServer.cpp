#include "scenarios/BattleServer.hpp"
#include "scenarios/UnitRegistry.hpp"
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

static TerrainType terrainFromString(const std::string& s)
{
    if (s == "Forest") return TerrainType::Forest;
    if (s == "Marsh")  return TerrainType::Marsh;
    if (s == "Rubble") return TerrainType::Rubble;
    return TerrainType::Open;
}

static HexDirection sideFromInt(int i)
{
    return static_cast<HexDirection>(i % 6);
}

// Visual col/row → axial hex (same mapping as BattleSetup / SampleBattle).
static Hex* getVisualHex(HexGrid& grid, int col, int row)
{
    return grid.getHex({col - row / 2, row});
}

static std::unique_ptr<AUnit> makeUnit(const std::string& type, int team)
{
    if (type == "Soldier")    return std::make_unique<Soldier>(team);
    if (type == "Archer")     return std::make_unique<Archer>(team);
    if (type == "Mage")       return std::make_unique<Mage>(team);
    if (type == "Priest")     return std::make_unique<Priest>(team);
    if (type == "Cavalry")    return std::make_unique<Cavalry>(team);
    if (type == "Necromancer")return std::make_unique<Necromancer>(team);
    return nullptr;
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

static void applyTerrainFromJson(Battlefield& field, const json& j)
{
    if (!j.contains("terrain")) return;
    for (const auto& entry : j["terrain"]) {
        int col = entry["col"].get<int>();
        int row = entry["row"].get<int>();
        std::string type = entry["type"].get<std::string>();
        Hex* h = getVisualHex(field.hexGrid, col, row);
        if (h) h->terrain = terrainFromString(type);
    }

    if (j.contains("hexsides")) {
        for (const auto& entry : j["hexsides"]) {
            int col  = entry["col"].get<int>();
            int row  = entry["row"].get<int>();
            int side = entry["side"].get<int>();
            Hex* h = getVisualHex(field.hexGrid, col, row);
            if (!h) continue;
            HexSide* hs = field.hexGrid.getSide(h->coord, sideFromInt(side));
            if (!hs) continue;
            if (entry.contains("blocked"))   hs->blocked   = entry["blocked"].get<bool>();
            if (entry.contains("fortified")) {
                hs->fortified = entry["fortified"].get<bool>();
                if (hs->fortified) hs->fortifiedDefender = h;
            }
        }
    }

    if (j.contains("impassable")) {
        for (const auto& entry : j["impassable"]) {
            int col = entry["col"].get<int>();
            int row = entry["row"].get<int>();
            Hex* h = getVisualHex(field.hexGrid, col, row);
            if (h) h->impassable = true;
        }
    }
}

static Army buildEnemyFromPreset(const std::string& /*preset*/)
{
    Army red;
    appendArmy<Soldier>     (red, 540, REDTEAM);
    appendArmy<Archer>      (red, 150, REDTEAM);
    appendArmy<Necromancer> (red,  11, REDTEAM);
    return red;
}

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

    field.reset();
    applyTerrainFromJson(field, j);

    Army player;
    if (j.contains("player")) {
        for (const auto& entry : j["player"]) {
            auto u = makeUnit(entry["type"].get<std::string>(), BLUETEAM);
            if (!u) continue;
            int col = entry["col"].get<int>();
            int row = entry["row"].get<int>();
            Hex* h = getVisualHex(field.hexGrid, col, row);
            if (h) {
                u->setHex(h);
                u->setPlaced(true);
            }
            player.push_back(std::move(u));
        }
    }

    std::string preset = j.value("enemy_preset", "default");
    Army enemy = buildEnemyFromPreset(preset);
    randomPlaceArmy(enemy, field, {0, field.width - 1, field.height * 3/4, field.height - 1});

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

    svr.Post("/api/battle", [&binaryPath](const httplib::Request& req, httplib::Response& res) {
        // Write input to a temp file, run ./game battle, read result.
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
    std::cout << "  GET  /api/info   — unit and grid metadata\n";
    std::cout << "  POST /api/battle — run a battle from JSON\n";
    svr.listen("0.0.0.0", port);
}
