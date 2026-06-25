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
#include "../HDRS/HexGrid.hpp"
#include "../HDRS/Human.hpp"
#include "../HDRS/Priest.hpp"
#include "../HDRS/Mage.hpp"
#include "../HDRS/Necromancer.hpp"
#include "../HDRS/Archer.hpp"
#include "../HDRS/Soldier.hpp"

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

    HexGrid hexGrid(Utility::font, {350.f, 320.f});
    hexGrid.buildGrid(5);

    int termHeight = getTerminalHeight();
    int battlefieldStartRow = termHeight - Battlefield::height;

    Battlefield& field = Utility::getBattlefield();
    sf::RenderWindow myWindow(sf::VideoMode(Battlefield::width * Cell::cellSize, Battlefield::height * Cell::cellSize), "Battlefield");
    field.window = &myWindow;
    field.hexGrid = &hexGrid;

    // Build red army
    Army red;
    appendArmy<Mage>(red, 4, REDTEAM);
    appendArmy<Priest>(red, 2, REDTEAM);
    appendArmy<Archer>(red, 50, REDTEAM);
    randomPlaceArmy(red, field, {field.width * 5/6, field.width - 1, 0, field.height - 1});
    appendArmy<Soldier>(red, 185, REDTEAM);
    randomPlaceArmy(red, field, {field.width * 2/3, field.width - 1, 0, field.height - 1});

    // Build blue army
    Army blue;
    appendArmy<Archer>(blue, 30, BLUETEAM);
    appendArmy<Necromancer>(blue, 3, BLUETEAM);
    randomPlaceArmy(blue, field, {0, field.width / 6, 0, field.height - 1});
    appendArmy<Soldier>(blue, 250, BLUETEAM);
    randomPlaceArmy(blue, field, {0, field.width / 3, 0, field.height - 1});

    field.loadArmies(std::move(red), std::move(blue));

    int counter = 0;
    bool ongoing = true;
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
