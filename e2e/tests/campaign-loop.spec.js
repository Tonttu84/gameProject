import { test, expect } from '@playwright/test'
import { registerAndLogin, uniqueUsername, advanceReveal, clearPendingDecisions } from './helpers.js'

// First real end-to-end coverage: a browser driving one full campaign turn
// against a running stack — now through the PHASED turn (Prepare → Omens →
// Raids → Deploy): login → council/forage → read the omens → augur
// consult/recast → Accept the Fates (the mid-turn reveal, which now leads on to
// the raids) → raids → deploy → placement → End Turn → next council. Everything
// here talks to the actual campaign server + engine; there are no mocks.
test('full campaign turn: forage → omens → accept fates → raids → deploy → end turn', async ({ page }) => {
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

  // Back-nav sanity: the tent can step back to the council and forward again
  // (phased-turn slices 2–3). No committed action is lost.
  await page.getByTestId('back-to-prepare').click()
  await expect(page.getByRole('heading', { name: /Turn 1 — War Council/ })).toBeVisible()
  await page.getByTestId('to-omens').click()
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

  // ── Raids → deploy ─────────────────────────────────────────────────────
  // Turn 1 is a quiet day: the pitched battle isn't due, so the deploy screen
  // offers no Fight! (it's gated on bossFightDue) and instead surfaces the
  // "End Turn (no battle)" escape. `end-day` is the reached-deployment landmark
  // — the same move the vitest fixtures made off the now-conditional Fight!.
  await page.getByTestId('to-deploy').click()
  await expect(page.getByTestId('end-day')).toBeVisible()

  // ── End the turn without battle → the fortnight's report ───────────────
  await page.getByTestId('end-day').click()
  await expect(page.getByRole('heading', { name: /The Fortnight Passes/ })).toBeVisible()
  await advanceReveal(page)
  await clearPendingDecisions(page)

  // ── The loop closed: a new council on the next turn ────────────────────
  await expect(page.getByRole('heading', { name: /Turn 2 — War Council/ })).toBeVisible()
})
