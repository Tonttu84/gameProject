/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Human.cpp                                          :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@student.hive.fi>        +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/16 08:59:43 by jrimpila          #+#    #+#             */
/*   Updated: 2025/08/28 17:42:35 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#include "../HDRS/Human.hpp"
#include "../HDRS/AUnit.hpp"
#include "../HDRS/Utility.hpp"


Human::Human(int setTeam): AUnit::AUnit(setTeam)
{
    this->printSymbol = 'X';
}



