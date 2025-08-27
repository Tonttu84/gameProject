/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   main.cpp                                           :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@student.hive.fi>        +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/16 08:31:32 by jrimpila          #+#    #+#             */
/*   Updated: 2025/08/27 19:20:07 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#include "../HDRS/Battlefield.hpp"
#include "../HDRS/Human.hpp"
#include "../HDRS/Priest.hpp"

#define RED 1
#define BLUE 2

int main(void)
{
    Battlefield &myBattle = Utility::getBattlefield();
    
    myBattle.createTeam<Priest>(2, RED);
    myBattle.placeTeam(myBattle.getTeamRED(), myBattle.width * 5/6, myBattle.width -1, 0, myBattle.height - 1);
    
    myBattle.createTeam<Human>(100, RED); //red
    myBattle.createTeam<Human>(120, BLUE); // blue
    myBattle.placeTeam(myBattle.getTeamRED(), myBattle.width * 2/3, myBattle.width -1, 0, myBattle.height - 1);
    myBattle.placeTeam(myBattle.getTeamBLUE(), 0, myBattle.width /3, 0, myBattle.height -1);
    myBattle.print();
    
    while(myBattle.countTeam(RED) && myBattle.countTeam(BLUE))
    {
        myBattle.triggerSpecialPhase();
        myBattle.moveUnits();
        myBattle.makeBattle();
        myBattle.cleanup();
        myBattle.print();
        usleep(200000);
        
    }
    return 0;
}
