/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Battlefield.hpp                                    :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@student.hive.fi>        +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/16 11:09:16 by jrimpila          #+#    #+#             */
/*   Updated: 2025/08/18 17:15:45 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#pragma once
#include <array>
#include <unistd.h>
#include <iostream>
#include "Cell.hpp"
#include "AUnit.hpp"
#include <vector>
#include <climits>

class Cell;

class Battlefield
{
    public:
        Battlefield();
        ~Battlefield() = default;
        Battlefield(Battlefield &cpy) = delete;
        Battlefield &operator=(Battlefield &target) = delete;
        void insertTeam(size_t amount, int team);
        void print(void);
        static int constexpr height = 70;
        static int constexpr  width = 140;
        size_t countTeam(const int team) const;
        void moveUnits(void);
        void makeBattle(void);
        void debugPrint(void);
        void createTeam(size_t amount, int team);
        void placeTeam(std::vector<std::unique_ptr<AUnit>>& team);
        std::vector<std::unique_ptr<AUnit>> &getTeamRED();
        std::vector<std::unique_ptr<AUnit>> &getTeamBLUE() { return teamBLUE; }
        Cell *findTarget(const AUnit &Searcher) const;
        void moveTeam(std::vector<std::unique_ptr<AUnit>> &team);
        void flee(std::unique_ptr<AUnit> &unit);

        int enter(AUnit & unit, int w, int h);

        void moveOne(std::unique_ptr<AUnit> &, const Cell* const cellptr);

        std::array<std::array<Cell, width>, height> _battlefield;
        void cleanup();

    private:
         
         std::vector<std::unique_ptr<AUnit>> teamRED;
         std::vector<std::unique_ptr<AUnit>> teamBLUE;

    
};