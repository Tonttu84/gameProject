#include "campaign/SampleBattle.hpp"
#include "campaign/SpreadTest.hpp"
#include "campaign/UnitRegistry.hpp"
#include "campaign/BattleServer.hpp"

#include <SFML/Graphics.hpp>
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
