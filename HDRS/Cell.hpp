/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Cell.hpp                                           :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@student.hive.fi>        +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/16 11:16:55 by jrimpila          #+#    #+#             */
/*   Updated: 2025/08/31 12:00:05 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#pragma once
#include <memory>

int constexpr empty = 0;
class AUnit;


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

        bool fire = false;
    private:
        int terrain = empty;
        int elevation = 0;
        AUnit *ptr = nullptr; // Non-owning, auto-nullifying
        
};

