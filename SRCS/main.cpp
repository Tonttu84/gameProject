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
#include "../HDRS/SampleBattle.hpp"

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


constexpr unsigned int WINDOW_WIDTH    = 2400; // SFML window width in pixels
constexpr unsigned int WINDOW_HEIGHT   = 1000; // SFML window height in pixels
constexpr int          PAUSED_SLEEP_MS = 50;   // poll interval while paused (keeps window responsive)
constexpr int          TICK_SLEEP_MS   = 200;  // delay between simulation ticks — lower = faster battle

int main(void)
{
    Utility::load();

    int termHeight = getTerminalHeight();
    int battlefieldStartRow = termHeight - Battlefield::height;

    Battlefield& field = Utility::getBattlefield();
    field.hexGrid.setFont(&Utility::font);

    sf::RenderWindow myWindow(sf::VideoMode(WINDOW_WIDTH, WINDOW_HEIGHT), "Battlefield");
    field.window = &myWindow;

    setupSampleBattle(field);

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
            std::this_thread::sleep_for(std::chrono::milliseconds(PAUSED_SLEEP_MS));
            continue;
        }

        clearBattlefieldArea(battlefieldStartRow, Battlefield::height);
        std::cout << "\033[" << battlefieldStartRow << ";1H";

        ongoing = field.tick();
        counter++;
        std::cout << "Turn number: " << counter << "\n";
        field.print();

        std::this_thread::sleep_for(std::chrono::milliseconds(TICK_SLEEP_MS));
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
