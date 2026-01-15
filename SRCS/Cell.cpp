/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Cell.cpp                                           :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@hive.fi>                +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/16 11:43:10 by jrimpila          #+#    #+#             */
/*   Updated: 2025/10/04 17:23:48 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#include "../HDRS/Cell.hpp"
#include "../HDRS/AUnit.hpp"
#include "../HDRS/Utility.hpp"
#include <cmath>


void Cell::setUnit(AUnit *unit)
{
   
    if (unit && unit->getCell() != this) {
        unit->setCell(this);
    }
     ptr = unit;
    
}


void Cell::reset()
{
    ptr = nullptr;
}

AUnit* Cell::getUnit() const
{
    return ptr;
}

void Cell::render(sf::RenderWindow& window) {
    sf::Text text;
    text.setFont(Utility::font);
    text.setCharacterSize(24);
    text.setString(ptr ? std::string(1, ptr->getPrintSymbol()) : ".");

    // Position
    float x = static_cast<float>(wLoc * cellSize);
    float y = static_cast<float>(hLoc * cellSize);
    text.setPosition(x, y);

    // Background rectangle if fire is active
    if (fire) {
        sf::RectangleShape background(sf::Vector2f(static_cast<float>(cellSize), static_cast<float>(cellSize)));
        background.setPosition(x, y);
        background.setFillColor(sf::Color(255, 165, 0)); // Orange
        window.draw(background);
        fire = false; // Reset like in terminal version
    }

    // Text color logic
    if (ptr) {
        int team = ptr->getTeam();
        bool casting = ptr->getCast() != 0;

        if (team == 1) {
            if (casting)
                text.setFillColor(sf::Color(255, 255, 0)); // Yellow
            else
                text.setFillColor(sf::Color::Red);
        } else if (team == 2) {
            if (casting)
                text.setFillColor(sf::Color(255, 255, 0)); // Yellow
            else
                text.setFillColor(sf::Color::Blue);
        } else {
            text.setFillColor(sf::Color::White); // Unknown team
        }
    } else {
        text.setFillColor(sf::Color::White); // Empty cell
    }

    window.draw(text);
}




int Cell::getRange(const Cell &target) //simplified range calculator that gets the highest of x and y difference 
{

    int hDelta = std::abs(target.hLoc - hLoc);
    int wDelta = std::abs(target.wLoc - wLoc);

    if (hDelta > wDelta)
        return hDelta;
    return wDelta;
    
}