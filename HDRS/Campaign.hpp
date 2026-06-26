#pragma once
#include "Battlefield.hpp"
#include <SFML/Graphics.hpp>

// Full campaign: buy screen + three escalating battles.
void runCampaign(Battlefield& field, sf::RenderWindow& window);

// Dev shortcut: run the sample battle directly, no buy screen.
// Launch with:  ./game sample
void runSampleBattle(Battlefield& field, sf::RenderWindow& window);
