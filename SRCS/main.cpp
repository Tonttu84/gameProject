/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   main.cpp                                           :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@student.hive.fi>        +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/16 08:31:32 by jrimpila          #+#    #+#             */
/*   Updated: 2025/08/29 11:34:43 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#include "../HDRS/Battlefield.hpp"
#include "../HDRS/Human.hpp"
#include "../HDRS/Priest.hpp"
#include "../HDRS/Mage.hpp"

#include <sys/ioctl.h>
#include <unistd.h>

int getTerminalHeight() {
    struct winsize w;
    ioctl(STDOUT_FILENO, TIOCGWINSZ, &w);
    return w.ws_row;
}


// Composite Pattern

int main(void)
{
    int termHeight = getTerminalHeight();
    int battlefieldHeight = Battlefield::height;

    int battlefieldStartRow = termHeight - battlefieldHeight;

    
    Battlefield &myBattle = Utility::getBattlefield();
    
    myBattle.createTeam<Mage>(2, REDTEAM);
    myBattle.createTeam<Priest>(2, REDTEAM);
    myBattle.placeTeam(myBattle.getTeamRED(), myBattle.width * 5/6, myBattle.width -1, 0, myBattle.height - 1);
    
    myBattle.createTeam<Human>(100, REDTEAM);
    myBattle.createTeam<Human>(200, BLUETEAM); 
    myBattle.placeTeam(myBattle.getTeamRED(), myBattle.width * 2/3, myBattle.width -1, 0, myBattle.height - 1);
    myBattle.placeTeam(myBattle.getTeamBLUE(), 0, myBattle.width /3, 0, myBattle.height -1);
    std::cout << "\033[" << battlefieldStartRow << ";1H"; // Move cursor
    myBattle.print();
    
    while(myBattle.countTeam(REDTEAM) && myBattle.countTeam(BLUETEAM))
    {
        std::cout << CLEAR_TERMINAL;
        myBattle.triggerSpecialPhase();
        myBattle.moveUnits();
        myBattle.makeBattle();
        myBattle.cleanup();
        myBattle.print();
        usleep(200000);
        
    }
    return 0;
}
