#include "scenarios/SampleBattle.hpp"
#include "scenarios/SpreadTest.hpp"
#include "server/UnitRegistry.hpp"
#include "server/BattleServer.hpp"
#include "Battlefield.hpp"
#include "Utility.hpp"

#include <SFML/Graphics.hpp>
#include <fstream>
#include <iostream>
#include <string>

constexpr unsigned int WINDOW_WIDTH  = 1000;
constexpr unsigned int WINDOW_HEIGHT = 1000;
constexpr int          SERVER_PORT   = 8080;

int main(int argc, char* argv[])
{
    std::string mode = (argc > 1) ? argv[1] : "";

    // ── Headless modes (no SFML window) ──────────────────────────────────────
    if (mode == "info") {
        std::cout << buildInfoJson() << "\n";
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

    // ── SFML modes ────────────────────────────────────────────────────────────
    Utility::load();
    Battlefield& field = Utility::getBattlefield();

    sf::RenderWindow window(sf::VideoMode(WINDOW_WIDTH, WINDOW_HEIGHT), "Battlefield");
    BattleRenderer renderer(Utility::font, window);
    renderer.build(field.hexGrid);
    renderer.initView(window.getSize());

    if (mode == "battle")
        runBattleFromJson(field, renderer);
    else if (mode == "sample")
        runSampleBattle(field, renderer);
    else if (mode == "spread")
        runSpreadTest(field, renderer);

    sf::Event event;
    while (window.isOpen() && window.pollEvent(event))
        if (event.type == sf::Event::Closed)
            window.close();

    return 0;
}
