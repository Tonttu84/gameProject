/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   main.cpp                                           :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@hive.fi>                +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/16 08:31:32 by jrimpila          #+#    #+#             */
/*   Updated: 2025/09/20 11:30:49 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#include "../HDRS/Battlefield.hpp"
#include "../HDRS/Human.hpp"
#include "../HDRS/Priest.hpp"
#include "../HDRS/Mage.hpp"
#include "../HDRS/Necromancer.hpp"
#include "../HDRS/Archer.hpp"
#include "../HDRS/Soldier.hpp"

#include <sys/ioctl.h>
#include <unistd.h>

#include <sys/ioctl.h>
#include <unistd.h>
#include <iostream>
#include <thread>
#include <chrono>

int getTerminalHeight() {
    struct winsize w;
    ioctl(STDOUT_FILENO, TIOCGWINSZ, &w);
    return w.ws_row;
}

void clearBattlefieldArea(int startRow, int height) {
    for (int i = 0; i < height; ++i) {
        std::cout << "\033[" << (startRow + i) << ";1H\033[2K"; // Move to line and clear it
    }
}


int main(void)
{
    int termHeight = getTerminalHeight();
    int battlefieldHeight = Battlefield::height;
    int battlefieldStartRow = termHeight - battlefieldHeight;

    Battlefield &myBattle = Utility::getBattlefield();

    myBattle.createTeam<Mage>(3, REDTEAM);
    myBattle.createTeam<Priest>(2, REDTEAM);
    myBattle.createTeam<Archer>(50, REDTEAM);
    myBattle.placeTeam(myBattle.getTeam(REDTEAM), myBattle.width * 5/6, myBattle.width -1, 0, myBattle.height - 1);


    myBattle.createTeam<Archer>(30, BLUETEAM);

    myBattle.createTeam<Necromancer>(3, BLUETEAM);
     myBattle.placeTeam(myBattle.getTeam(BLUETEAM), 0, myBattle.width / 6, 0, myBattle.height - 1);


    myBattle.createTeam<Soldier>(175, REDTEAM);
    myBattle.createTeam<Soldier>(250, BLUETEAM); 
    myBattle.placeTeam(myBattle.getTeam(REDTEAM), myBattle.width * 2/3, myBattle.width -1, 0, myBattle.height - 1);
    myBattle.placeTeam(myBattle.getTeam(BLUETEAM), 0, myBattle.width /3, 0, myBattle.height -1);


    int counter = 0;

    while (myBattle.countTeam(REDTEAM) && myBattle.countTeam(BLUETEAM))
    {
        clearBattlefieldArea(battlefieldStartRow, battlefieldHeight);
        std::cout << "\033[" << battlefieldStartRow << ";1H"; // Move cursor to battlefield start

        myBattle.triggerSpecialPhase();
        myBattle.moveUnits();
        myBattle.makeBattle();
        myBattle.cleanup();
        counter++;
        std::cout << "Turn number: " << counter << "\n";
        myBattle.print();

        std::this_thread::sleep_for(std::chrono::milliseconds(200));
    }

    std::cout << "Battle ended. ";

    if (myBattle.countTeam(REDTEAM))
        std::cout << "Red team won" << std::endl;
    else
        std::cout << "Blue team won" << std::endl;

    return 0;
}

