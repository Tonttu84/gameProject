/**
 * Boss-fight meter (docs/CAMPAIGN_PLAN.md "Boss-fight campaign loop", Stage A):
 * the HUD gets a plain always-visible readout of the meter's band (or exact
 * value once revealed) and the scouting-points pool — user ask, so manual
 * playtesting/debugging each stage doesn't require digging into a panel.
 */

import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import CampaignHUD from '../components/CampaignHUD'
import useCampaignStore from '../stores/useCampaignStore'
import { campaignFixture } from './fixtures/campaign'

const hudWith = (over) => {
  useCampaignStore.setState({ campaign: { ...campaignFixture, ...over } })
  return render(<CampaignHUD />)
}

describe('CampaignHUD boss-fight meter + scouting readout', () => {
  it('shows the banded phrase while the meter is hidden', () => {
    hudWith({ meter: { band: 'restless', revealed: false, value: null } })
    expect(screen.getByTestId('hud-meter')).toHaveTextContent('Meter: restless')
  })

  it('shows the exact value once revealed', () => {
    hudWith({ meter: { band: 'imminent', revealed: true, value: 812 } })
    expect(screen.getByTestId('hud-meter')).toHaveTextContent('Meter: 812')
  })

  it('mirrors the raid scouting-points pool, floored', () => {
    hudWith({ raid: { ...campaignFixture.raid, scoutingPoints: 23.7 } })
    expect(screen.getByTestId('hud-scouting')).toHaveTextContent('Scouting: 23')
  })
})
