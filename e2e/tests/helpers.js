import { expect } from '@playwright/test'

// A fresh, unique commander per test run. Registering (rather than reusing the
// DEV_SEED testuser) guarantees a clean slate — no leftover campaign from a
// prior run — so the flow always starts at "No Campaign In Progress".
export const uniqueUsername = () =>
  `cmdr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

// Register a throwaway account and land logged in. The login form's register
// mode creates the account, then logs in with the same credentials.
export async function registerAndLogin(page, username, password = 'test1234') {
  await page.getByTestId('login-toggle').click() // login → register mode
  await page.getByTestId('login-username').fill(username)
  await page.getByTestId('login-password').fill(password)
  await page.getByTestId('login-submit').click()
  await expect(page.getByTestId('auth-username')).toContainText(username)
}

// Deal out an EventRevealScreen to its end and click Continue, returning how
// many choice-fates were resolved along the way (so a caller can PROVE the
// multi-choice reveal actually ran). The reveal is dealt one card per "Reveal"
// click; a fate that fired with a choice blocks the advance until an option is
// picked (reveal-next goes disabled). The gate means at most ONE choice is ever
// open at a time — the card just dealt — so each step is deterministic:
//   • pick the current card's choice, then WAIT for the advance to re-enable
//     (the precise post-pick sync — no fixed sleeps, no re-clicking a busy
//     button, which is what made the old best-effort poll race), or
//   • advance to the next card.
// Bounded so a genuinely stuck reveal fails loudly instead of looping forever.
export async function advanceReveal(page) {
  const continueBtn = page.getByTestId('report-continue')
  const revealNext = page.getByTestId('reveal-next')
  // Only ever match an ENABLED choice option BUTTON: while a pick's POST is in
  // flight the option buttons go `disabled` then detach, so this narrows to the
  // one card currently awaiting a decision. The `button` qualifier matters —
  // the resolved-outcome line is a <p data-testid="choice-outcome-N">, which a
  // bare `choice-` prefix would (wrongly) match and trap the loop on.
  const openChoice = page.locator('button[data-testid^="choice-"]:not([disabled])').first()
  let choicesResolved = 0

  for (let i = 0; i < 40; i++) {
    if (await continueBtn.isVisible()) break

    // A fate blocking on a choice disables reveal-next; its options are then
    // the only enabled controls. Pick the first and wait for the advance to
    // re-enable — the deterministic signal the pick's POST resolved.
    if (await openChoice.isVisible().catch(() => false)) {
      await openChoice.click()
      await expect(revealNext).toBeEnabled()
      choicesResolved += 1
      continue
    }

    if (await revealNext.isEnabled().catch(() => false)) await revealNext.click()
    else await page.waitForTimeout(100)
  }

  await expect(continueBtn).toBeVisible()
  await continueBtn.click()
  return choicesResolved
}

// After a fates reveal, a deferred choice-fate (a counter-raid target that is
// also a choice event) leaves its decision owed on the pendingChoices overlay —
// choice cards with no reveal/continue control — which App shows before the
// next screen. Drain it by taking the first option of each until it clears. A
// no-op when nothing is pending (the common case), so it's always safe to call.
export async function clearPendingDecisions(page) {
  const anyChoice = page.locator('button[data-testid^="choice-"]').first()
  const openChoice = page.locator('button[data-testid^="choice-"]:not([disabled])').first()
  for (let i = 0; i < 12; i++) {
    if (!(await anyChoice.isVisible().catch(() => false))) break
    // Click only an enabled option (skip while a prior pick's POST is busy).
    if (await openChoice.isVisible().catch(() => false))
      await openChoice.click().catch(() => {})
    await page.waitForTimeout(200)
  }
}
