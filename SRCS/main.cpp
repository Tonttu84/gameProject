/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   main.cpp                                           :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@hive.fi>                +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/16 08:31:32 by jrimpila          #+#    #+#             */
/*   Updated: 2025/10/04 17:45:28 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#include "../HDRS/Battlefield.hpp"
#include "../HDRS/BattleSetup.hpp"
#include "../HDRS/Soldier.hpp"
// #include "../HDRS/Archer.hpp"
// #include "../HDRS/Priest.hpp"
// #include "../HDRS/Mage.hpp"
// #include "../HDRS/Necromancer.hpp"

#include <sys/ioctl.h>
#include <unistd.h>
#include <iostream>
#include <thread>
#include <chrono>
#include <SFML/Graphics.hpp>


int getTerminalHeight() {
    struct winsize w;
    ioctl(STDOUT_FILENO, TIOCGWINSZ, &w);
    return w.ws_row;
}

void clearBattlefieldArea(int startRow, int height) {
    for (int i = 0; i < height; ++i)
        std::cout << "\033[" << (startRow + i) << ";1H\033[2K";
}


int main(void)
{
    Utility::load();

    int termHeight = getTerminalHeight();
    int battlefieldStartRow = termHeight - Battlefield::height;

    Battlefield& field = Utility::getBattlefield();
    field.hexGrid.setFont(&Utility::font);

    sf::RenderWindow myWindow(sf::VideoMode(2400, 1000), "Battlefield");
    field.window = &myWindow;

    // Red army — dense right flank so hexes stack and frontage limits kick in
    Army red;
    appendArmy<Soldier>(red, 800, REDTEAM);
    randomPlaceArmy(red, field, {field.width * 3/4, field.width - 1, 0, field.height - 1});

    // Blue army — dense left flank
    Army blue;
    appendArmy<Soldier>(blue, 800, BLUETEAM);
    randomPlaceArmy(blue, field, {0, field.width / 4, 0, field.height - 1});

    field.loadArmies(std::move(red), std::move(blue));

    int counter = 0;
    bool ongoing = true;
    bool paused  = false;
    while (ongoing)
    {
        sf::Event event;
        while (field.window->pollEvent(event))
        {
            if (event.type == sf::Event::Closed)
            {
                field.window->close();
                return 0;
            }
            if (event.type == sf::Event::KeyPressed
                && event.key.code == sf::Keyboard::Space)
            {
                paused = !paused;
                std::cout << (paused ? "  [PAUSED]\n" : "  [RESUMED]\n");
            }
        }

        if (paused)
        {
            field.print(); // keep window responsive while paused
            std::this_thread::sleep_for(std::chrono::milliseconds(50));
            continue;
        }

        clearBattlefieldArea(battlefieldStartRow, Battlefield::height);
        std::cout << "\033[" << battlefieldStartRow << ";1H";

        ongoing = field.tick();
        counter++;
        std::cout << "Turn number: " << counter << "\n";
        field.print();

        std::this_thread::sleep_for(std::chrono::milliseconds(200));
    }

    BattleResult result = field.extractResult();

    std::cout << "Battle ended after " << counter << " turns. ";
    if (result.winner == REDTEAM)
        std::cout << "Red team won\n";
    else if (result.winner == BLUETEAM)
        std::cout << "Blue team won\n";
    else
        std::cout << "Draw\n";

    std::cout << "Red survivors: " << result.redSurvivors.size()
              << "  Blue survivors: " << result.blueSurvivors.size()
              << "  Corpses: " << result.corpses << "\n";

    sf::Event event;
    while (field.window->pollEvent(event))
    {
        if (event.type == sf::Event::Closed)
        {
            field.window->close();
            return 0;
        }
    }

    return 0;
}
