import { test, expect } from '@playwright/test'
import { registerAndLogin, uniqueUsername, advanceReveal, clearPendingDecisions } from './helpers.js'

// First real end-to-end coverage: a browser driving one full campaign turn
// against a running stack — now through the PHASED turn (Prepare → Omens →
// Raids → Recruit): login → council/forage → read the omens → augur
// consult/recast → Accept the Fates (the mid-turn reveal, which now leads on to
// the raids) → raids → recruit (a mandatory hire) → End the Turn → next council.
//
// A quiet turn no longer offers a battle: the pitched battle is the campaign's
// END, not a per-turn option (2026-08-08), so Recruiting's exit ends the turn
// outright rather than opening a deployment grid. Everything here talks to the
// actual campaign server + engine; there are no mocks.
test('full campaign turn: forage → omens → accept fates → raids → recruit → end turn', async ({ page }) => {
  await page.goto('/')

  // ── Login (fresh throwaway commander) ──────────────────────────────────
  await registerAndLogin(page, uniqueUsername())

  // ── Start a campaign ───────────────────────────────────────────────────
  await page.getByTestId('start-campaign').click()
  // Turn 1 opens on the one-time "Relief of Karrowgate" intro (CampaignIntro);
  // "Take command" dismisses it into the War Council.
  await page.getByTestId('take-command').click()
  await expect(page.getByRole('heading', { name: /Turn 1 — War Council/ })).toBeVisible()

  // ── Prepare: assign some foragers and send them out ────────────────────
  const forageInput = page.locator('[data-testid^="forage-input-"]').first()
  await expect(forageInput).toBeVisible()
  await forageInput.fill('20')
  await page.getByTestId('forage-submit').click()
  await expect(page.getByTestId('forage-submit')).toContainText('Foragers assigned')

  // ── Read the Omens → the augur's tent ──────────────────────────────────
  await page.getByTestId('to-omens').click()
  await expect(page.getByTestId('omens-context')).toBeVisible()

  // Back-nav sanity for the one-way march (effort slider S1): stepping back to
  // the council shows it as a read-only RECORD — its advance is replaced by the
  // "already decided" banner, whose only way out is forward again to where the
  // turn actually stands. No committed action is lost either way.
  await page.getByTestId('back-to-prepare').click()
  await expect(page.getByRole('heading', { name: /Turn 1 — War Council/ })).toBeVisible()
  await expect(page.getByTestId('phase-committed')).toBeVisible()
  await page.getByTestId('back-to-current-phase').click()
  await expect(page.getByTestId('omens-context')).toBeVisible()

  // ── Consult, recast one fate, then Accept the Fates ────────────────────
  await page.getByTestId('consult-augur').click()
  const firstVision = page.getByTestId('augury-vision-0')
  await expect(firstVision).toBeVisible()
  if (await firstVision.isEnabled()) await firstVision.click()

  // Accept → the reveal plays right here, then leads on to the raids.
  await page.getByTestId('accept-fates').click()
  await expect(page.getByRole('heading', { name: /The Fates Come to Pass/ })).toBeVisible()
  // The stack runs with DEV_AUGURY forcing all three fates to CHOICE events
  // (see docker-compose.yml / CI e2e job), so this reveal deterministically
  // exercises the multi-choice path every run — the exact shape the old
  // ~1/8 flake lived on. Assert all three choices resolved, proving it ran.
  const choicesResolved = await advanceReveal(page) // lands on the Raids screen
  expect(choicesResolved).toBe(3)
  // No fate is deferred here (all forced fates are neutral/good), so nothing is
  // owed on the pendingChoices overlay — this is a harmless no-op safety net.
  await clearPendingDecisions(page)

  // ── Raids → Recruit → end the turn ──────────────────────────────────────
  await page.getByTestId('to-recruit').click()
  // Recruit is mandatory (S8): there is no skip. Hire the day's first option —
  // on turn 1 that is Militia or the always-free Travellers card, both
  // affordable — which is the only way the turn can end.
  await page.locator('[data-testid^="recruit-hire-"]').first().click()
  // Turn 1 is a quiet day: the pitched battle isn't due, so Recruiting's exit
  // ends the turn outright (breakCamp → end-day) rather than opening a
  // deployment grid that would read as an offer of battle. The exit stays
  // locked until the hire lands.
  const endTurn = page.getByTestId('to-deploy')
  await expect(endTurn).toBeEnabled()
  await expect(endTurn).toContainText('End the Turn')
  await endTurn.click()

  // ── End the turn without battle → the fortnight's report ───────────────
  await expect(page.getByRole('heading', { name: /The Fortnight Passes/ })).toBeVisible()
  await advanceReveal(page)
  await clearPendingDecisions(page)

  // ── The loop closed: a new council on the next turn ────────────────────
  await expect(page.getByRole('heading', { name: /Turn 2 — War Council/ })).toBeVisible()
})
