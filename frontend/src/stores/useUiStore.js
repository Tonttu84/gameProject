import { create } from 'zustand'

const TUTORIAL_KEY = 'tutorialEnabled'
const initialTutorial = () => window.localStorage.getItem(TUTORIAL_KEY) !== 'off'

// The store's initial (and post-reset) state. A factory, not a constant, so
// `tutorial` re-reads localStorage each time — one definition site both the
// create() defaults and reset() draw from, so a new field can't be added to
// one and forgotten in the other (which would silently break test isolation).
const initialState = () => ({
  phase: 'prepare',
  battleResult: null,
  raidBattle: null,
  dayReport: null,
  demoBattle: null,
  demoLoading: false,
  tutorial: initialTutorial(),
  connectionError: null,
})

// UI-only campaign state: which screen is showing, in-progress battle
// results/replays, and the tutorial toggle. Everything server-authoritative
// lives in useCampaignStore instead.
const useUiStore = create((set) => ({
  ...initialState(),

  setPhase: (phase) => set({ phase }),
  setBattleResult: (battleResult) => set({ battleResult }),
  setRaidBattle: (raidBattle) => set({ raidBattle }),
  setDayReport: (dayReport) => set({ dayReport }),
  setDemoBattle: (demoBattle) => set({ demoBattle }),
  setDemoLoading: (demoLoading) => set({ demoLoading }),
  setConnectionError: (connectionError) => set({ connectionError }),

  toggleTutorial: () =>
    set((state) => {
      const next = !state.tutorial
      window.localStorage.setItem(TUTORIAL_KEY, next ? 'on' : 'off')
      return { tutorial: next }
    }),

  // The bundle a stale-campaign (404) recovery resets: back to the war
  // council (the Prepare phase) with no in-flight battle UI left over.
  resetBattleUI: () =>
    set({ battleResult: null, raidBattle: null, dayReport: null, phase: 'prepare' }),

  reset: () => set(initialState()),
}))

export default useUiStore
