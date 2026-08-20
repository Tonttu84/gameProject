import { create } from 'zustand'
import {
  getCampaigns,
  createCampaign,
  consultCampaignAugury,
  rerollCampaignAugury,
  setCampaignEffort,
  advanceCampaignPhase,
  spendCampaign,
  postCampaignBattle,
  postCampaignRaids,
  scoutRaidTarget,
  endCampaignDay,
  postCampaignChoice,
  postAcceptFates,
  hireRecruit,
  openRecruit,
  reinforceSquad,
  takeSquadUpgrade,
  attachCharacter,
  bindSquadBanner,
  setCharacterHangBack,
} from '../services/api'

// Server-side campaign state, exposed as the view object plus the actions
// that advance it. Every action swaps in the refreshed view the server
// returns — the server is the only authority on campaign state.
const useCampaignStore = create((set, get) => ({
  campaign: null,
  loading: false,

  reload: async () => {
    set({ loading: true })
    try {
      const list = await getCampaigns()
      set({ campaign: list.find((c) => c.status === 'active') ?? list[0] ?? null })
    } finally {
      set({ loading: false })
    }
  },

  clear: () => set({ campaign: null }),

  create: async () => {
    const created = await createCampaign()
    set({ campaign: created })
    return created
  },

  consultAugur: async () => {
    set({ campaign: await consultCampaignAugury(get().campaign.id) })
  },

  rerollAugur: async (slot) => {
    set({ campaign: await rerollCampaignAugury(get().campaign.id, slot) })
  },

  setEffort: async (share) => {
    set({ campaign: await setCampaignEffort(get().campaign.id, share) })
  },

  // Move the turn on one phase. The server is the authority on which phase the
  // turn is in (App routes its screens off campaign.phase), so this must go
  // through it rather than flipping local UI state.
  // Returns the refreshed view, so a caller can tell success from the
  // undefined that `guarded` returns on failure (flows.breakCamp gates the
  // deployment screen on exactly that).
  advancePhase: async (phase) => {
    const campaign = await advanceCampaignPhase(get().campaign.id, phase)
    set({ campaign })
    return campaign
  },

  fortify: async () => {
    set({ campaign: await spendCampaign(get().campaign.id, { action: 'fortify' }) })
  },

  // Entering the Recruit phase draws the day's offer (and closes the camp) —
  // there is nothing to show until this runs. Idempotent server-side.
  // Returns the refreshed view (like advancePhase) so App can tell a drawn
  // offer from a failed call before it moves the screen.
  openRecruit: async () => {
    const campaign = await openRecruit(get().campaign.id)
    set({ campaign })
    return campaign
  },

  // body is {entryId} — the day's one hire. There is no skip.
  hireRecruit: async (body) => {
    set({ campaign: await hireRecruit(get().campaign.id, body) })
  },

  // Top one squad up from the loose pool: {reinforce: {type: bodies}}, all of
  // it or none. Separate from hireRecruit on purpose — the two Recruit-phase
  // sinks neither gate nor consume each other.
  reinforceSquad: async (squadId, body) => {
    set({ campaign: await reinforceSquad(get().campaign.id, squadId, body) })
  },

  takeSquadUpgrade: async (squadId, upgrade) => {
    set({ campaign: await takeSquadUpgrade(get().campaign.id, squadId, upgrade) })
  },

  bindSquadBanner: async (squadId, itemId) => {
    set({ campaign: await bindSquadBanner(get().campaign.id, squadId, itemId) })
  },

  attachCharacter: async (characterId, squadId) => {
    set({ campaign: await attachCharacter(get().campaign.id, characterId, squadId) })
  },

  setCharacterHangBack: async (characterId, hangBack) => {
    set({ campaign: await setCharacterHangBack(get().campaign.id, characterId, hangBack) })
  },

  fight: async (playerPlacement) => {
    const res = await postCampaignBattle(get().campaign.id, { player_placement: playerPlacement })
    set({ campaign: res.campaign })
    return res
  },

  launchRaids: async (parties) => {
    const res = await postCampaignRaids(get().campaign.id, parties)
    set({ campaign: res.campaign })
    return res
  },

  scoutRaid: async (body) => {
    const res = await scoutRaidTarget(get().campaign.id, body)
    set({ campaign: res.campaign })
    return res
  },

  endDay: async () => {
    const res = await endCampaignDay(get().campaign.id)
    set({ campaign: res.campaign })
    return res.report
  },

  // Seal the reading and let the fates come to pass at the tent; returns the
  // fates report for the reveal screen.
  acceptFates: async () => {
    const res = await postAcceptFates(get().campaign.id)
    set({ campaign: res.campaign })
    return res.report
  },

  // Resolve a pending choice-fate. The refreshed view drops the entry from
  // campaign.pendingChoices; the returned `resolved` carries the chosen
  // label for the reveal screen's outcome line.
  resolveChoice: async (slot, choice) => {
    const res = await postCampaignChoice(get().campaign.id, slot, choice)
    set({ campaign: res.campaign })
    return res.resolved
  },

  reset: () => set({ campaign: null, loading: false }),
}))

export default useCampaignStore
