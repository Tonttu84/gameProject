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
export async function marchToRaids() {
  fireEvent.click(await screen.findByTestId('to-omens'))
  fireEvent.click(await screen.findByTestId('augury-continue'))
}

// …and on from the Raids screen, through Recruit (the default fixture's
// recruit.hiredToday is already true, so the deploy exit is there
// immediately — no hire/skip needed), to the Deploy/placement grid.
export async function marchToDeployment() {
  await marchToRaids()
  fireEvent.click(await screen.findByTestId('to-recruit'))
  fireEvent.click(await screen.findByTestId('to-deploy'))
}
