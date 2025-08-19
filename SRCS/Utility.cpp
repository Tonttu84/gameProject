/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Utility.cpp                                        :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@student.hive.fi>        +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/17 13:00:08 by jrimpila          #+#    #+#             */
/*   Updated: 2025/08/17 13:10:00 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#include "../HDRS/Utility.hpp"

int Utility::throwDice()
{
    static std::mt19937 gen(std::random_device{}()); // seeded once
    static std::uniform_int_distribution<int> dist(1, 6); // dice range

    int result = dist(gen);

    if (dist(gen) == 6)
        return result += throwDice();
    
    return result;
}