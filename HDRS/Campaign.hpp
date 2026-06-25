#pragma once
#include "Battlefield.hpp"
#include <SFML/Graphics.hpp>

// Top-level campaign entry point: runs the buy screen and three escalating battles.
// Talks to the combat engine only through loadArmies / tick / extractResult.
void runCampaign(Battlefield& field, sf::RenderWindow& window);
