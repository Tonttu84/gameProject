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
})
