/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   main.cpp                                           :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@student.hive.fi>        +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/16 08:31:32 by jrimpila          #+#    #+#             */
/*   Updated: 2025/08/18 16:33:32 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#include "../HDRS/Battlefield.hpp"

int main(void)
{
    Battlefield myBattle;
    
    myBattle.createTeam(100, 1); //red
    myBattle.createTeam(100, 2); // bllue
    myBattle.placeTeam(myBattle.getTeamRED());
    myBattle.placeTeam(myBattle.getTeamBLUE());
    myBattle.print();
    
    while(myBattle.countTeam(1) && myBattle.countTeam(2))
    {
        myBattle.moveUnits();
        myBattle.makeBattle();
        myBattle.cleanup();
        myBattle.print();
        usleep(200000);
        
    }
    return 0;
}
