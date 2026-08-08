import { screen, fireEvent } from '@testing-library/react'

// The turn now runs as separate, ordered screens — Prepare (War Council:
// forage + camp) → Omens (the augur) → Raids → Recruit → Deploy — instead of
// one bundled council (docs/CAMPAIGN_PLAN.md, 2026-07-18: events before
// raiders; Recruit phase design). So reaching the placement grid from the
// council is four clicks, not the old single "Muster for Battle". This helper
// walks that path for a fixture whose augury is already accepted
// (consultedAugury.accepted === true), which is how every placement-flow test
// seeds the campaign — the tent then shows "On to the Raids" straight away.
// Council (Prepare) → Raids screen: read the omens (already accepted) and go
// on to the raiders.
// Each step is a SERVER call now (the phase field is the authority), so every
// click is followed by waiting for the screen it leads to — a synchronous
// query straight after a click would race the request.
export async function marchToRaids() {
  fireEvent.click(await screen.findByTestId('to-omens'))
  fireEvent.click(await screen.findByTestId('augury-continue'))
  await screen.findByText('Targets of Opportunity')
}

// …and on from the Raids screen to Recruit (the default fixture's
// recruit.hiredToday is already true, so the screen's exit is there
// immediately — no hire needed).
export async function marchToRecruit() {
  await marchToRaids()
  fireEvent.click(await screen.findByTestId('to-recruit'))
  await screen.findByTestId('to-deploy')
}

// …and out of Recruit to the Deploy/placement grid. REQUIRES a bossFightDue
// fixture: that exit is the deployment screen only on the pitched-battle day
// (2026-08-08) — on a quiet turn the same button ends the turn instead, so a
// quiet-day fixture lands on the turn report, not the grid.
// Marching out is a SERVER phase step now (flows.breakCamp awaits it), so the
// grid appears a tick after the click — wait for it rather than querying hexes
// straight away.
export async function marchToDeployment() {
  await marchToRecruit()
  fireEvent.click(await screen.findByTestId('to-deploy'))
  await screen.findByTestId('pitched-battle-deploy')
}
