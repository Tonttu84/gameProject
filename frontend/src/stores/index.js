export { default as useAuthStore } from './useAuthStore'
export { default as useNoticeStore } from './useNoticeStore'
export { default as useCampaignStore } from './useCampaignStore'
export { default as usePlacementStore } from './usePlacementStore'
export { default as useUiStore } from './useUiStore'
export * from './selectors'
export { guarded } from './guarded'
export * from './flows'

import useAuthStore from './useAuthStore'
import useNoticeStore from './useNoticeStore'
import useCampaignStore from './useCampaignStore'
import usePlacementStore from './usePlacementStore'
import useUiStore from './useUiStore'

// Zustand stores are module singletons, so state would otherwise leak across
// `it()` blocks within one test file (React's useState gave every mount a
// clean slate for free; a store does not). Wired into a global beforeEach in
// __tests__/setup.js so every test starts from the same clean slate. Notice
// store resets first so its pending auto-clear timer is cancelled before
// anything else runs.
export const resetAllStores = () => {
  useNoticeStore.getState().reset()
  useAuthStore.getState().reset()
  useCampaignStore.getState().reset()
  usePlacementStore.getState().reset()
  useUiStore.getState().reset()
}
