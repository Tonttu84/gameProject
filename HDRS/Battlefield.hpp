/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Battlefield.hpp                                    :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@student.hive.fi>        +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/16 11:09:16 by jrimpila          #+#    #+#             */
/*   Updated: 2025/08/19 14:44:07 by jrimpila         ###   ########.fr       */
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
        static int constexpr height = 50;
        static int constexpr  width = 150;
        size_t countTeam(const int team) const;
        void moveUnits(void);
        void makeBattle(void);
        void debugPrint(void);
        void createTeam(size_t amount, int team);
        void placeTeam(std::vector<std::unique_ptr<AUnit>>& team, size_t wStart, size_t wEnd, size_t hStart, size_t hEend);
        void placeTeamRED(std::vector<std::unique_ptr<AUnit>>& team);
        void placeTeamBLUE(std::vector<std::unique_ptr<AUnit>>& team);
        std::vector<std::unique_ptr<AUnit>> &getTeamRED();
        std::vector<std::unique_ptr<AUnit>> &getTeamBLUE() { return teamBLUE; }
        Cell *findTarget(const AUnit &Searcher) const;
        void moveTeam(std::vector<std::unique_ptr<AUnit>> &team);
        void flee(std::unique_ptr<AUnit> &unit);

        int moveAUnit(AUnit &unit, int w, int h);

        void moveOne(std::unique_ptr<AUnit> &, const Cell* const cellptr);

        std::array<std::array<Cell, width>, height> _battlefield;
        void cleanup();


        int moveSE(AUnit &unit, Cell &myCell);
        int moveSW(AUnit &unit, Cell &myCell);
        int moveE(AUnit &unit, Cell &myCell);
        int moveW(AUnit &unit, Cell &myCell);
        int moveNE(AUnit &unit, Cell &myCell);
        int moveNW(AUnit &unit, Cell &myCell);
        int moveN(AUnit &unit, Cell &myCell);
        int moveS(AUnit &unit, Cell &myCell);

    private:
         
         std::vector<std::unique_ptr<AUnit>> teamRED;
         std::vector<std::unique_ptr<AUnit>> teamBLUE;

    
};