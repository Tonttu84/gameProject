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
  it("shows the walls' band word while recon reveals no estimate (Blind)", () => {
    hudWith({ meter: { band: 'damaged', estimate: null } })
    const gauge = screen.getByTestId('hud-meter')
    expect(gauge).toHaveTextContent("Karrowgate's walls")
    expect(gauge).toHaveTextContent('damaged')
  })

  it('shows an integrity range once recon reveals a partial estimate', () => {
    // meter estimate [600,1100] → integrity 1−value/1000 → ~0–40% sound.
    hudWith({ meter: { band: 'damaged', estimate: { low: 600, high: 1100 } } })
    expect(screen.getByTestId('hud-meter')).toHaveTextContent('~0–40% sound')
  })

  it('shows a single exact integrity at the top recon level', () => {
    // exact meter 812 → 1−0.812 → ~19% sound.
    hudWith({ meter: { band: 'breached', estimate: { low: 812, high: 812 } } })
    expect(screen.getByTestId('hud-meter')).toHaveTextContent('~19% sound')
  })

  it('once the walls are breached, the gauge calls for battle', () => {
    hudWith({ bossFightDue: true, meter: { band: 'breached', estimate: { low: 812, high: 812 } } })
    expect(screen.getByTestId('hud-meter')).toHaveTextContent('BREACHED — give battle!')
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
