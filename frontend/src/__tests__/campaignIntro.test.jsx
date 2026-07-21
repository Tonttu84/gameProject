import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CampaignIntro from '../components/CampaignIntro'

// The one-time scene-setter shown on turn 1 (App gates it on day === 1 &&
// !introSeen). Rendered directly here — a light contract test on the copy the
// player must see and the "Take command" hand-off into the campaign.
describe('CampaignIntro', () => {
  it('sets the scene at Karrowgate with the relief-army situation', () => {
    render(<CampaignIntro onBegin={() => {}} />)
    const intro = screen.getByTestId('campaign-intro')
    expect(intro).toHaveTextContent('The Relief of Karrowgate')
    // The load-bearing fiction: the bridge/river stakes, the Warden's edict,
    // and why you shadow rather than fight.
    expect(intro).toHaveTextContent('river Marn')
    expect(intro).toHaveTextContent('Warden of the Marches')
    expect(intro).toHaveTextContent(/breach will come/)
  })

  it('hands off to the campaign when the player takes command', () => {
    const onBegin = vi.fn()
    render(<CampaignIntro onBegin={onBegin} />)
    fireEvent.click(screen.getByTestId('take-command'))
    expect(onBegin).toHaveBeenCalledTimes(1)
  })
})
