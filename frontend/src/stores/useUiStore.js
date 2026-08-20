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
  // The one-time narrative intro (CampaignIntro) is shown on turn 1 until the
  // player takes command. Session-only UI state (a hard reload on day 1 re-shows
  // it — harmless for fluff); startCampaign resets it so each new campaign opens
  // on the scene-setter, not tutorial-gated (it's story, everyone sees it once).
  introSeen: false,
  // The item store, opened FROM a slot (slice 6, 6-14). Null when closed;
  // otherwise `{accepts, squadId, squadName}` — what the slot the player
  // clicked will take, and where a chosen item goes. The SLOT declares what it
  // accepts and the store filters to that, so the store itself never learns
  // what kinds of item exist and a character's typed slot can reuse it as-is.
  storeRequest: null,
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
  setIntroSeen: (introSeen) => set({ introSeen }),
  openItemStore: (storeRequest) => set({ storeRequest }),
  closeItemStore: () => set({ storeRequest: null }),

  toggleTutorial: () =>
    set((state) => {
      const next = !state.tutorial
      window.localStorage.setItem(TUTORIAL_KEY, next ? 'on' : 'off')
      return { tutorial: next }
    }),

  // The bundle a stale-campaign (404) recovery resets: back to the war
  // council (the Prepare phase) with no in-flight battle UI left over.
  resetBattleUI: () =>
    set({ battleResult: null, raidBattle: null, dayReport: null, storeRequest: null, phase: 'prepare' }),

  reset: () => set(initialState()),
}))

export default useUiStore
