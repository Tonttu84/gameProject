/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Cell.hpp                                           :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@student.hive.fi>        +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/16 11:16:55 by jrimpila          #+#    #+#             */
/*   Updated: 2025/08/27 19:08:07 by jrimpila         ###   ########.fr       */
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


    private:
        int terrain = empty;
        int elevation = 0;
        AUnit *ptr = nullptr; // Non-owning, auto-nullifying
};



// if (auto unit = ptr.lock()) {
//     // Safe to use unit
// } else {
//     // Unit was destroyed; ptr is expired
// }

// Step 1: Make AUnit managed by std::shared_ptr
// cpp
// std::shared_ptr<AUnit> unit = std::make_shared