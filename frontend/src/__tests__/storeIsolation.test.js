/**
 * Regression guard for the global beforeEach ordering in setup.js.
 *
 * setup.js must clear window.localStorage BEFORE calling resetAllStores(),
 * because useUiStore.reset() re-reads localStorage for the tutorial flag
 * (initialTutorial()). If a test leaves tutorialEnabled='off' behind, the
 * NEXT test's reset has to land on the clean default (tutorial=true) anyway —
 * otherwise state leaks across the test boundary, an isolation break the old
 * per-mount useState never produced.
 *
 * These two tests are order-dependent BY DESIGN: the first pollutes
 * localStorage without cleaning up; the second asserts the global beforeEach
 * still handed it a clean slate. With the buggy ordering (reset before clear),
 * the second test saw tutorial=false and failed.
 */
import { describe, it, expect } from 'vitest'
import useUiStore from '../stores/useUiStore'

describe('cross-test store isolation (setup.js ordering)', () => {
  it('pollutes localStorage with a tutorial-off flag and does NOT clean up', () => {
    useUiStore.getState().toggleTutorial()
    expect(useUiStore.getState().tutorial).toBe(false)
    expect(window.localStorage.getItem('tutorialEnabled')).toBe('off')
  })

  it('the next test starts from a clean slate despite the leftover flag', () => {
    // The global beforeEach cleared localStorage before resetting the store,
    // so the tutorial default (true) is restored even though the previous
    // test left 'off' in storage. Old ordering read 'off' → this was false.
    expect(useUiStore.getState().tutorial).toBe(true)
  })
})
