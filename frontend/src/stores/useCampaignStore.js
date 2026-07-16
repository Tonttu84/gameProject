import { create } from 'zustand'
import {
  getCampaigns,
  createCampaign,
  consultCampaignAugury,
  rerollCampaignAugury,
  setCampaignForage,
  spendCampaign,
  postCampaignBattle,
  postCampaignRaids,
  endCampaignDay,
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

  assignForagers: async (assignment) => {
    set({ campaign: await setCampaignForage(get().campaign.id, assignment) })
  },

  fortify: async () => {
    set({ campaign: await spendCampaign(get().campaign.id, { action: 'fortify' }) })
  },

  buyMilitia: async (count) => {
    set({ campaign: await spendCampaign(get().campaign.id, { action: 'militia', count }) })
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

  endDay: async () => {
    const res = await endCampaignDay(get().campaign.id)
    set({ campaign: res.campaign })
    return res.report
  },

  reset: () => set({ campaign: null, loading: false }),
}))

export default useCampaignStore
