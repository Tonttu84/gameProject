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

  for (let i = 0; i < 20; i++) {
    if (await continueBtn.isVisible()) break

    if (await revealNext.isVisible()) {
      if (await revealNext.isEnabled()) {
        await revealNext.click()
        continue
      }
      // Advance is blocked on an unmade decision — take the first choice.
      const firstChoice = page.locator('[data-testid^="choice-"]').first()
      await expect(firstChoice).toBeVisible()
      await firstChoice.click()
      continue
    }

    // Neither control present yet — let the card render.
    await page.waitForTimeout(100)
  }

  await expect(continueBtn).toBeVisible()
  await continueBtn.click()
}
