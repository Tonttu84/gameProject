/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Cell.hpp                                           :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@hive.fi>                +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/16 11:16:55 by jrimpila          #+#    #+#             */
/*   Updated: 2025/10/04 17:24:30 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#pragma once
#include <memory>
#include <SFML/Graphics.hpp>

class AUnit;

int constexpr empty = 0;



class Cell{
  
    public:
        Cell() = default;
        ~Cell() = default;

        void setUnit(AUnit *target);
        AUnit* getUnit() const;
        void setUnitRaw(AUnit* unit);
        void reset();
        int  wLoc;
        int  hLoc;
        int getRange(const Cell &target);
        static constexpr int cellSize = 32;
        void render(sf::RenderWindow& window);

        bool fire = false;
    private:
        int terrain = empty;
        int elevation = 0;
        AUnit *ptr = nullptr; // Non-owning, auto-nullifying
        
};

