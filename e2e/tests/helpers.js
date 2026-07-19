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

// Deal out an EventRevealScreen to its end and click Continue. The reveal is
// dealt one card per "Reveal" click; a fate that fired with a choice blocks
// the advance until an option is picked (reveal-next goes disabled), so when
// that happens we pick the first offered option. Bounded so a stuck reveal
// fails loudly instead of looping forever.
export async function advanceReveal(page) {
  const continueBtn = page.getByTestId('report-continue')
  const revealNext = page.getByTestId('reveal-next')
  // Only ever match an ENABLED choice button: while a pick's POST is in flight
  // the option buttons go `disabled`, then detach. Clicking a disabled/detaching
  // button hangs on Playwright actionability, so we skip them and let the poll
  // come back around — which also self-heals a click the app dropped mid-render.
  const openChoice = page.locator('[data-testid^="choice-"]:not([disabled])').first()

  for (let i = 0; i < 60; i++) {
    if (await continueBtn.isVisible()) break

    if (await revealNext.isVisible().catch(() => false)) {
      if (await revealNext.isEnabled().catch(() => false)) {
        await revealNext.click().catch(() => {})
        continue
      }
      // Blocked on an unmade decision: pick the first offered option if one is
      // actually clickable right now (else wait and re-poll).
      if (await openChoice.isVisible().catch(() => false))
        await openChoice.click().catch(() => {})
    }

    // Let the card render / a pick resolve before the next poll.
    await page.waitForTimeout(150)
  }

  await expect(continueBtn).toBeVisible()
  await continueBtn.click()
}

// After a fates reveal, a deferred choice-fate (a counter-raid target that is
// also a choice event) leaves its decision owed on the pendingChoices overlay —
// choice cards with no reveal/continue control — which App shows before the
// next screen. Drain it by taking the first option of each until it clears. A
// no-op when nothing is pending (the common case), so it's always safe to call.
export async function clearPendingDecisions(page) {
  const anyChoice = page.locator('[data-testid^="choice-"]').first()
  const openChoice = page.locator('[data-testid^="choice-"]:not([disabled])').first()
  for (let i = 0; i < 12; i++) {
    if (!(await anyChoice.isVisible().catch(() => false))) break
    // Click only an enabled option (skip while a prior pick's POST is busy).
    if (await openChoice.isVisible().catch(() => false))
      await openChoice.click().catch(() => {})
    await page.waitForTimeout(200)
  }
}
