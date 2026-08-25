#include "scenarios/SampleBattle.hpp"
#include "scenarios/SpreadTest.hpp"
#include "server/UnitRegistry.hpp"
#include "server/BattleServer.hpp"
#include "UnitCatalog.hpp"
#include "SpellList.hpp"
#include "Battlefield.hpp"
#include "Utility.hpp"

#include <fstream>
#include <iostream>
#include <string>

constexpr int SERVER_PORT = 8080;

int main(int argc, char* argv[])
{
    std::string mode = (argc > 1) ? argv[1] : "";

    // Every mode is headless — battles simulate and record; the browser
    // ReplayView is the only renderer (see docs/CAMPAIGN_PLAN.md).
    if (mode == "info") {
        std::cout << buildInfoJson() << "\n";
        return 0;
    }

    if (mode == "dump-units") {
        // Headless: full unit catalog (single source of truth for unit facts).
        // The campaign server imports this into the DB at startup.
        std::cout << unitCatalogJson() << "\n";
        return 0;
    }

    if (mode == "dump-spells") {
        // Headless: the full spell roster, one row per form (slice 3, S3-1).
        // The campaign server imports this at boot beside the unit catalog, so
        // The Study renders gates the engine actually enforces rather than a
        // second table kept in step by hand.
        std::cout << Spells::spellCatalogJson() << "\n";
        return 0;
    }

    if (mode == "server") {
        int port = (argc > 2) ? std::stoi(argv[2]) : SERVER_PORT;
        runServer(port, argv[0]);
        return 0;
    }

    if (mode == "dump-map") {
        // Headless: set up the sample battle terrain and write maps/sample_battle.json.
        Battlefield& field = Utility::getBattlefield();
        field.reset();
        setupSampleBattle(field);
        std::string out = field.hexGrid.toJson(
            Battlefield::width, Battlefield::height, "sample_battle");
        const char* path = (argc > 2) ? argv[2] : "maps/sample_battle.json";
        std::ofstream f(path);
        if (!f) {
            std::cerr << "dump-map: cannot open " << path << "\n";
            return 1;
        }
        f << out << "\n";
        std::cout << "Wrote " << path << "\n";
        return 0;
    }

    // ── Battle / scenario modes (headless) ──────────────────────────────────
    Battlefield& field = Utility::getBattlefield();

    if (mode == "battle")
        runBattleFromJson(field);
    else if (mode == "sample")
        // ./game sample — runs the scenario and prints {winner,...,replay} on
        // stdout, exactly like `./game battle`. The campaign server runs and
        // stores it through the one battle pipeline; the browser ReplayView plays
        // it (login-screen demo). See docs/CAMPAIGN_PLAN.md Phase 2.
        runSampleBattle(field);
    else if (mode == "spread")
        // ./game spread [outDir] — one replay JSON per terrain (default replays/).
        runSpreadTest(field, argc > 2 ? argv[2] : "replays");
    else {
        std::cerr << "unknown mode: '" << mode << "'\n";
        return 1;
    }

    return 0;
}
