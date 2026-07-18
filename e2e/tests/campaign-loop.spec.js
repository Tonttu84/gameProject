import { test, expect } from '@playwright/test'
import { registerAndLogin, uniqueUsername, advanceReveal } from './helpers.js'

// First real end-to-end coverage: a browser driving one full campaign turn
// against a running stack — login → council → forage → augur consult/reroll →
// Accept the Fates (the mid-turn reveal) → muster → placement → End Turn →
// next council. Everything here talks to the actual campaign server + engine;
// there are no mocks.
test('full campaign turn: login → forage → augur → accept fates → muster → end turn', async ({ page }) => {
  await page.goto('/')

  // ── Login (fresh throwaway commander) ──────────────────────────────────
  await registerAndLogin(page, uniqueUsername())

  // ── Start a campaign ───────────────────────────────────────────────────
  await page.getByTestId('start-campaign').click()
  await expect(page.getByRole('heading', { name: /Turn 1 — War Council/ })).toBeVisible()

  // ── Forage: assign some troops and send them out ───────────────────────
  const forageInput = page.locator('[data-testid^="forage-input-"]').first()
  await expect(forageInput).toBeVisible()
  await forageInput.fill('20')
  await page.getByTestId('forage-submit').click()
  await expect(page.getByTestId('forage-submit')).toContainText('Foragers assigned')

  // ── Visit the augur, consult, and recast one fate ──────────────────────
  await page.getByRole('button', { name: 'Visit the Augur' }).click()
  await page.getByTestId('consult-augur').click()

  // Three visions appear; recast the first while a reroll remains.
  const firstVision = page.getByTestId('augury-vision-0')
  await expect(firstVision).toBeVisible()
  if (await firstVision.isEnabled()) await firstVision.click()

  // ── Accept the Fates → the reveal plays right here at the tent ─────────
  await page.getByTestId('accept-fates').click()
  await expect(page.getByRole('heading', { name: /The Fates Come to Pass/ })).toBeVisible()
  await advanceReveal(page) // lands back on the council

  // ── Muster and deploy ──────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Muster for Battle' }).click()
  await expect(page.getByRole('button', { name: 'Fight!' })).toBeVisible()

  // ── End the turn without battle → the fortnight's report ───────────────
  await page.getByTestId('end-day').click()
  await expect(page.getByRole('heading', { name: /The Fortnight Passes/ })).toBeVisible()
  await advanceReveal(page)

  // ── The loop closed: a new council on the next turn ────────────────────
  await expect(page.getByRole('heading', { name: /Turn 2 — War Council/ })).toBeVisible()
})
