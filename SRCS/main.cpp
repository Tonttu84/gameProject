/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   main.cpp                                           :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@student.hive.fi>        +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/16 08:31:32 by jrimpila          #+#    #+#             */
/*   Updated: 2025/08/20 11:33:38 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#include "../HDRS/Battlefield.hpp"
#include "../HDRS/Human.hpp"
#include "../HDRS/Priest.hpp"

int main(void)
{
    Battlefield &myBattle = Utility::getBattlefield();
    
    myBattle.createTeam<Priest>(1, 1);
    myBattle.createTeam<Human>(100, 1); //red
    myBattle.createTeam<Human>(120, 2); // bllue
    myBattle.placeTeam(myBattle.getTeamRED(), myBattle.width * 2/3, myBattle.width -1, 0, myBattle.height - 1);
    myBattle.placeTeam(myBattle.getTeamBLUE(), 0, myBattle.width /3, 0, myBattle.height -1);
    myBattle.print();
    
    while(myBattle.countTeam(1) && myBattle.countTeam(2))
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
