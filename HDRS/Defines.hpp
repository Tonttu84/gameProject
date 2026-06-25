/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Defines.hpp                                        :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@hive.fi>                +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/09/19 13:54:25 by jrimpila          #+#    #+#             */
/*   Updated: 2025/10/04 17:30:36 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#pragma once

constexpr int FATIGUERECOVERY = 4; 

constexpr int SHIELDREDUCTION = 5;

constexpr int BATTLEFIELD_WIDTH = 50;   // hex columns (q)
constexpr int BATTLEFIELD_HEIGHT = 25;  // hex rows (r)

class Battlefield;
class HexGrid;
class AUnit;