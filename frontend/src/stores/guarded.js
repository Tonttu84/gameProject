import useAuthStore from './useAuthStore'
import useNoticeStore from './useNoticeStore'
import useCampaignStore from './useCampaignStore'
import usePlacementStore from './usePlacementStore'
import useUiStore from './useUiStore'

// Campaign calls share one error path: an expired token drops back to the
// login screen instead of the fatal connection-error screen, and a 404 —
// the campaign no longer exists server-side, e.g. wiped by a redeploy's
// build-version purge while this tab was open — reloads the campaign list
// (finishing the purge) and lands on the start screen instead of leaving a
// zombie UI whose every action fails.
export const guarded = (fn) => async (...args) => {
  try {
    return await fn(...args)
  } catch (e) {
    if (e.response?.status === 401) {
      useAuthStore.getState().logout()
      useUiStore.getState().setPhase('prepare')
      useNoticeStore.getState().show('Session expired — log in again.')
    } else if (e.response?.status === 404) {
      useNoticeStore.getState().show('This campaign is gone (a new build wiped old saves) — start a fresh one.')
      usePlacementStore.getState().clear()
      useUiStore.getState().resetBattleUI()
      await useCampaignStore.getState().reload().catch(() => {})
    } else if (e.response?.data?.error) {
      useNoticeStore.getState().show(e.response.data.error)
    } else {
      useUiStore.getState().setConnectionError('Campaign server call failed. Check that it is running.')
    }
    return undefined
  }
}
