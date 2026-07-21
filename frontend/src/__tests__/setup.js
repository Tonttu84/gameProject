import '@testing-library/jest-dom'
import { beforeEach } from 'vitest'

// Dynamic import, not a static one: setupFiles run BEFORE a test file's own
// vi.mock('../services/api', ...) is hoisted/applied. A static import here
// would eagerly load the stores (and the real, unmocked services/api they
// import) ahead of that mock taking effect, binding every store to real
// axios calls for the rest of the file. Importing inside beforeEach defers
// module resolution until each test runs, by which point the current test
// file's own mock is already in place.
beforeEach(async () => {
  // Clear localStorage FIRST: resetAllStores() → useUiStore.reset() calls
  // initialTutorial(), which reads window.localStorage. If a prior test left
  // tutorialEnabled='off' behind, resetting before the clear would seed the
  // "clean" store from that stale value — reset must land on a blank slate.
  window.localStorage.clear()
  const { resetAllStores } = await import('../stores')
  resetAllStores()
  // The one-time turn-1 intro (CampaignIntro) would otherwise intercept every
  // App test that seeds a day-1 campaign. It's story, not under test here — mark
  // it seen by default; the intro's own behavior is covered by campaignIntro
  // (direct render) and campaignFlow's start-campaign case (which opts back in).
  const useUiStore = (await import('../stores/useUiStore')).default
  useUiStore.setState({ introSeen: true })
})
