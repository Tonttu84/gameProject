/**
 * Boss-fight meter (docs/CAMPAIGN_PLAN.md "Boss-fight campaign loop", Stage A;
 * recon R2/R3): the HUD gets a plain always-visible readout of the meter's band
 * (or the recon numeric estimate once recon reveals it), the recon band (level),
 * and the raid scout-points pool — user ask, so manual playtesting/debugging
 * each stage doesn't require digging into a panel.
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

describe('CampaignHUD boss-fight meter + recon readout', () => {
  it('shows the banded phrase while recon reveals no estimate (Blind)', () => {
    hudWith({ meter: { band: 'restless', estimate: null } })
    expect(screen.getByTestId('hud-meter')).toHaveTextContent('Pitched battle: restless')
  })

  it('shows a numeric range once recon reveals a partial estimate', () => {
    hudWith({ meter: { band: 'restless', estimate: { low: 600, high: 1100 } } })
    expect(screen.getByTestId('hud-meter')).toHaveTextContent('Pitched battle: 600–1100')
  })

  it('shows a single exact value at the top recon level', () => {
    hudWith({ meter: { band: 'imminent', estimate: { low: 812, high: 812 } } })
    expect(screen.getByTestId('hud-meter')).toHaveTextContent('Pitched battle: 812')
  })

  it('once the pitched battle is due, the estimate gives way to "now!"', () => {
    hudWith({ bossFightDue: true, meter: { band: 'imminent', estimate: { low: 812, high: 812 } } })
    expect(screen.getByTestId('hud-meter')).toHaveTextContent('Pitched battle: now!')
  })

  it('surfaces the recon band (level)', () => {
    hudWith({ scouting: { band: 'Superior' } })
    expect(screen.getByTestId('hud-recon')).toHaveTextContent('Recon: Superior')
  })

  it('mirrors the raid scout-points pool, floored', () => {
    hudWith({ raid: { ...campaignFixture.raid, scoutingPoints: 23.7 } })
    expect(screen.getByTestId('hud-scouting')).toHaveTextContent('Scout pts: 23')
  })
})
