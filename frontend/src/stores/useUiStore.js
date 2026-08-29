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
  // THE SQUAD SCREEN (decision 13). Null when closed; otherwise the page
  // showing: {page: 'roll'} — the whole army — or {page: 'charter'|'honours'|
  // 'company', squadId} for a page reached FROM the roll, or {page:
  // 'character', characterId} for one person's sheet, reached from the company
  // (9-16). A takeover, not a
  // phase (13-7): it opens over whatever screen the player is on and Back puts
  // them back, exactly as storeRequest does.
  //
  // There is no router in this app and this slice does not introduce one (13-8):
  // the page swap is this one field, so a screen is opened by naming it and
  // closed by forgetting it. `squadId` is carried rather than the squad itself —
  // the campaign store is the authority on what a charter IS, and a copy taken
  // at open time would go stale the moment an honour was taken.
  squadScreen: null,
  // The item store (slice 6, 6-14; slice 17). Null when closed; otherwise ONE
  // of two shapes, which is what the panel's two modes branch on (17-4):
  //   - SLOT: `{accepts, squadId, squadName}` for a squad's banner slot, or
  //     `{accepts, slot, slotLabel, index, characterId, characterName}` for one
  //     of a character's typed slots (9-16). The SLOT declares what it accepts
  //     and the store filters to that, so the store itself never learns what
  //     kinds of item exist — the character case reuses it as slice 6 predicted
  //     it would, adding only `slot`, because every piece of gear is kind
  //     `gear` and a head slot must offer helms rather than all of it.
  //   - BROWSE: `{browse: true}` — the HUD's `The Stores` door. Unfiltered and
  //     read-only, and one field rather than a second takeover field because
  //     App.jsx has to tell the two apart to place them on opposite sides of
  //     the pending-choices overlay (17-6).
  storeRequest: null,
  // THE STUDY (slice 3, S3-3). A takeover like the two above and opened the
  // same way — from a HUD door — because research is ARMY-WIDE, the same tier
  // as the stores and unlike a squad's charter. One boolean rather than a
  // shape: the screen shows all four schools at once and has no sub-pages to
  // address, so there is nothing to carry.
  studyOpen: false,
  // THE FORGE (Construction slice C1). Null when closed; otherwise `{}` for
  // the item-first door (The Study's Construction school) or `{smithId}` for
  // the smith-first door (a mage's own sheet — "he is automatically selected",
  // which is what lets an UNPOSTED mage be found at all, since he has no
  // charter page). One request field like storeRequest, so the two doors are
  // two shapes of the same takeover and cannot drift apart.
  forgeRequest: null,
  // THE BATTLE LAB (docs/CAMPAIGN_PLAN.md, "TEST / SANDBOX MODE"). A takeover
  // like the demo battle rather than a phase, and for a stronger reason than
  // the others: the lab is FREE-STANDING (SB-1), so it is not a place inside a
  // turn at all — it opens over whatever screen the player is on, campaign or
  // no campaign, and Back puts them back exactly where they were.
  //
  // A boolean, because the lab has no sub-pages to address; what it is
  // composing lives in useSandboxStore, which survives closing the screen so a
  // player who ducks out to check something does not lose the army he built.
  labOpen: false,
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
  // The browse door (17-4). Same field, same Back, so a player is never in two
  // stores at once — opening a slot from a charter simply replaces the request.
  openStoreBrowse: () => set({ storeRequest: { browse: true } }),
  closeItemStore: () => set({ storeRequest: null }),

  // The squad screen opens on the roll and navigates within itself; closing it
  // returns to the phase underneath, which was never unmounted.
  openSquadScreen: () => set({ squadScreen: { page: 'roll' } }),
  showSquadPage: (page, squadId = null) => set({ squadScreen: { page, squadId } }),
  // One character's sheet (9-16), reached from the company roll. A page of the
  // same screen rather than a takeover of its own: it is 13-8's roll-then-page
  // shape one level further in, and Back walks out the way the player walked
  // in. Carries the id, never the character — the campaign store is the
  // authority on who they are, and a copy taken at open time would go stale the
  // moment a helm went on.
  showCharacterPage: (characterId) => set({ squadScreen: { page: 'character', characterId } }),
  closeSquadScreen: () => set({ squadScreen: null }),

  // The Study opens over whatever screen the player is on and Back puts them
  // back, exactly as the squad screen and the store do.
  openStudy: () => set({ studyOpen: true }),
  closeStudy: () => set({ studyOpen: false }),

  // The Forge's two doors (C-6): item-first opens bare, smith-first carries
  // the mage. Opening one replaces the other, same rule as the item store.
  openForge: (forgeRequest = {}) => set({ forgeRequest }),
  closeForge: () => set({ forgeRequest: null }),

  openLab: () => set({ labOpen: true }),
  closeLab: () => set({ labOpen: false }),

  toggleTutorial: () =>
    set((state) => {
      const next = !state.tutorial
      window.localStorage.setItem(TUTORIAL_KEY, next ? 'on' : 'off')
      return { tutorial: next }
    }),

  // The bundle a stale-campaign (404) recovery resets: back to the war
  // council (the Prepare phase) with no in-flight battle UI left over.
  resetBattleUI: () =>
    set({
      battleResult: null, raidBattle: null, dayReport: null,
      storeRequest: null, squadScreen: null, studyOpen: false, phase: 'prepare',
    }),

  reset: () => set(initialState()),
}))

export default useUiStore
