/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   main.cpp                                           :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@hive.fi>                +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/16 08:31:32 by jrimpila          #+#    #+#             */
/*   Updated: 2025/10/04 17:45:28 by jrimpila         ###   +#+               */
/*                                                                            */
/* ************************************************************************** */

#include "../HDRS/Battlefield.hpp"
#include "../HDRS/Campaign.hpp"

#include <SFML/Graphics.hpp>

constexpr unsigned int WINDOW_WIDTH  = 2400; // SFML window width in pixels
constexpr unsigned int WINDOW_HEIGHT = 1000; // SFML window height in pixels

int main(int argc, char* argv[])
{
    Utility::load();

    Battlefield& field = Utility::getBattlefield();
    field.hexGrid.setFont(&Utility::font);

    sf::RenderWindow window(sf::VideoMode(WINDOW_WIDTH, WINDOW_HEIGHT), "Battlefield");
    field.window = &window;
    field.hexGrid.initView(window.getSize());

    bool sample = (argc > 1 && std::string(argv[1]) == "sample");
    if (sample)
        runSampleBattle(field, window);
    else
        runCampaign(field, window);

    // Keep window open after campaign ends so the user can see the final state.
    sf::Event event;
    while (window.isOpen() && window.pollEvent(event))
        if (event.type == sf::Event::Closed)
            window.close();

    return 0;
}
